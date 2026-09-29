import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/transactions'
import { payErrorCode } from '@/lib/payroll'

export const runtime = 'nodejs'

/**
 * POST /api/payroll/pay — จ่ายยอดค้างของคนคนหนึ่งให้หมด
 * body: `{ employeeId, bonus?, expected? }`
 *
 * 🔴 งานทั้งหมดอยู่ใน RPC `pay_employee_wage` = ทรานแซกชันเดียว
 * แยกเป็นหลาย request จากที่นี่แล้ววันหนึ่งจะบันทึกว่าจ่ายแล้วสำเร็จ แต่หัก
 * ยอดเบิกไม่สำเร็จ เหลือใบเบิกที่ยังไม่ถูกหักซึ่งจะถูกหักซ้ำในครั้งถัดไป
 *
 * `expected` = เงินสดที่เจ้าของเห็นบนจอก่อนกด · ฐานข้อมูลคำนวณเองแล้วเทียบ
 * ไม่ตรง = `BALANCE_CHANGED` (ไม่จ่ายตัวเลขที่เจ้าของไม่ได้ยืนยัน · R15)
 */
export async function POST(req: NextRequest) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })
  if (me.role !== 'owner') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const employeeId = body.employeeId ?? body.employee_id
  if (!isUuid(employeeId)) {
    return NextResponse.json({ error: 'EMPLOYEE_REQUIRED' }, { status: 400 })
  }
  const bonus = body.bonus === undefined || body.bonus === null ? 0 : Number(body.bonus)
  if (!Number.isFinite(bonus) || bonus < 0) {
    return NextResponse.json({ error: 'BONUS_INVALID' }, { status: 400 })
  }
  const expected = body.expected === undefined || body.expected === null ? undefined : Number(body.expected)
  if (expected !== undefined && !Number.isFinite(expected)) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const sb = await getSupabaseServer()
  const { data, error } = await sb.rpc('pay_employee_wage', {
    p_employee: employeeId,
    p_bonus: bonus,
    ...(expected === undefined ? {} : { p_expected: expected }),
  })

  if (error) {
    const { code, status } = payErrorCode(error.message ?? '')
    if (status === 500) console.error('[payroll] จ่ายค่าแรงไม่สำเร็จ', error.message)
    return NextResponse.json({ error: code }, { status })
  }

  const row = data?.[0]
  return NextResponse.json({
    ok: true,
    days: Number(row?.days ?? 0),
    accrued: Number(row?.accrued ?? 0),
    reimbursed: Number(row?.reimbursed ?? 0),
    bonus: Number(row?.bonus ?? 0),
    deducted: Number(row?.deducted ?? 0),
    paid: Number(row?.paid ?? 0),
  })
}
