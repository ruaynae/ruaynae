import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/transactions'
import { planFromRow, PLAN_COLUMNS } from '@/lib/boq/plan-store'
import { dbFail } from '@/lib/plans-server'

export const runtime = 'nodejs'

/**
 * GET /api/letters/boq — รายการจาก BOQ ที่บันทึกไว้ (เมนูแผนงาน) ให้ตารางงานเพิ่ม-ลดดึงไปใช้ (R25)
 * · เรียกจากปุ่ม "เลือกจาก BOQ" ในหน้าหนังสือแบบ "งานเพิ่ม / งานลด" · เจ้าของเท่านั้น (เหมือนเมนูแผนงาน)
 * · ไม่ส่ง `planId` = รายชื่อแผนงานทั้งหมด (ไม่มีรายการ · แผนของโครงการนี้อยู่บนสุด)
 * · ส่ง `planId` = หมวด → งาน → รายการของแผนนั้น + Factor F
 */
export async function GET(req: NextRequest) {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const sb = await getSupabaseServer()
  const planId = req.nextUrl.searchParams.get('planId')

  if (!planId) {
    const { data, error } = await sb
      .from('construction_plans')
      .select('id, name, site_id, factor, updated_at')
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true })
      .range(0, 199)
    if (error) return dbFail('อ่านรายชื่อแผนงานไม่ได้', error, 'LOAD_FAILED')
    return NextResponse.json({
      plans: (data ?? []).map((p) => ({
        id: p.id, name: p.name, siteId: p.site_id, factor: p.factor == null ? null : Number(p.factor),
      })),
    })
  }

  if (!isUuid(planId)) return NextResponse.json({ error: 'PLAN_NOT_FOUND' }, { status: 404 })
  const { data, error } = await sb.from('construction_plans').select(PLAN_COLUMNS).eq('id', planId).maybeSingle()
  if (error) return dbFail('อ่านแผนงานไม่ได้', error, 'LOAD_FAILED')
  const plan = data ? planFromRow(data as Record<string, unknown>) : null
  if (!plan) return NextResponse.json({ error: 'PLAN_NOT_FOUND' }, { status: 404 })

  return NextResponse.json({
    factor: plan.factor,
    categories: plan.categories.map((c) => ({
      name: c.name,
      tasks: c.tasks.map((t) => ({
        name: t.name,
        items: t.items.map((i) => ({ code: i.code, name: i.name, qty: i.qty, unit: i.unit, amount: i.amount, head: i.head ?? '' })),
      })),
    })),
  })
}
