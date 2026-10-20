import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getBranding } from '@/lib/branding'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/transactions'
import { buildLetterDocx, type DocxPhoto } from '@/lib/letter-docx'
import { loadLogo, normalizePhoto } from '@/lib/letter-images'
import { currentLetterhead } from '@/lib/letters-server'
import {
  LETTER_LIMITS, asLetterhead, formatLetterNo, letterFileName, type LetterPaperData,
} from '@/lib/letters'

export const runtime = 'nodejs'

/**
 * POST /api/letters/[id]/docx — ไฟล์ Word ของหนังสือที่ลงทะเบียนแล้ว
 *
 * multipart: `photo` (หลายไฟล์ · ไม่บังคับ) · `captions` (JSON array) ·
 * `photoTitle` · `photoLayout` ('1' | '2')
 *
 * 🔴 สร้างจากแถวในฐานข้อมูล ไม่ใช่จากที่ฟอร์มส่งมา — ไฟล์ที่ได้จึงตรงกับทะเบียนเสมอ
 * · รูปแนบไม่ถูกเก็บที่ไหน (D9) · โลโก้อ่านจาก R2 ไม่ได้ = ไฟล์ไม่มีโลโก้ ไม่ใช่ 500
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
      signer_title, show_receipt, letterhead, letter_series(prefix)
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
  let photoLayout: '1' | '2' = '1'
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
    photoTitle = String(form.get('photoTitle') ?? '').trim().slice(0, 200)
    photoLayout = form.get('photoLayout') === '2' ? '2' : '1'

    for (const [i, f] of files.entries()) {
      if (f.size > LETTER_LIMITS.photoBytes) {
        return NextResponse.json({ error: 'LETTER_PHOTOS_TOO_LARGE' }, { status: 413 })
      }
      try {
        const img = await normalizePhoto(await f.arrayBuffer())
        const caption = Array.isArray(captions) ? String(captions[i] ?? '').trim().slice(0, 200) : ''
        photos.push({ ...img, caption })
      } catch {
        return NextResponse.json({ error: 'LETTER_PHOTO_INVALID' }, { status: 422 })
      }
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
    const file = await buildLetterDocx({ letter, logo, photos, photoTitle, photoLayout })
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
