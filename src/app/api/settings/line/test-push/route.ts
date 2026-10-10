import { NextResponse } from 'next/server'
import { LineHttpError, push } from '@/lib/line/client'
import { lineToken } from '@/lib/line/config'
import { text } from '@/lib/line/bot/messages'
import { denyUnlessLineOwner } from '@/lib/line/owner-guard'
import { getSupabaseServer } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/settings/line/test-push { id } — ส่งข้อความทดสอบเข้า LINE บัญชีเดียวที่เลือก
 *
 * 🔴 ส่งทีละบัญชีที่เจ้าของกดเอง ไม่ใช่ทุกบัญชี — push กินโควตาฟรีเดือนละ 300 ข้อความ
 *    และไม่ควรมีข้อความทดสอบเด้งหาเจ้าของคนอื่นที่ไม่ได้ขอ
 * 🔴 ตอบเหตุผลที่แยกได้ (โควตาหมด / คีย์ถูกปฏิเสธ) ไม่ใช่แค่ "ไม่สำเร็จ" — นี่คือจุดประสงค์ของปุ่ม
 *    ใช้ตัว `push()` ตัวเดียวกับที่แจ้งเตือนอัตโนมัติใช้ จึงพิสูจน์เส้นทางส่งจริง
 */
export async function POST(req: Request) {
  const denied = await denyUnlessLineOwner()
  if (denied) return denied

  const body = (await req.json().catch(() => null)) as { id?: unknown } | null
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!UUID.test(id)) return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })

  if (!(await lineToken())) return NextResponse.json({ error: 'NO_TOKEN' }, { status: 409 })

  // อ่านผ่าน session ของเจ้าของ — RLS ของ line_accounts อนุญาตเฉพาะเจ้าของอยู่แล้ว
  const sb = await getSupabaseServer()
  const { data: acc, error } = await sb
    .from('line_accounts')
    .select('line_user_id')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    console.error('[line-test-push] อ่านบัญชีไม่ได้', error.message)
    return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
  }
  if (!acc) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  try {
    await push(acc.line_user_id, [
      text('ทดสอบแจ้งเตือนจากระบบรวยแน่ — ถ้าเห็นข้อความนี้ แปลว่าแจ้งเตือนรออนุมัติส่งเข้า LINE นี้ได้'),
    ])
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof LineHttpError) {
      console.error('[line-test-push] LINE ปฏิเสธ', e.status, e.message)
      const reason = e.status === 429 ? 'QUOTA_EXCEEDED' : e.status === 401 ? 'TOKEN_REJECTED' : 'LINE_REJECTED'
      return NextResponse.json({ error: reason, status: e.status }, { status: 502 })
    }
    console.error('[line-test-push] ส่งไม่สำเร็จ', e instanceof Error ? e.message : '')
    return NextResponse.json({ error: 'SEND_FAILED' }, { status: 502 })
  }
}
