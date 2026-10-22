import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/transactions'
import { parsePlanInput, parseProgress, planFromRow, planRow, PLAN_COLUMNS } from '@/lib/boq/plan-store'
import type { Database, Json } from '@/lib/database.types'
import { dbFail, readJson } from '@/lib/plans-server'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

/**
 * PATCH /api/plans/[id] — แก้แผนงานที่บันทึกไว้ (เจ้าของเท่านั้น)
 * body: `{ expectedUpdatedAt, plan?, progress?, siteId? }` — ส่งเฉพาะส่วนที่แก้
 * · `plan` จากปุ่ม "บันทึกการแก้ไข" ของหน้าแก้แผน · `progress` จากปุ่มบันทึกผลงานงวด · `siteId` จากช่องผูกโครงการ
 * · 🔴 `expectedUpdatedAt` กันเขียนทับกันระหว่างสองเครื่อง (มือถือหน้างาน + คอมที่ออฟฟิศ) — ไม่ตรง = 409 `PLAN_CHANGED`
 * · แก้จำนวนงวดให้น้อยลง → ผลงานของงวดที่หายไปถูกตัดทิ้ง (ตรวจ progress ซ้ำกับแผนใหม่ทุกครั้ง)
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'PLAN_NOT_FOUND' }, { status: 404 })
  const body = await readJson(req)
  if (!body || typeof body.expectedUpdatedAt !== 'string') return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })

  const sb = await getSupabaseServer()
  const { data: row, error: rErr } = await sb.from('construction_plans').select(PLAN_COLUMNS).eq('id', id).maybeSingle()
  if (rErr) return dbFail('อ่านแผนงานก่อนแก้ไม่ได้', rErr, 'UPDATE_FAILED')
  if (!row) return NextResponse.json({ error: 'PLAN_NOT_FOUND' }, { status: 404 })
  const current = planFromRow(row as Record<string, unknown>)
  if (!current) return NextResponse.json({ error: 'PLAN_NOT_FOUND' }, { status: 404 })
  if (Date.parse(current.updatedAt) !== Date.parse(body.expectedUpdatedAt)) {
    return NextResponse.json({ error: 'PLAN_CHANGED' }, { status: 409 })
  }

  let plan = current as typeof current
  const patch: Database['public']['Tables']['construction_plans']['Update'] = {}
  if (body.plan !== undefined) {
    const parsed = parsePlanInput(body.plan)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 })
    plan = { ...current, ...parsed.value }
    Object.assign(patch, planRow(parsed.value) as Database['public']['Tables']['construction_plans']['Update'])
  }
  if (body.progress !== undefined || body.plan !== undefined) {
    const pr = parseProgress(body.progress ?? current.progress, plan.periods, plan.categories)
    if (!pr.ok) return NextResponse.json({ error: pr.error }, { status: 422 })
    patch.progress = pr.value as unknown as Json
  }
  if (body.siteId !== undefined) {
    if (body.siteId !== null && !(typeof body.siteId === 'string' && isUuid(body.siteId))) {
      return NextResponse.json({ error: 'SITE_NOT_FOUND' }, { status: 422 })
    }
    patch.site_id = body.siteId as string | null
  }
  if (!Object.keys(patch).length) return NextResponse.json({ ok: true, updatedAt: current.updatedAt })

  const { data, error } = await sb
    .from('construction_plans')
    .update(patch)
    .eq('id', id)
    .eq('updated_at', row.updated_at)
    .select('updated_at')
    .maybeSingle()
  if (error) {
    if (error.code === '23503') return NextResponse.json({ error: 'SITE_NOT_FOUND' }, { status: 422 })
    return dbFail('แก้แผนงานไม่สำเร็จ', error, 'UPDATE_FAILED')
  }
  // 0 แถว = มีคนแก้ไปก่อนระหว่างที่อ่าน-เขียน (หรือถูกลบ) — ไม่ใช่ "สำเร็จ" (§17 ข้อ 18)
  if (!data) return NextResponse.json({ error: 'PLAN_CHANGED' }, { status: 409 })
  return NextResponse.json({ ok: true, updatedAt: data.updated_at })
}

/** DELETE /api/plans/[id] — ลบแผนงาน (ปุ่ม "ลบแผนงาน" ในหน้าแผนงาน · มีกล่องยืนยัน) */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'PLAN_NOT_FOUND' }, { status: 404 })
  const sb = await getSupabaseServer()
  const { data, error } = await sb.from('construction_plans').delete().eq('id', id).select('id')
  if (error) return dbFail('ลบแผนงานไม่สำเร็จ', error, 'DELETE_FAILED')
  if (!data?.length) return NextResponse.json({ error: 'PLAN_NOT_FOUND' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
