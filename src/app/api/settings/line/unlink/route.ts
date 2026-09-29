import { NextResponse } from 'next/server'
import { denyUnlessLineOwner } from '@/lib/line/owner-guard'
import { getSupabaseServer } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/** POST /api/settings/line/unlink — เลิกผูก LINE ของเจ้าของ (บอทเลิกตอบ + เลิกส่ง push) */
export async function POST() {
  const denied = await denyUnlessLineOwner()
  if (denied) return denied

  const sb = await getSupabaseServer()
  const { error } = await sb.rpc('unlink_line_account')
  if (error) {
    console.error('[line-unlink] เลิกผูกไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'UNLINK_FAILED' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
