import { NextResponse, type NextRequest } from 'next/server'
import { listPaymentTypes, listStores } from '@/lib/loyverse/client'
import { loyverseErrorResponse } from '@/lib/loyverse/errors'
import { denyUnlessOwner } from '@/lib/loyverse/owner-guard'
import { getSupabaseServer } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * PUT /api/settings/loyverse/config — เลือกร้าน + วิธีชำระเงิน "เบิกใช้งาน"
 * 🔴 ไม่เชื่อชื่อที่หน้าจอส่งมา — ถาม Loyverse ใหม่ว่า id นี้มีจริงและชื่ออะไร
 */
export async function PUT(req: NextRequest) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  let storeId = ''
  let paymentTypeId = ''
  try {
    const b = await req.json()
    storeId = String(b?.storeId ?? '').trim()
    paymentTypeId = String(b?.paymentTypeId ?? '').trim()
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }
  if (!storeId || !paymentTypeId) return NextResponse.json({ error: 'CONFIG_EMPTY' }, { status: 400 })

  let storeName: string | null = null
  let paymentName: string | null = null
  try {
    const [stores, payments] = await Promise.all([listStores(), listPaymentTypes()])
    const s = stores.find((x) => x.id === storeId)
    const p = payments.find((x) => x.id === paymentTypeId && !x.deleted_at)
    if (!s) return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 400 })
    if (!p) return NextResponse.json({ error: 'PAYMENT_NOT_FOUND' }, { status: 400 })
    storeName = s.name ?? null
    paymentName = p.name ?? p.type ?? null
  } catch (e) {
    return loyverseErrorResponse(e, 'อ่านร้าน/วิธีชำระเงินไม่สำเร็จ')
  }

  const sb = await getSupabaseServer()
  const { data, error } = await sb
    .from('pos_settings')
    .update({
      store_id: storeId,
      store_name: storeName,
      withdraw_payment_type_id: paymentTypeId,
      withdraw_payment_type_name: paymentName,
    })
    .eq('id', true)
    .select('id')
  if (error || !data?.length) {
    console.error('[loyverse-config] บันทึกไม่สำเร็จ', error?.message ?? 'ไม่มีแถวถูกแก้')
    return NextResponse.json({ error: 'SAVE_FAILED' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
