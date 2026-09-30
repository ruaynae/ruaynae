import { NextResponse } from 'next/server'
import { denyUnlessLineOwner } from '@/lib/line/owner-guard'
import { getSupabaseServer } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** POST /api/settings/line/unlink { id } — เลิกผูก LINE ทีละบัญชี (บัญชีนั้นเลิกได้บอท + push) */
export async function POST(req: Request) {
  const denied = await denyUnlessLineOwner()
  if (denied) return denied

  const body = (await req.json().catch(() => null)) as { id?: unknown } | null
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!UUID.test(id)) return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })

  const sb = await getSupabaseServer()
  const { error } = await sb.rpc('unlink_line_account', { p_id: id })
  if (error) {
    if (error.message.includes('NOT_FOUND')) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    console.error('[line-unlink] เลิกผูกไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'UNLINK_FAILED' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
