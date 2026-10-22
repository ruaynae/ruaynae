import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { deleteObject, headObject } from '@/lib/r2'
import { isUuid } from '@/lib/transactions'
import { LETTER_LIMITS } from '@/lib/letters'
import { isLetterPhotosMissing } from '@/lib/letter-photos-server'

export const runtime = 'nodejs'

const KEY = /^letters\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/

/**
 * PUT /api/letters/[id]/photos — เก็บรูปแนบท้ายหนังสือ (เจ้าของ · เรียกหลังบันทึกหนังสือทุกครั้งที่มีรูป)
 * body `{ title, layout, photos: [{ key, caption }] }` — รายการทั้งชุดตามลำดับ (แทนของเดิม)
 * · คีย์ใหม่ต้องมี `upload_intents` ของคนนี้ที่ยังไม่ถูกใช้ และไฟล์ต้องอยู่ใน R2 จริง
 * · รูปที่ถูกเอาออกจากรายการ = ลบไฟล์ใน R2 ด้วย
 * · ยังไม่รัน migration → 503 `LETTER_PHOTOS_TABLE_MISSING` (หนังสือบันทึกแล้ว แค่รูปยังไม่ถูกเก็บ)
 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'LETTER_NOT_FOUND' }, { status: 404 })

  let body: { title?: unknown; layout?: unknown; photos?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }
  const list = Array.isArray(body.photos) ? body.photos : null
  if (!list || list.length > LETTER_LIMITS.photos) return NextResponse.json({ error: 'LETTER_PHOTOS_TOO_MANY' }, { status: 422 })
  const photos = list.map((p) => ({
    key: typeof p?.key === 'string' ? p.key : '',
    caption: typeof p?.caption === 'string' ? p.caption.trim().slice(0, 200) : '',
  }))
  if (photos.some((p) => !KEY.test(p.key)) || new Set(photos.map((p) => p.key)).size !== photos.length) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : ''
  const layout = body.layout === '2' ? '2' : '1'

  const sb = await getSupabaseServer()
  const [{ data: letter, error: lErr }, { data: existing, error: eErr }] = await Promise.all([
    sb.from('letters').select('id').eq('id', id).maybeSingle(),
    sb.from('letter_photos').select('id, object_key').eq('letter_id', id).order('seq').range(0, 11),
  ])
  const missing = isLetterPhotosMissing(lErr) || isLetterPhotosMissing(eErr)
  if (missing) return NextResponse.json({ error: 'LETTER_PHOTOS_TABLE_MISSING' }, { status: 503 })
  if (lErr || eErr) {
    console.error('[letters] อ่านรูปแนบก่อนบันทึกไม่ได้', (lErr ?? eErr)?.message)
    return NextResponse.json({ error: 'PHOTOS_SAVE_FAILED' }, { status: 500 })
  }
  if (!letter) return NextResponse.json({ error: 'LETTER_NOT_FOUND' }, { status: 404 })

  const had = new Set((existing ?? []).map((r) => r.object_key))
  const fresh = photos.filter((p) => !had.has(p.key))

  // 🔴 คีย์ใหม่ต้องเป็นของคนนี้ (upload_intents · RLS เห็นแค่ของตัวเอง) และไฟล์ต้องมีจริง
  const sizes = new Map<string, number>()
  const intentIds: string[] = []
  for (const p of fresh) {
    const { data: intent, error } = await sb
      .from('upload_intents').select('id').eq('object_key', p.key).is('consumed_at', null).maybeSingle()
    if (error) {
      console.error('[letters] อ่าน upload_intents ไม่ได้', error.message)
      return NextResponse.json({ error: 'PHOTOS_SAVE_FAILED' }, { status: 500 })
    }
    if (!intent) return NextResponse.json({ error: 'INTENT_NOT_FOUND' }, { status: 404 })
    const head = await headObject(p.key)
    if (!head) return NextResponse.json({ error: 'FILE_NOT_UPLOADED' }, { status: 422 })
    sizes.set(p.key, head.size)
    intentIds.push(intent.id)
  }

  // แทนทั้งชุด: ลบแถวเดิม → ใส่ตามลำดับใหม่ (seq ต้องไม่ชนกันระหว่างสลับลำดับ)
  if (existing?.length) {
    const { error } = await sb.from('letter_photos').delete().eq('letter_id', id)
    if (error) {
      console.error('[letters] ลบรูปแนบเดิมไม่ได้', error.message)
      return NextResponse.json({ error: 'PHOTOS_SAVE_FAILED' }, { status: 500 })
    }
  }
  if (photos.length) {
    const { error } = await sb.from('letter_photos').insert(
      photos.map((p, i) => ({ letter_id: id, seq: i + 1, object_key: p.key, caption: p.caption, byte_size: sizes.get(p.key) ?? 0 })),
    )
    if (error) {
      console.error('[letters] บันทึกรูปแนบไม่ได้', error.message)
      return NextResponse.json({ error: 'PHOTOS_SAVE_FAILED' }, { status: 500 })
    }
  }
  const { error: mErr } = await sb.from('letters').update({ photo_title: title, photo_layout: layout }).eq('id', id)
  if (mErr) console.error('[letters] บันทึกหัวข้อรูปแนบไม่ได้', mErr.message)

  if (intentIds.length) {
    const { error } = await sb.from('upload_intents').update({ consumed_at: new Date().toISOString() }).in('id', intentIds)
    if (error) console.error('[letters] ปิด upload_intents ไม่สำเร็จ', error.message)
  }
  // ไฟล์ของรูปที่ถูกเอาออก — แถวหายแล้ว ไฟล์ค้างแค่กินที่ จึง log อย่างเดียว
  const keep = new Set(photos.map((p) => p.key))
  for (const k of had) {
    if (!keep.has(k)) await deleteObject(k).catch((e) => console.error('[letters] ลบไฟล์รูปแนบไม่ได้', k, e instanceof Error ? e.message : e))
  }
  return NextResponse.json({ ok: true })
}
