import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/transactions'
import { getObjectBytes } from '@/lib/r2'
import { readBill } from '@/lib/slip-ai/gemini'
import { todayInBangkok } from '@/lib/format'
import { autoMatch, billDbFail } from '@/lib/bills-server'

export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * POST /api/bills/[id]/read — ให้ AI อ่านบิล (Gemini · คีย์เดียวกับอ่านสลิป) แล้วจับคู่อัตโนมัติถ้าชัดเจน · เจ้าของ (R41)
 * · ไม่มีคีย์ = 409 `BILL_AI_OFF` · โควตาหมด = 429 `BILL_AI_QUOTA` (บิลยังเป็น "รออ่าน" กดอ่านใหม่ทีหลังได้)
 * · อ่านไม่ได้ = `read_status` failed (เจ้าของกรอกเอง) · ช่องที่เจ้าของแก้เองแล้ว (manual) ไม่ถูกทับ
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'BILL_NOT_FOUND' }, { status: 404 })
  const sb = await getSupabaseServer()
  const { data: bill, error } = await sb.from('bills').select('id, object_key, content_type, read_status, ignored').eq('id', id).maybeSingle()
  if (error) return billDbFail('อ่านบิลไม่ได้', error)
  if (!bill) return NextResponse.json({ error: 'BILL_NOT_FOUND' }, { status: 404 })
  if (bill.read_status === 'manual') return NextResponse.json({ ok: true, status: 'manual' })

  const bytes = await getObjectBytes(bill.object_key)
  if (!bytes) return NextResponse.json({ error: 'FILE_NOT_UPLOADED' }, { status: 422 })
  const r = await readBill(Buffer.from(bytes), bill.content_type, todayInBangkok())
  if (!r.ok) {
    if (r.reason === 'OFF' || r.reason === 'KEY_REJECTED') return NextResponse.json({ error: 'BILL_AI_OFF' }, { status: 409 })
    if (r.reason === 'QUOTA') return NextResponse.json({ error: 'BILL_AI_QUOTA' }, { status: 429 })
    if (r.reason === 'ERROR') return NextResponse.json({ error: 'BILL_AI_FAILED' }, { status: 502 })
    await sb.from('bills').update({ read_status: 'failed' }).eq('id', id)
    return NextResponse.json({ ok: true, status: 'failed' })
  }
  const v = r.read
  const { data: saved, error: uErr } = await sb
    .from('bills')
    .update({ vendor: v.vendor, vendor_tax_id: v.taxId, bill_no: v.billNo, bill_date: v.date, amount: v.amount, vat_amount: v.vat, read_status: 'read' })
    .eq('id', id)
    .select('id, amount, bill_date, vendor, ignored')
    .maybeSingle()
  if (uErr) return billDbFail('บันทึกผลอ่านบิลไม่ได้', uErr)
  const matched = saved ? await autoMatch(sb, saved) : null
  return NextResponse.json({ ok: true, status: 'read', read: v, matched })
}
