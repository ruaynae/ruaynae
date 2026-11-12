import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/transactions'
import { readJson } from '@/lib/plans-server'
import { deleteObject } from '@/lib/r2'
import { parseBillPatch } from '@/lib/bills'
import { billDbFail } from '@/lib/bills-server'
import type { Database } from '@/lib/database.types'

export const runtime = 'nodejs'
type Ctx = { params: Promise<{ id: string }> }

/**
 * PATCH /api/bills/[id] — แก้ข้อมูลบิล (ผู้ขาย เลขผู้เสียภาษี เลขที่ วันที่ ยอด VAT · ข้าม/ไม่ข้าม · หมายเหตุ) · เจ้าของ (R41)
 * · แก้ช่องข้อมูล = `read_status` เป็น `manual`
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'BILL_NOT_FOUND' }, { status: 404 })
  const body = await readJson(req)
  if (!body) return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  const p = parseBillPatch(body)
  if (!p.ok) return NextResponse.json({ error: p.error }, { status: 422 })
  const v = p.value
  const row: Database['public']['Tables']['bills']['Update'] = {}
  if ('vendor' in v) row.vendor = v.vendor
  if ('vendorTaxId' in v) row.vendor_tax_id = v.vendorTaxId
  if ('billNo' in v) row.bill_no = v.billNo
  if ('billDate' in v) row.bill_date = v.billDate
  if ('amount' in v) row.amount = v.amount
  if ('vatAmount' in v) row.vat_amount = v.vatAmount
  if ('ignored' in v) row.ignored = v.ignored
  if ('note' in v) row.note = v.note
  if (['vendor', 'vendorTaxId', 'billNo', 'billDate', 'amount', 'vatAmount'].some((k) => k in v)) row.read_status = 'manual'
  if (!Object.keys(row).length) return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  const sb = await getSupabaseServer()
  const { data, error } = await sb.from('bills').update(row).eq('id', id).select('id').maybeSingle()
  if (error) return billDbFail('แก้บิลไม่ได้', error)
  if (!data) return NextResponse.json({ error: 'BILL_NOT_FOUND' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

/** DELETE /api/bills/[id] — ลบบิล (คู่ที่ผูกไว้หลุดตาม · ไฟล์ใน R2 ถูกลบ) · เจ้าของ */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'BILL_NOT_FOUND' }, { status: 404 })
  const sb = await getSupabaseServer()
  const { data, error } = await sb.from('bills').delete().eq('id', id).select('object_key').maybeSingle()
  if (error) return billDbFail('ลบบิลไม่ได้', error)
  if (!data) return NextResponse.json({ error: 'BILL_NOT_FOUND' }, { status: 404 })
  await deleteObject(data.object_key).catch((e) => console.error('[bills] ลบไฟล์บิลไม่ได้', e instanceof Error ? e.message : e))
  return NextResponse.json({ ok: true })
}
