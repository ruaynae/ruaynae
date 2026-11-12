import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/transactions'
import { readJson } from '@/lib/plans-server'
import { billDbFail } from '@/lib/bills-server'

export const runtime = 'nodejs'

/**
 * PATCH /api/bills/no-bill — ตั้งรายจ่ายรายใบว่า "ไม่ต้องมีบิล" (หรือเอากลับ) · เจ้าของ (R41)
 * body `{ transactionId, notRequired }` · เรียกจากปุ่มในแท็บ "ค่าใช้จ่ายที่ยังไม่ได้บิล"
 */
export async function PATCH(req: NextRequest) {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const body = await readJson(req)
  const tid = body?.transactionId
  if (typeof tid !== 'string' || !isUuid(tid) || typeof body?.notRequired !== 'boolean') return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  const sb = await getSupabaseServer()
  const { data, error } = await sb.from('transactions').update({ bill_not_required: body.notRequired }).eq('id', tid).eq('kind', 'expense').select('id').maybeSingle()
  if (error) return billDbFail('ตั้งค่าไม่ได้', error)
  if (!data) return NextResponse.json({ error: 'TXN_NOT_FOUND' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
