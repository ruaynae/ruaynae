import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { LineHttpError, push } from './client'
import { lineToken } from './config'
import { data, text } from './bot/messages'
import { MENU_LABEL } from './bot/copy'

/** ชนิดแจ้งเตือนที่ส่งเข้า LINE · หน้าตั้งค่า LINE อ่านค่านี้ไปนับสถานะ ห้ามเขียนสำเนาแยก */
export const LINE_PUSH_KINDS = ['txn_pending', 'advance_pending'] as const
const KINDS = LINE_PUSH_KINDS
const BATCH = 200

export type LinePushResult = {
  skipped?: 'NO_TOKEN' | 'NO_ACCOUNT' | 'NOTHING'
  pushed: number
  marked: number
  error?: string
}

/** เจ้าของหนึ่งคน (profile) + ทุกบัญชี LINE ที่ผูกไว้ */
type Target = { profileId: string; since: number; lineUserIds: string[] }

/**
 * ส่งแจ้งเตือน "มีของรออนุมัติ" เข้า LINE ของเจ้าของ — รวบเป็นข้อความเดียวต่อรอบ cron
 *
 * 🔴 ไม่ส่งรายชิ้น: หัวหน้าโครงการคีย์รัวสิบรายการ = สิบข้อความกินโควตาฟรีเดือนละ 300
 * 🔴 นับ "ที่ยังรออยู่จริง" ตอนส่ง ไม่ใช่นับแจ้งเตือน — รายการที่เจ้าของอนุมัติไปแล้ว
 *    ก่อนถึงรอบ cron ต้องไม่ถูกเตือนซ้ำ
 * 🔴 429 (โควตาหมด) = ไม่มาร์ค `line_pushed_at` — รอบหน้า/เดือนหน้ายังได้ส่ง
 *    ส่วน error อื่น ๆ (เช่น token ผิด) ก็ไม่มาร์คเช่นกัน แต่ไม่ให้ล้มงาน web push
 * 🔴 นับเฉพาะแจ้งเตือนที่เกิดหลังผูกบัญชี — ไม่งั้นวันที่ผูกครั้งแรกจะโดนเตือนย้อนหลังทั้งกอง
 * 🔴 วนต่อ **เจ้าของ (profile)** ไม่ใช่ต่อบัญชี LINE — `line_pushed_at` อยู่บนแถวแจ้งเตือนของ profile
 *    ถ้าวนต่อบัญชีแล้วมาร์คทันทีหลังส่งบัญชีแรก บัญชีที่สองจะไม่เหลือแถวให้ส่งเลย
 *    (เจอจริง 11 ต.ค. 2569: เจ้าของหนึ่งคนผูก 2 LINE ได้ข้อความแค่บัญชีที่ผูกก่อน)
 *    ส่งเข้าทุกบัญชีก่อน แล้วมาร์คครั้งเดียวเมื่อมีอย่างน้อยหนึ่งบัญชีรับสำเร็จ
 */
export async function dispatchLinePush(admin: SupabaseClient<Database>): Promise<LinePushResult> {
  if (!(await lineToken())) return { skipped: 'NO_TOKEN', pushed: 0, marked: 0 }

  const { data: accounts, error: aErr } = await admin
    .from('line_accounts')
    .select('line_user_id, profile_id, created_at')
    .order('created_at', { ascending: true })
    .range(0, 20)
  if (aErr) return { pushed: 0, marked: 0, error: aErr.message }
  if (!accounts || accounts.length === 0) return { skipped: 'NO_ACCOUNT', pushed: 0, marked: 0 }

  // รวมบัญชี LINE ตามเจ้าของ · `since` = วันที่ผูกบัญชีแรกสุดของเจ้าของคนนั้น
  const targets = new Map<string, Target>()
  for (const acc of accounts) {
    const at = new Date(acc.created_at).getTime()
    const t = targets.get(acc.profile_id)
    if (t) {
      t.lineUserIds.push(acc.line_user_id)
      t.since = Math.min(t.since, at)
    } else {
      targets.set(acc.profile_id, { profileId: acc.profile_id, since: at, lineUserIds: [acc.line_user_id] })
    }
  }

  let pushed = 0
  let marked = 0

  for (const t of targets.values()) {
    const { data: rows, error: nErr } = await admin
      .from('notifications')
      .select('id')
      .eq('user_id', t.profileId)
      .is('line_pushed_at', null)
      .in('kind', KINDS)
      .gte('created_at', new Date(t.since).toISOString())
      .order('created_at', { ascending: true })
      .range(0, BATCH - 1)
    if (nErr) return { pushed, marked, error: nErr.message }
    if (!rows || rows.length === 0) continue
    const ids = rows.map((r) => r.id)

    const [tx, adv] = await Promise.all([
      admin.from('transactions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      admin.from('advances').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    ])
    if (tx.error || adv.error) return { pushed, marked, error: (tx.error ?? adv.error)!.message }
    const nTx = tx.count ?? 0
    const nAdv = adv.count ?? 0

    if (nTx + nAdv > 0) {
      const parts: string[] = []
      if (nTx > 0) parts.push(`รายจ่าย ${nTx} รายการ`)
      if (nAdv > 0) parts.push(`ใบเบิก ${nAdv} ใบ`)
      const message = text(`มีรออนุมัติ: ${parts.join(' · ')}`, [
        { label: MENU_LABEL.apr, data: data({ m: 'apr' }) },
      ])

      // ส่งเข้าทุกบัญชีของเจ้าของคนนี้ · บัญชีหนึ่งล้มต้องไม่ขวางบัญชีที่เหลือ
      let ok = 0
      for (const to of t.lineUserIds) {
        try {
          await push(to, [message])
          ok += 1
          pushed += 1
        } catch (e) {
          if (e instanceof LineHttpError && e.status === 429) {
            console.error('[line-push] โควตาข้อความเดือนนี้หมด — ยังไม่มาร์ค รอรอบหน้า')
          } else {
            console.error('[line-push] ส่งไม่สำเร็จ', (e as Error).message)
          }
        }
      }
      // ไม่มีบัญชีไหนรับสำเร็จเลย = ไม่มาร์ค รอบหน้าลองใหม่
      if (ok === 0) continue
    }

    // ไม่มีอะไรรออยู่แล้ว (อนุมัติไปหมด) หรือส่งสำเร็จอย่างน้อยหนึ่งบัญชี → มาร์คว่าจัดการแล้ว
    const { error: uErr } = await admin
      .from('notifications')
      .update({ line_pushed_at: new Date().toISOString() })
      .in('id', ids)
    if (uErr) return { pushed, marked, error: uErr.message }
    marked += ids.length
  }

  return { pushed, marked }
}
