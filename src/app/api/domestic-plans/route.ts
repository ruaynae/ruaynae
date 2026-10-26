import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner, getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/transactions'
import { parseDomModel, parseDomName } from '@/lib/boq/domestic-store'
import type { Json } from '@/lib/database.types'
import { dbFail, readJson } from '@/lib/plans-server'

export const runtime = 'nodejs'

/**
 * POST /api/domestic-plans — บันทึกแผนการใช้วัสดุในประเทศ (R22b · เจ้าของเท่านั้น)
 * · เรียกจากปุ่ม "บันทึกไว้ในเว็บ" ในแท็บแผนการใช้วัสดุในประเทศ
 * body: `{ name, model, sourceFile?, siteId? }`
 */
export async function POST(req: NextRequest) {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const body = await readJson(req)
  if (!body) return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  const name = parseDomName(body.name)
  if (!name.ok) return NextResponse.json({ error: name.error }, { status: 422 })
  const model = parseDomModel(body.model)
  if (!model.ok) return NextResponse.json({ error: model.error }, { status: 422 })
  const siteId = typeof body.siteId === 'string' && isUuid(body.siteId) ? body.siteId : null
  const sourceFile = typeof body.sourceFile === 'string' ? body.sourceFile.slice(0, 300) : ''

  const sb = await getSupabaseServer()
  const me = await getCurrentUser()
  const { data, error } = await sb
    .from('domestic_plans')
    .insert({ name: name.value, model: model.value as unknown as Json, source_file: sourceFile, site_id: siteId, created_by: me.id })
    .select('id')
    .maybeSingle()
  if (error) {
    if (error.code === '23503') return NextResponse.json({ error: 'SITE_NOT_FOUND' }, { status: 422 })
    return dbFail('บันทึกแผนการใช้วัสดุไม่สำเร็จ', error, 'CREATE_FAILED', 'DOMESTIC_TABLE_MISSING')
  }
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  return NextResponse.json({ ok: true, id: data.id }, { status: 201 })
}
