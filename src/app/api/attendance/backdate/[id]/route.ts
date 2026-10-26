import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/transactions'
import { backdateDbCode, MAX_BACKDATE_REASON } from '@/lib/attendance-backdate'

export const runtime = 'nodejs'

const statusOf = (code: string) =>
  code === 'FORBIDDEN' ? 403 : code === 'NOT_FOUND' ? 404 : 409

/**
 * PATCH /api/attendance/backdate/[id] — เจ้าของอนุมัติ / ไม่อนุมัติ
 * อนุมัติ = RPC เขียนแถว attendance ให้ในนามเจ้าของ (guard เดิมตรวจครบ) · ไม่อนุมัติต้องมีเหตุผล
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })
  if (me.role !== 'owner') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }
  const action = body.action
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }
  const reason = String(body.reason ?? '').trim().slice(0, MAX_BACKDATE_REASON)
  if (action === 'reject' && reason === '') {
    return NextResponse.json({ error: 'REASON_REQUIRED' }, { status: 400 })
  }

  const sb = await getSupabaseServer()
  const { error } = await sb.rpc('attendance_backdate_decide', {
    p_id: id,
    p_approve: action === 'approve',
    p_reason: action === 'reject' ? reason : null,
  })
  if (error) {
    const code = backdateDbCode(error.message)
    if (code) return NextResponse.json({ error: code }, { status: statusOf(code) })
    console.error('[attendance] ตัดสินคำขอย้อนหลังไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

/** DELETE /api/attendance/backdate/[id] — ยกเลิกคำขอของตัวเอง (ตอนยังรออนุมัติ) */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })

  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  const sb = await getSupabaseServer()
  const { error } = await sb.rpc('attendance_backdate_cancel', { p_id: id })
  if (error) {
    const code = backdateDbCode(error.message)
    if (code) return NextResponse.json({ error: code }, { status: statusOf(code) })
    console.error('[attendance] ยกเลิกคำขอย้อนหลังไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'DELETE_FAILED' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
