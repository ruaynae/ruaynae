import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getBranding } from '@/lib/branding'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/transactions'
import { buildLetterDocx, type DocxPhoto } from '@/lib/letter-docx'
import { loadLogo, normalizePhoto } from '@/lib/letter-images'
import { currentLetterhead } from '@/lib/letters-server'
import { loadLetterPhotos } from '@/lib/letter-photos-server'
import { loadStamp } from '@/lib/material-library-server'
import { maItems, maListRows, maStyleOf, parseMaterialApproval } from '@/lib/material-approval'
import { getObjectBytes } from '@/lib/r2'
import {
  LETTER_LIMITS, asLetterhead, formatLetterNo, letterFileName, photoLayoutOf, type LetterPaperData, type PhotoLayout,
} from '@/lib/letters'

export const runtime = 'nodejs'
/** แค็ตตาล็อกเยอะ (R27 · สูงสุด 60 หน้า) แปลงรูปนานกว่าเดิม */
export const maxDuration = 60

/**
 * POST /api/letters/[id]/docx — ไฟล์ Word ของหนังสือที่ลงทะเบียนแล้ว
 *
 * multipart: `photo` (หลายไฟล์ · ไม่บังคับ) · `captions` (JSON array) ·
 * `photoTitle` · `photoLayout` ('1' | '2' | 'p')
 *
 * 🔴 สร้างจากแถวในฐานข้อมูล ไม่ใช่จากที่ฟอร์มส่งมา — ไฟล์ที่ได้จึงตรงกับทะเบียนเสมอ
 * · รูปแนบที่เก็บไว้กับหนังสือ (`letter_photos`) ใช้ก่อน · ไม่มี = ใช้รูปที่ส่งมากับคำขอ · โลโก้อ่านจาก R2 ไม่ได้ = ไฟล์ไม่มีโลโก้ ไม่ใช่ 500
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'LETTER_NOT_FOUND' }, { status: 404 })

  const sb = await getSupabaseServer()
  const { data: row, error } = await sb
    .from('letters')
    .select(`
      seq, letter_date, year_ce, subject, recipient, refs, attachments, body, closing, intro,
      signer_title, show_receipt, letterhead, fields, letter_series(prefix)
    `)
    .eq('id', id)
    .maybeSingle()
  if (error) {
    console.error('[letters] อ่านหนังสือเพื่อสร้างไฟล์ไม่ได้', error.message)
    return NextResponse.json({ error: 'DOCX_FAILED' }, { status: 500 })
  }
  if (!row) return NextResponse.json({ error: 'LETTER_NOT_FOUND' }, { status: 404 })

  // ── รูปแนบท้าย (ถ้ามี) ──────────────────────────────────────────────
  const photos: DocxPhoto[] = []
  let photoTitle = ''
  let photoLayout: PhotoLayout = '1'
  let copies: 1 | 2 = 1
  if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
    let form: FormData
    try {
      form = await req.formData()
    } catch {
      return NextResponse.json({ error: 'LETTER_PHOTOS_TOO_LARGE' }, { status: 413 })
    }
    const files = form.getAll('photo').filter((f): f is File => f instanceof File)
    if (files.length > LETTER_LIMITS.photos) {
      return NextResponse.json({ error: 'LETTER_PHOTOS_TOO_MANY' }, { status: 422 })
    }
    let captions: unknown = []
    try {
      captions = JSON.parse(String(form.get('captions') ?? '[]'))
    } catch {
      captions = []
    }
    let headings: unknown = []
    try {
      headings = JSON.parse(String(form.get('headings') ?? '[]'))
    } catch {
      headings = []
    }
    photoTitle = String(form.get('photoTitle') ?? '').trim().slice(0, 200)
    photoLayout = photoLayoutOf(form.get('photoLayout'))
    copies = form.get('copies') === '2' ? 2 : 1

    for (const [i, f] of files.entries()) {
      if (f.size > LETTER_LIMITS.photoBytes) {
        return NextResponse.json({ error: 'LETTER_PHOTOS_TOO_LARGE' }, { status: 413 })
      }
      try {
        const img = await normalizePhoto(await f.arrayBuffer())
        const caption = Array.isArray(captions) ? String(captions[i] ?? '').trim().slice(0, 200) : ''
        const heading = Array.isArray(headings) ? String(headings[i] ?? '').trim().slice(0, 200) : ''
        photos.push({ ...img, caption, heading })
      } catch {
        return NextResponse.json({ error: 'LETTER_PHOTO_INVALID' }, { status: 422 })
      }
    }
  }

  // ── รูปที่เก็บไว้กับหนังสือ (23 ต.ค. 2569) มาก่อนรูปที่ส่งมากับคำขอ ─────────
  // ไฟล์ Word จึงออกมาเหมือนเดิมทุกครั้งแม้เปิดหนังสือจากเครื่องอื่น · ยังไม่รัน migration = ใช้ที่ส่งมา
  const saved = await loadLetterPhotos(sb, id)
  if (saved.photos.length) {
    photos.length = 0
    photoTitle = saved.title
    photoLayout = saved.layout
    // ตราประทับ (R27) — อ่านจาก R2 ครั้งเดียว · อ่านไม่ได้ = ออกไฟล์โดยไม่มีตราประทับ ไม่ใช่ 500
    let stamp: Uint8Array | null = null
    if (saved.photos.some((p) => p.stamped)) {
      const { key } = await loadStamp(sb)
      stamp = key ? await getObjectBytes(key).catch(() => null) : null
    }
    // แค็ตตาล็อกหลายสิบหน้า (R27) — อ่าน+แปลงทีละ 4 หน้าพร้อมกัน เรียงลำดับตามเดิม (ทีละหน้าช้าเกินเพดานเวลาของฟังก์ชัน)
    const one = async (p: (typeof saved.photos)[number]): Promise<DocxPhoto | null> => {
      const bytes = await getObjectBytes(p.key)
      if (!bytes) {
        console.error('[letters] อ่านรูปแนบจาก R2 ไม่ได้', p.key)
        return null
      }
      try {
        const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
        return { ...(await normalizePhoto(buf, p.stamped ? stamp : null)), caption: p.caption, heading: p.heading }
      } catch {
        console.error('[letters] รูปแนบเสีย', p.key)
        return null
      }
    }
    for (let i = 0; i < saved.photos.length; i += 4) {
      const got = await Promise.all(saved.photos.slice(i, i + 4).map(one))
      for (const g of got) if (g) photos.push(g)
    }
  }

  // หนังสือที่นำเข้ามาโดยไม่มีหัวกระดาษ → ใช้หัวกระดาษปัจจุบัน
  const stored = asLetterhead(row.letterhead)
  const letterhead = stored.companyName ? stored : await currentLetterhead()
  const prefix = row.letter_series?.prefix ?? ''
  const yearCe = row.year_ce ?? Number(row.letter_date.slice(0, 4))

  const letter: LetterPaperData = {
    letterNo: formatLetterNo(prefix, row.seq, yearCe),
    date: row.letter_date,
    subject: row.subject,
    recipient: row.recipient,
    refs: row.refs,
    attachments: row.attachments,
    intro: row.intro,
    body: row.body,
    closing: row.closing,
    signerTitle: row.signer_title,
    showReceipt: row.show_receipt,
    letterhead,
  }

  try {
    const branding = await getBranding()
    const logo = await loadLogo(branding.logoObjectKey)
    // "แนบรายการ" (หนังสือขออนุมัติใช้วัสดุ) — ตารางสั้นอยู่ใน jsonb `fields` ไม่ใช่เนื้อหา จึงต้องอ่านมาใส่ไฟล์ Word เอง
    const f = row.fields && typeof row.fields === 'object' && !Array.isArray(row.fields) ? (row.fields as Record<string, unknown>) : {}
    const ma = parseMaterialApproval(f.materialApproval)
    const materialList = maStyleOf(typeof f.style === 'string' ? f.style : undefined, maItems(ma).length) === 'list' ? maListRows(ma) : []
    const file = await buildLetterDocx({ letter, logo, photos, photoTitle, photoLayout, materialList, copies })
    const name = letterFileName(prefix, row.seq, row.subject)
    return new NextResponse(new Uint8Array(file), {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        // ชื่อไทยต้องไปทาง `filename*` (RFC 5987) · `filename` ธรรมดาเป็นตัวสำรอง ASCII
        'content-disposition': `attachment; filename="letter.docx"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'cache-control': 'no-store',
      },
    })
  } catch (e) {
    console.error('[letters] สร้างไฟล์ Word ไม่สำเร็จ', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'DOCX_FAILED' }, { status: 500 })
  }
}
