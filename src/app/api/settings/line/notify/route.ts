import { NextResponse } from 'next/server'
import { denyUnlessLineOwner } from '@/lib/line/owner-guard'
import { getSupabaseServer } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/settings/line/notify { id, on } — เปิด/ปิดแจ้งเตือน "มีรออนุมัติ" ของบัญชี LINE หนึ่งบัญชี
 * ปิด = ตัวส่งข้ามบัญชีนี้ · บอทยังตอบ/ใช้เมนูได้ตามปกติ · ปุ่มส่งข้อความทดสอบยังใช้ได้
 */
export async function POST(req: Request) {
  const denied = await denyUnlessLineOwner()
  if (denied) return denied

  const body = (await req.json().catch(() => null)) as { id?: unknown; on?: unknown } | null
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!UUID.test(id) || typeof body?.on !== 'boolean') {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const sb = await getSupabaseServer()
  const { error } = await sb.rpc('set_line_account_notify', { p_id: id, p_on: body.on })
  if (error) {
    if (error.message.includes('NOT_FOUND')) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    console.error('[line-notify] ตั้งค่าไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'NOTIFY_FAILED' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
