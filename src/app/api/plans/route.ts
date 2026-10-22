import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner, getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/transactions'
import { parsePlanInput, planRow } from '@/lib/boq/plan-store'
import { dbFail, readJson } from '@/lib/plans-server'

export const runtime = 'nodejs'

/**
 * POST /api/plans — บันทึกแผนงานใหม่ (เจ้าของเท่านั้น) · เรียกจากปุ่ม "บันทึกแผนงาน" ในแท็บสร้างแผนงาน
 * · ตัวตรวจรูปร่างหมวด/งาน/รายการอยู่ที่ `plan-store.ts` — ตัวสร้าง Excel เชื่อข้อมูลนี้โดยไม่ตรวจซ้ำ
 */
export async function POST(req: NextRequest) {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const body = await readJson(req)
  if (!body) return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  const parsed = parsePlanInput(body.plan)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 })
  const siteId = typeof body.siteId === 'string' && isUuid(body.siteId) ? body.siteId : null

  const sb = await getSupabaseServer()
  const me = await getCurrentUser()
  const { data, error } = await sb
    .from('construction_plans')
    .insert({ ...planRow(parsed.value), site_id: siteId, created_by: me.id })
    .select('id')
    .maybeSingle()
  if (error) {
    if (error.code === '23503') return NextResponse.json({ error: 'SITE_NOT_FOUND' }, { status: 422 })
    return dbFail('บันทึกแผนงานไม่สำเร็จ', error, 'CREATE_FAILED')
  }
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  return NextResponse.json({ ok: true, id: data.id }, { status: 201 })
}
