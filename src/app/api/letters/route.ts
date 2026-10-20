import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner, getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { currentLetterhead, isDuplicateNo, letterRow, parseLetterInput } from '@/lib/letters-server'

export const runtime = 'nodejs'

/**
 * POST /api/letters — ลงทะเบียนหนังสือฉบับใหม่ (เจ้าของเท่านั้น)
 *
 * เรียกจากปุ่ม "ดาวน์โหลด Word" และ "พิมพ์" ของฟอร์ม — กดครั้งแรกคือการลงทะเบียน
 * · 🔴 หัวกระดาษถูกแช่แข็งลงแถวตอนนี้ (D4) ไม่ได้ join กลับตอนพิมพ์ซ้ำ
 * · เลขซ้ำในชุด/ปีเดียวกัน = 409 `LETTER_NO_TAKEN` (ฐานข้อมูลกันอีกชั้นด้วย unique)
 */
export async function POST(req: NextRequest) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const parsed = parseLetterInput(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 })

  const sb = await getSupabaseServer()
  const { data: series, error: sErr } = await sb
    .from('letter_series').select('id').eq('id', parsed.value.seriesId).maybeSingle()
  if (sErr) {
    console.error('[letters] อ่านชุดเลขไม่ได้', sErr.message)
    return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
  }
  if (!series) return NextResponse.json({ error: 'LETTER_SERIES_NOT_FOUND' }, { status: 422 })

  const [me, letterhead] = await Promise.all([getCurrentUser(), currentLetterhead()])
  const { data, error } = await sb
    .from('letters')
    .insert({ ...letterRow(parsed.value, letterhead), created_by: me.id })
    .select('id')
    .maybeSingle()

  if (error) {
    if (isDuplicateNo(error)) return NextResponse.json({ error: 'LETTER_NO_TAKEN' }, { status: 409 })
    console.error('[letters] ลงทะเบียนไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  return NextResponse.json({ ok: true, id: data.id }, { status: 201 })
}
