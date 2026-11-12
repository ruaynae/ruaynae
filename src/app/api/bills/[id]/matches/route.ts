import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/transactions'
import { readJson } from '@/lib/plans-server'
import { billDbFail, candidatesFor, loadCheckFrom, loadTxnPool } from '@/lib/bills-server'

export const runtime = 'nodejs'
type Ctx = { params: Promise<{ id: string }> }

/**
 * GET /api/bills/[id]/matches — คู่ที่ผูกแล้ว + ผู้สมัครที่ระบบแนะนำ (เรียงคะแนน) · เจ้าของ (R41)
 * POST `{ transactionId }` = ผูกเอง (manual) · DELETE `?transactionId=` = ยกเลิกคู่
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'BILL_NOT_FOUND' }, { status: 404 })
  const sb = await getSupabaseServer()
  const { data: bill, error } = await sb.from('bills').select('id, amount, bill_date, vendor').eq('id', id).maybeSingle()
  if (error) return billDbFail('อ่านบิลไม่ได้', error)
  if (!bill) return NextResponse.json({ error: 'BILL_NOT_FOUND' }, { status: 404 })
  const { data: links, error: lErr } = await sb.from('bill_matches').select('transaction_id, matched_by').eq('bill_id', id).order('created_at').range(0, 99)
  if (lErr) return billDbFail('อ่านคู่ของบิลไม่ได้', lErr)
  const from = await loadCheckFrom(sb)
  const pool = await loadTxnPool(sb, from)
  if (!pool.ok) return billDbFail('อ่านรายจ่ายไม่ได้', pool.error)
  const byId = new Map(pool.rows.map((t) => [t.id, t]))
  const view = (tid: string) => {
    const t = byId.get(tid)
    return t ? { id: t.id, date: t.date, total: t.total, remaining: t.amount, note: t.note, category: t.category, site: t.site, status: t.status, billCount: t.billCount } : { id: tid, date: null, total: null, remaining: null, note: 'รายจ่ายก่อนวันเริ่มตรวจ/ถูกลบ', category: '', site: '', status: '', billCount: 0 }
  }
  const linked = new Set((links ?? []).map((l) => l.transaction_id))
  return NextResponse.json({
    matches: (links ?? []).map((l) => ({ ...view(l.transaction_id), matchedBy: l.matched_by })),
    candidates: candidatesFor(bill, pool.rows).filter((c) => !linked.has(c.txnId)).map((c) => ({ ...view(c.txnId), score: c.score, exact: c.exact, days: c.days })),
  })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const { id } = await ctx.params
  const body = await readJson(req)
  const tid = body?.transactionId
  if (!isUuid(id) || typeof tid !== 'string' || !isUuid(tid)) return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  const sb = await getSupabaseServer()
  const { data: txn, error: tErr } = await sb.from('transactions').select('id, kind').eq('id', tid).maybeSingle()
  if (tErr) return billDbFail('อ่านรายจ่ายไม่ได้', tErr)
  if (!txn || txn.kind !== 'expense') return NextResponse.json({ error: 'TXN_NOT_FOUND' }, { status: 404 })
  const { error } = await sb.from('bill_matches').upsert({ bill_id: id, transaction_id: tid, matched_by: 'manual' }, { onConflict: 'bill_id,transaction_id' })
  if (error) {
    if (error.code === '23503') return NextResponse.json({ error: 'BILL_NOT_FOUND' }, { status: 404 })
    return billDbFail('ผูกบิลไม่ได้', error)
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const { id } = await ctx.params
  const tid = req.nextUrl.searchParams.get('transactionId')
  if (!isUuid(id) || !tid || !isUuid(tid)) return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  const sb = await getSupabaseServer()
  const { error } = await sb.from('bill_matches').delete().eq('bill_id', id).eq('transaction_id', tid)
  if (error) return billDbFail('ยกเลิกคู่ไม่ได้', error)
  return NextResponse.json({ ok: true })
}
