import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/transactions'
import { parseDomModel, parseDomName } from '@/lib/boq/domestic-store'
import type { Database, Json } from '@/lib/database.types'
import { dbFail, readJson } from '@/lib/plans-server'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

/**
 * PATCH /api/domestic-plans/[id] — แก้แผนการใช้วัสดุที่บันทึกไว้ (R22b · เจ้าของเท่านั้น)
 * body: `{ expectedUpdatedAt, name?, model?, sourceFile?, siteId? }` — ส่งเฉพาะส่วนที่แก้
 * · ปุ่ม "บันทึก" (ติ๊กเหล็ก/นำเข้า · ชื่อ · อัปโหลด BOQ ใหม่) และช่องผูกโครงการ
 * · 🔴 `expectedUpdatedAt` ไม่ตรง = 409 `DOMESTIC_CHANGED` (กันสองเครื่องเขียนทับกัน)
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'DOMESTIC_NOT_FOUND' }, { status: 404 })
  const body = await readJson(req)
  if (!body || typeof body.expectedUpdatedAt !== 'string') return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })

  const patch: Database['public']['Tables']['domestic_plans']['Update'] = {}
  if (body.name !== undefined) {
    const name = parseDomName(body.name)
    if (!name.ok) return NextResponse.json({ error: name.error }, { status: 422 })
    patch.name = name.value
  }
  if (body.model !== undefined) {
    const model = parseDomModel(body.model)
    if (!model.ok) return NextResponse.json({ error: model.error }, { status: 422 })
    patch.model = model.value as unknown as Json
  }
  if (typeof body.sourceFile === 'string') patch.source_file = body.sourceFile.slice(0, 300)
  if (body.siteId !== undefined) {
    if (body.siteId !== null && !(typeof body.siteId === 'string' && isUuid(body.siteId))) {
      return NextResponse.json({ error: 'SITE_NOT_FOUND' }, { status: 422 })
    }
    patch.site_id = body.siteId as string | null
  }

  const sb = await getSupabaseServer()
  const { data: row, error: rErr } = await sb.from('domestic_plans').select('updated_at').eq('id', id).maybeSingle()
  if (rErr) return dbFail('อ่านแผนการใช้วัสดุก่อนแก้ไม่ได้', rErr, 'UPDATE_FAILED', 'DOMESTIC_TABLE_MISSING')
  if (!row) return NextResponse.json({ error: 'DOMESTIC_NOT_FOUND' }, { status: 404 })
  if (Date.parse(row.updated_at) !== Date.parse(body.expectedUpdatedAt)) {
    return NextResponse.json({ error: 'DOMESTIC_CHANGED' }, { status: 409 })
  }
  if (!Object.keys(patch).length) return NextResponse.json({ ok: true, updatedAt: row.updated_at })

  const { data, error } = await sb
    .from('domestic_plans')
    .update(patch)
    .eq('id', id)
    .eq('updated_at', row.updated_at)
    .select('updated_at')
    .maybeSingle()
  if (error) {
    if (error.code === '23503') return NextResponse.json({ error: 'SITE_NOT_FOUND' }, { status: 422 })
    return dbFail('แก้แผนการใช้วัสดุไม่สำเร็จ', error, 'UPDATE_FAILED', 'DOMESTIC_TABLE_MISSING')
  }
  // 0 แถว = มีคนแก้ไปก่อนระหว่างที่อ่าน-เขียน (หรือถูกลบ) — ไม่ใช่ "สำเร็จ" (§17 ข้อ 18)
  if (!data) return NextResponse.json({ error: 'DOMESTIC_CHANGED' }, { status: 409 })
  return NextResponse.json({ ok: true, updatedAt: data.updated_at })
}

/** DELETE /api/domestic-plans/[id] — ปุ่ม "ลบแผน" ในหน้าแผนที่บันทึกไว้ (มีกล่องยืนยัน) */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'DOMESTIC_NOT_FOUND' }, { status: 404 })
  const sb = await getSupabaseServer()
  const { data, error } = await sb.from('domestic_plans').delete().eq('id', id).select('id')
  if (error) return dbFail('ลบแผนการใช้วัสดุไม่สำเร็จ', error, 'DELETE_FAILED', 'DOMESTIC_TABLE_MISSING')
  if (!data?.length) return NextResponse.json({ error: 'DOMESTIC_NOT_FOUND' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
