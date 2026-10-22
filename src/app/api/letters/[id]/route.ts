import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/transactions'
import { currentLetterhead, isDuplicateNo, letterRow, parseLetterInput } from '@/lib/letters-server'
import { asLetterhead } from '@/lib/letters'
import { loadLetterPhotos } from '@/lib/letter-photos-server'
import { deleteObject } from '@/lib/r2'

export const runtime = 'nodejs'

/**
 * PATCH /api/letters/[id] — แก้หนังสือที่ลงทะเบียนแล้ว (D10: แก้ได้เสมอ · ร่องรอยอยู่ที่ audit_log)
 *
 * 🔴 หัวกระดาษ **ไม่ถูกถ่ายสำเนาใหม่** ตอนแก้ (D4) — แก้คำผิดในเนื้อความของฉบับเมื่อปีที่แล้ว
 * ต้องไม่ทำให้ที่อยู่บนหัวกระดาษเปลี่ยนเป็นที่อยู่ปัจจุบันเงียบ ๆ · ถ่ายเฉพาะฉบับที่ยังไม่มีสำเนา
 * (นำเข้ามาโดยไม่มีหัวกระดาษ)
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'LETTER_NOT_FOUND' }, { status: 404 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const parsed = parseLetterInput(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 })

  const sb = await getSupabaseServer()
  const [{ data: series }, { data: before, error: bErr }] = await Promise.all([
    sb.from('letter_series').select('id').eq('id', parsed.value.seriesId).maybeSingle(),
    sb.from('letters').select('letterhead').eq('id', id).maybeSingle(),
  ])
  if (bErr) {
    console.error('[letters] อ่านหนังสือก่อนแก้ไม่ได้', bErr.message)
    return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
  }
  if (!before) return NextResponse.json({ error: 'LETTER_NOT_FOUND' }, { status: 404 })
  if (!series) return NextResponse.json({ error: 'LETTER_SERIES_NOT_FOUND' }, { status: 422 })

  const stored = asLetterhead(before.letterhead)
  const letterhead = stored.companyName ? stored : await currentLetterhead()
  const { data, error } = await sb
    .from('letters')
    .update(letterRow(parsed.value, letterhead))
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) {
    if (isDuplicateNo(error)) return NextResponse.json({ error: 'LETTER_NO_TAKEN' }, { status: 409 })
    console.error('[letters] แก้ไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
  }
  // RLS ตัดเหลือ 0 แถว = ไม่มีหนังสือนี้แล้ว (หรือไม่ใช่เจ้าของ) — ไม่ใช่ "สำเร็จ" (§17 ข้อ 18)
  if (!data) return NextResponse.json({ error: 'LETTER_NOT_FOUND' }, { status: 404 })
  return NextResponse.json({ ok: true, id: data.id })
}

/** DELETE /api/letters/[id] — ลบออกจากทะเบียน (สำเนาก่อนลบอยู่ใน audit_log) */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'LETTER_NOT_FOUND' }, { status: 404 })

  const sb = await getSupabaseServer()
  // ไฟล์รูปแนบใน R2 — แถวหายตาม cascade แต่ไฟล์ต้องลบเอง (อ่านก่อนลบหนังสือ)
  const saved = await loadLetterPhotos(sb, id)
  const { data, error } = await sb.from('letters').delete().eq('id', id).select('id')
  if (error) {
    console.error('[letters] ลบไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'DELETE_FAILED' }, { status: 500 })
  }
  if (!data?.length) return NextResponse.json({ error: 'LETTER_NOT_FOUND' }, { status: 404 })
  for (const p of saved.photos) {
    await deleteObject(p.key).catch((e) => console.error('[letters] ลบไฟล์รูปแนบไม่ได้', p.key, e instanceof Error ? e.message : e))
  }
  return NextResponse.json({ ok: true })
}
