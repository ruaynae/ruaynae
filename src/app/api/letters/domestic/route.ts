import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/transactions'
import { DOMESTIC_COLUMNS, domesticFromRow } from '@/lib/boq/domestic-store'
import { dbFail } from '@/lib/plans-server'

export const runtime = 'nodejs'

/**
 * GET /api/letters/domestic — แผนการใช้พัสดุในประเทศที่บันทึกไว้ ให้หนังสือ "ขอส่งสรุปการใช้พัสดุในประเทศ" ดึงไปสรุป (R35)
 * · ไม่ส่ง `id` = รายชื่อแผน (แผนของโครงการนี้อยู่บนสุดฝั่งหน้าจอ) · ส่ง `id` = แผนนั้นทั้งโมเดล · เจ้าของเท่านั้น
 */
export async function GET(req: NextRequest) {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const sb = await getSupabaseServer()
  const id = req.nextUrl.searchParams.get('id')
  if (!id) {
    const { data, error } = await sb
      .from('domestic_plans').select('id, name, site_id, updated_at')
      .order('updated_at', { ascending: false }).order('id', { ascending: true }).range(0, 199)
    if (error) return dbFail('อ่านรายชื่อแผนไม่ได้', error, 'LOAD_FAILED', 'DOMESTIC_TABLE_MISSING')
    return NextResponse.json({ plans: (data ?? []).map((p) => ({ id: p.id, name: p.name, siteId: p.site_id })) })
  }
  if (!isUuid(id)) return NextResponse.json({ error: 'PLAN_NOT_FOUND' }, { status: 404 })
  const { data, error } = await sb.from('domestic_plans').select(DOMESTIC_COLUMNS).eq('id', id).maybeSingle()
  if (error) return dbFail('อ่านแผนไม่ได้', error, 'LOAD_FAILED', 'DOMESTIC_TABLE_MISSING')
  const plan = data ? domesticFromRow(data as Record<string, unknown>) : null
  if (!plan) return NextResponse.json({ error: 'PLAN_NOT_FOUND' }, { status: 404 })
  return NextResponse.json({ plan: { id: plan.id, name: plan.name, model: plan.model } })
}
