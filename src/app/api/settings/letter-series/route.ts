import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { parseSeriesInput, seriesRow } from '@/lib/letters-server'

export const runtime = 'nodejs'

/** POST /api/settings/letter-series — เพิ่มชุดเลขหนังสือ (ปุ่ม "เพิ่มชุดเลข" ที่ `/settings/letters`) */
export async function POST(req: NextRequest) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

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

  const { data, error } = await sb.from('letter_series').insert(seriesRow(parsed.value)).select('id').maybeSingle()
  if (error) {
    // `letter_series_prefix_uniq` เทียบแบบไม่สนตัวพิมพ์ — `reg` กับ `REG` คือชุดเดียวกันบนกระดาษ
    if (error.code === '23505') return NextResponse.json({ error: 'LETTER_SERIES_PREFIX_TAKEN' }, { status: 409 })
    console.error('[letters] เพิ่มชุดเลขไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  return NextResponse.json({ ok: true, id: data.id }, { status: 201 })
}
