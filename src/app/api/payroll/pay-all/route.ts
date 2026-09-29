import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/transactions'
import { failedName, payErrorCode } from '@/lib/payroll'

export const runtime = 'nodejs'

/** เพดานคนต่อครั้ง — กันคำขอที่ยาวผิดปกติ ไม่ใช่ขนาดบริษัท */
const MAX_PEOPLE = 300

/**
 * POST /api/payroll/pay-all — จ่ายหลายคนในทรานแซกชันเดียว (ปุ่ม "จ่ายทุกคน")
 * body: `{ items: [{ employeeId, bonus?, expected }] }`
 *
 * 🔴 คนหนึ่งล้ม = ไม่มีใครถูกจ่ายเลย (RPC `pay_employees`) · ตอบชื่อคนที่ติดกลับไป
 * ให้เจ้าของรู้ว่าต้องดูใคร — ครึ่ง ๆ กลาง ๆ คือสภาพที่เจ้าของไล่ไม่ได้ว่าใครได้เงินแล้ว
 * · `expected` บังคับทุกคน — ปุ่มนี้จ่ายหลายคนพร้อมกัน ห้ามจ่ายตัวเลขที่ไม่ได้เห็น
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

  const raw = Array.isArray(body.items) ? body.items : null
  if (!raw || raw.length === 0 || raw.length > MAX_PEOPLE) {
    return NextResponse.json({ error: 'NOTHING_TO_PAY' }, { status: 400 })
  }

  const seen = new Set<string>()
  const items: { employee_id: string; bonus: number; expected: number }[] = []
  for (const it of raw as Record<string, unknown>[]) {
    const id = it?.employeeId ?? it?.employee_id
    if (!isUuid(id) || seen.has(id)) return NextResponse.json({ error: 'EMPLOYEE_REQUIRED' }, { status: 400 })
    seen.add(id)
    const bonus = it.bonus === undefined || it.bonus === null ? 0 : Number(it.bonus)
    if (!Number.isFinite(bonus) || bonus < 0) return NextResponse.json({ error: 'BONUS_INVALID' }, { status: 400 })
    const expected = Number(it.expected)
    if (it.expected === undefined || it.expected === null || !Number.isFinite(expected)) {
      return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
    }
    items.push({ employee_id: id, bonus, expected })
  }

  const sb = await getSupabaseServer()
  const { data, error } = await sb.rpc('pay_employees', { p_items: items })

  if (error) {
    const msg = error.message ?? ''
    const { code, status } = payErrorCode(msg)
    if (status === 500) console.error('[payroll] จ่ายทุกคนไม่สำเร็จ', msg)
    return NextResponse.json({ error: code, name: failedName(msg) }, { status })
  }

  const rows = data ?? []
  return NextResponse.json({
    ok: true,
    people: rows.length,
    paid: rows.reduce((s, r) => s + Number(r.paid ?? 0), 0),
  })
}
