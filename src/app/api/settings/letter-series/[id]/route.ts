import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/transactions'
import { parseSeriesInput, seriesRow } from '@/lib/letters-server'

export const runtime = 'nodejs'

/**
 * PATCH /api/settings/letter-series/[id] — แก้ชุดเลขหนังสือ
 *
 * มีผลกับฉบับถัดไปเท่านั้น — หนังสือที่ลงทะเบียนแล้วถือสำเนาย่อหน้าแนะนำ/ตำแหน่ง
 * ของตัวเอง · เปลี่ยนคำนำหน้าแล้ว เลขที่ของฉบับเก่าบนจอเปลี่ยนตาม (เลขเก็บเป็นตัวเลข)
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'LETTER_SERIES_NOT_FOUND' }, { status: 404 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }
  const parsed = parseSeriesInput(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 })

  const sb = await getSupabaseServer()
  if (parsed.value.siteId) {
    const { data: site } = await sb.from('sites').select('id').eq('id', parsed.value.siteId).maybeSingle()
    if (!site) return NextResponse.json({ error: 'SITE_NOT_FOUND' }, { status: 422 })
  }

  const { data, error } = await sb
    .from('letter_series').update(seriesRow(parsed.value)).eq('id', id).select('id').maybeSingle()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'LETTER_SERIES_PREFIX_TAKEN' }, { status: 409 })
    console.error('[letters] แก้ชุดเลขไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'LETTER_SERIES_NOT_FOUND' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

/**
 * DELETE /api/settings/letter-series/[id] — ลบได้เฉพาะชุดที่ยังไม่มีหนังสือ
 * (FK `on delete restrict` · ชุดที่มีหนังสือให้ปิดใช้งานแทน)
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'LETTER_SERIES_NOT_FOUND' }, { status: 404 })

  const sb = await getSupabaseServer()
  const { data, error } = await sb.from('letter_series').delete().eq('id', id).select('id')
  if (error) {
    if (error.code === '23503') return NextResponse.json({ error: 'LETTER_SERIES_IN_USE' }, { status: 409 })
    console.error('[letters] ลบชุดเลขไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'DELETE_FAILED' }, { status: 500 })
  }
  if (!data?.length) return NextResponse.json({ error: 'LETTER_SERIES_NOT_FOUND' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
