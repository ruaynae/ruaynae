import { BellRing } from 'lucide-react'
import { Suspense } from 'react'
import { Skeleton } from '@/components/ui/states'
import { fmtDateTime } from '@/lib/format'
import { LINE_PUSH_KINDS } from '@/lib/line/push-batch'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { getSupabaseServer } from '@/lib/supabase/server'
import type { LinkedAccount } from './link-panel'
import { TestPushButton } from './test-push-button'

/**
 * สถานะการแจ้งเตือนรออนุมัติทาง LINE (เจ้าของเท่านั้น — ด่านอยู่ใน layout.tsx)
 *
 * 🔴 ไม่มีที่เก็บ "ผลการส่ง" แยกต่างหาก — อ่านจากแจ้งเตือนที่มีอยู่แล้ว (`notifications.line_pushed_at`)
 *    · ตัวส่งมาร์คคอลัมน์นี้เฉพาะตอนส่งสำเร็จ หรือตอนไม่มีของรออยู่แล้ว
 *    · ส่งไม่สำเร็จ (โควตาหมด · คีย์ผิด · cron ไม่ทำงาน) = ไม่มาร์ค แจ้งเตือนจึง "ค้าง"
 *    ดังนั้น "ค้างรอส่งนานผิดปกติ" จับได้ทุกสาเหตุ โดยไม่ต้องแตะฐานข้อมูล
 * 🔴 `line_pushed_at` ล่าสุด = "ตัวส่งอัตโนมัติจัดการแจ้งเตือนของบัญชีนี้ล่าสุดเมื่อไหร่"
 *    ไม่ได้แปลว่ามีข้อความถึงมือเสมอไป (ถ้าตอนนั้นไม่มีของรออยู่ ก็มาร์คโดยไม่ส่ง)
 *    — ให้ปุ่มทดสอบเป็นตัวพิสูจน์ว่าข้อความถึงจริง
 */

/** cron ยิงทุก 5 นาที · เกินนี้ยังค้างอยู่ = ผิดปกติ */
const STALE_MIN = 15

type AccountStatus = {
  id: string
  name: string
  total: number
  unsent: number
  oldestUnsentMin: number | null
  lastHandledAt: string | null
}

type Status = {
  pendingTxn: number
  pendingAdvance: number
  accounts: AccountStatus[]
}

async function readStatus(accounts: LinkedAccount[]): Promise<Status | 'error'> {
  try {
    const sb = await getSupabaseServer()
    const admin = getSupabaseAdmin()
    const now = Date.now()

    const [tx, adv] = await Promise.all([
      sb.from('transactions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      sb.from('advances').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    ])
    if (tx.error || adv.error) return 'error'

    const rows: AccountStatus[] = []
    for (const a of accounts) {
      // นับเฉพาะแจ้งเตือนที่เกิดหลังผูกบัญชี — กติกาเดียวกับตัวส่งจริง
      const base = () =>
        admin
          .from('notifications')
          .select('created_at', { count: 'exact' })
          .eq('user_id', a.profile_id)
          .in('kind', [...LINE_PUSH_KINDS])
          .gte('created_at', a.created_at)

      const [total, unsent, handled] = await Promise.all([
        base().range(0, 0),
        base().is('line_pushed_at', null).order('created_at', { ascending: true }).range(0, 0),
        admin
          .from('notifications')
          .select('line_pushed_at')
          .eq('user_id', a.profile_id)
          .in('kind', [...LINE_PUSH_KINDS])
          .not('line_pushed_at', 'is', null)
          .order('line_pushed_at', { ascending: false })
          .range(0, 0),
      ])
      if (total.error || unsent.error || handled.error) return 'error'

      const oldest = unsent.data?.[0]?.created_at
      rows.push({
        id: a.id,
        name: a.display_name ?? 'บัญชี LINE',
        total: total.count ?? 0,
        unsent: unsent.count ?? 0,
        oldestUnsentMin: oldest ? Math.max(0, Math.round((now - new Date(oldest).getTime()) / 60_000)) : null,
        lastHandledAt: handled.data?.[0]?.line_pushed_at ?? null,
      })
    }
    return { pendingTxn: tx.count ?? 0, pendingAdvance: adv.count ?? 0, accounts: rows }
  } catch (e) {
    console.error('[line-settings] อ่านสถานะการส่งไม่ได้', e instanceof Error ? e.message : '')
    return 'error'
  }
}

function fmtAge(min: number): string {
  if (min < 60) return `${min} นาที`
  if (min < 60 * 24) return `${Math.floor(min / 60)} ชม. ${min % 60} นาที`
  return `${Math.floor(min / (60 * 24))} วัน`
}

function Verdict({ s }: { s: AccountStatus }) {
  if (s.unsent > 0 && s.oldestUnsentMin !== null && s.oldestUnsentMin >= STALE_MIN) {
    return (
      <p className="text-sm text-expense">
        ผิดปกติ — ค้างรอส่ง <span className="tabular-nums">{s.unsent}</span> รายการ นานสุด {fmtAge(s.oldestUnsentMin)}
        {' '}ตัวส่งอัตโนมัติอาจไม่ทำงาน หรือ LINE ปฏิเสธการส่ง (โควตาหมด · คีย์ผิด) · กด &ldquo;ส่งข้อความทดสอบ&rdquo; เพื่อดูสาเหตุ
      </p>
    )
  }
  if (s.unsent > 0) {
    return (
      <p className="text-sm text-ink-2">
        รอรอบส่งถัดไป <span className="tabular-nums">{s.unsent}</span> รายการ (ส่งทุกประมาณ 5 นาที)
      </p>
    )
  }
  if (s.total === 0) {
    return (
      <p className="text-sm text-muted-token">
        ยังไม่เคยมีรายการรออนุมัติเข้ามาหลังผูกบัญชีนี้ จึงยังไม่มีอะไรให้แจ้ง
      </p>
    )
  }
  return (
    <p className="text-sm text-ink-2">
      ปกติ — แจ้งเตือนหลังผูกบัญชี <span className="tabular-nums">{s.total}</span> รายการ จัดการครบแล้ว
    </p>
  )
}

function Body({ status, hasToken }: { status: Status | 'error'; hasToken: boolean }) {
  if (status === 'error') {
    return <p className="px-4 py-4 text-sm text-expense">อ่านสถานะการส่งไม่ได้ ลองโหลดหน้าใหม่</p>
  }
  const waiting = status.pendingTxn + status.pendingAdvance
  return (
    <div>
      <p className="border-b border-line-soft px-4 py-3 text-sm text-ink-2">
        {waiting === 0 ? (
          'ตอนนี้ไม่มีรายการรออนุมัติ'
        ) : (
          <>
            ตอนนี้รออนุมัติ:{' '}
            {[
              status.pendingTxn > 0 ? `รายจ่าย ${status.pendingTxn} รายการ` : null,
              status.pendingAdvance > 0 ? `ใบเบิก ${status.pendingAdvance} ใบ` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </>
        )}
      </p>
      {status.accounts.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-token">ยังไม่ได้ผูกบัญชี LINE จึงไม่มีการแจ้งเตือนเข้า LINE</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {status.accounts.map((s) => (
            <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-4">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate text-sm font-medium text-ink">{s.name}</p>
                <Verdict s={s} />
                <p className="text-xs text-muted-token">
                  ตัวส่งอัตโนมัติจัดการแจ้งเตือนของบัญชีนี้ล่าสุด:{' '}
                  {s.lastHandledAt ? fmtDateTime(s.lastHandledAt) : 'ยังไม่เคย'}
                </p>
              </div>
              <TestPushButton accountId={s.id} disabled={!hasToken} />
            </li>
          ))}
        </ul>
      )}
      {!hasToken && (
        <p className="border-t border-line-soft px-4 py-3 text-xs text-muted-token">
          ตั้ง access token ก่อนจึงจะส่งข้อความทดสอบได้
        </p>
      )}
    </div>
  )
}

async function DeliveryBody({ accounts, hasToken }: { accounts: LinkedAccount[]; hasToken: boolean }) {
  return <Body status={await readStatus(accounts)} hasToken={hasToken} />
}

export function DeliveryCard({ accounts, hasToken }: { accounts: LinkedAccount[]; hasToken: boolean }) {
  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className="flex items-center gap-2.5 border-b border-line-soft px-4 py-3">
        <BellRing className="size-4 shrink-0 text-brand" strokeWidth={1.8} />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">สถานะแจ้งเตือนรออนุมัติทาง LINE</h2>
          <p className="mt-0.5 text-xs text-muted-token">
            ส่งรวบเป็นข้อความเดียวทุกประมาณ 5 นาที · ส่งเฉพาะตอนมีรายการรออนุมัติค้างอยู่ ·
            ปุ่มทดสอบกินโควตา 1 ข้อความต่อครั้ง
          </p>
        </div>
      </div>
      <Suspense fallback={<Skeleton className="m-4 h-16 w-72 max-w-full" />}>
        <DeliveryBody accounts={accounts} hasToken={hasToken} />
      </Suspense>
    </section>
  )
}
