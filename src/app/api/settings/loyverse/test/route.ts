import { NextResponse } from 'next/server'
import { getAll, listPaymentTypes, listStores } from '@/lib/loyverse/client'
import { loyverseErrorResponse } from '@/lib/loyverse/errors'
import { denyUnlessOwner } from '@/lib/loyverse/owner-guard'

export const runtime = 'nodejs'

/**
 * POST /api/settings/loyverse/test — ทดสอบโทเคนกับ Loyverse จริง (อ่านอย่างเดียว)
 * คืนรายชื่อร้าน + วิธีชำระเงิน ให้หน้าตั้งค่าเลือก · และนับสินค้าเพื่อยืนยันว่าอ่านสินค้าได้
 */
export async function POST() {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  try {
    const [stores, payments, items] = await Promise.all([
      listStores(),
      listPaymentTypes(),
      getAll('/items', 'items'),
    ])
    return NextResponse.json({
      ok: true,
      stores: stores.filter((s) => s.id).map((s) => ({ id: s.id, name: s.name ?? 'ร้าน' })),
      paymentTypes: payments
        .filter((p) => p.id && !p.deleted_at)
        .map((p) => ({ id: p.id, name: p.name ?? p.type ?? 'วิธีชำระเงิน', type: p.type ?? null })),
      itemCount: items.length,
    })
  } catch (e) {
    return loyverseErrorResponse(e, 'ทดสอบการเชื่อมต่อไม่สำเร็จ')
  }
}
