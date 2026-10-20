import 'server-only'

import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/transactions'
import { LETTER_LIMITS, splitLines, stripItemNo, type Letterhead } from '@/lib/letters'

/**
 * ฝั่งเซิร์ฟเวอร์ของหนังสือบริษัท (R19) — สำเนาหัวกระดาษ และตัวตรวจข้อมูลจากฟอร์ม
 */

/**
 * หัวกระดาษ ณ ตอนนี้ — ชื่อห้างจาก `branding` · ที่อยู่/โทร/ผู้ลงนามจาก `app_settings`
 *
 * 🔴 ไม่มีค่าสำรองเป็นชื่อบริษัทในโค้ด (§5) — ยังไม่ได้ตั้ง = ช่องว่าง
 * แล้วหน้าฟอร์มบอกให้ไปตั้งที่ `/settings/documents`
 */
export async function currentLetterhead(): Promise<Letterhead> {
  const sb = await getSupabaseServer()
  const [{ data: branding, error: bErr }, { data: settings, error: sErr }] = await Promise.all([
    sb.from('branding').select('company_name').maybeSingle(),
    sb.from('app_settings').select('address, phone, signatory_name').maybeSingle(),
  ])
  if (bErr) console.error('[letters] อ่านแบรนด์ไม่ได้', bErr.message)
  if (sErr) console.error('[letters] อ่านตั้งค่าไม่ได้', sErr.message)

  // ที่อยู่ใน `/settings/documents` เป็นหลายบรรทัดได้ · หัวหนังสือเป็นบรรทัดเดียวตามต้นฉบับ
  const address = (settings?.address ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean).join(' ')
  const phone = (settings?.phone ?? '').trim()
  return {
    companyName: branding?.company_name?.trim() ?? '',
    address: [address, phone ? `โทร ${phone}` : ''].filter(Boolean).join(' '),
    signerName: settings?.signatory_name?.trim() ?? '',
  }
}

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

export type LetterInput = {
  seriesId: string
  seq: number
  letterDate: string
  subject: string
  recipient: string
  refs: string[]
  attachments: string[]
  body: string
  closing: string
  intro: string | null
  signerTitle: string
  showReceipt: boolean
  templateId: string | null
  fields: Record<string, string>
}

export type ParsedLetter = { ok: true; value: LetterInput } | { ok: false; error: string }

/** รายการทีละบรรทัด — รับได้ทั้ง array และข้อความหลายบรรทัด · ตัดเลขข้อที่พิมพ์มาเอง */
function items(v: unknown): string[] | null {
  const raw = Array.isArray(v) ? v.map((x) => String(x ?? '')) : splitLines(String(v ?? ''))
  const out = raw.map((s) => stripItemNo(s.trim())).filter(Boolean)
  if (out.length > LETTER_LIMITS.refs || out.some((s) => s.length > LETTER_LIMITS.item)) return null
  return out
}

/** ตรวจข้อมูลจากฟอร์ม — ข้อความผิดรูปตอบเป็นรหัส ไม่ปล่อยให้ check ของฐานข้อมูลเด้งเป็น 500 */
export function parseLetterInput(body: Record<string, unknown>): ParsedLetter {
  if (!isUuid(body.seriesId)) return { ok: false, error: 'LETTER_SERIES_REQUIRED' }

  const seq = Number(body.seq)
  if (!Number.isInteger(seq) || seq < 1 || seq > 99999) return { ok: false, error: 'LETTER_SEQ_INVALID' }

  if (!isDate(body.letterDate)) return { ok: false, error: 'DATE_INVALID' }
  // ปีเกิน 2200 = กรอก พ.ศ. ลงไป · ฐานข้อมูลรับได้แต่วันเพี้ยน 543 ปี (§15)
  if (Number(body.letterDate.slice(0, 4)) > 2200) return { ok: false, error: 'DATE_BUDDHIST_ERA' }

  const subject = String(body.subject ?? '').trim()
  if (!subject) return { ok: false, error: 'LETTER_SUBJECT_REQUIRED' }
  const recipient = String(body.recipient ?? '').trim()
  if (!recipient) return { ok: false, error: 'LETTER_RECIPIENT_REQUIRED' }

  const refs = items(body.refs)
  const attachments = items(body.attachments)
  const text = String(body.body ?? '').trim()
  const closing = String(body.closing ?? '').trim()
  const intro = body.intro === null ? null : String(body.intro ?? '').trim()
  const signerTitle = String(body.signerTitle ?? '').trim()
  if (
    !refs || !attachments ||
    subject.length > LETTER_LIMITS.subject || recipient.length > LETTER_LIMITS.recipient ||
    text.length > LETTER_LIMITS.body || closing.length > LETTER_LIMITS.closing ||
    (intro?.length ?? 0) > LETTER_LIMITS.intro || signerTitle.length > LETTER_LIMITS.signerTitle
  ) {
    return { ok: false, error: 'LETTER_TOO_LONG' }
  }

  const templateId = typeof body.templateId === 'string' && /^[a-z0-9-]{1,40}$/.test(body.templateId)
    ? body.templateId
    : null

  // ค่าช่องด่วน — เก็บเฉพาะคีย์สั้น ๆ ค่าเป็นข้อความ (ใช้นับ "ครั้งที่" ตอนทำซ้ำ)
  const fields: Record<string, string> = {}
  if (body.fields && typeof body.fields === 'object' && !Array.isArray(body.fields)) {
    for (const [k, v] of Object.entries(body.fields as Record<string, unknown>).slice(0, 12)) {
      if (/^[A-Za-z]{1,20}$/.test(k)) fields[k] = String(v ?? '').slice(0, 300)
    }
  }

  return {
    ok: true,
    value: {
      seriesId: body.seriesId,
      seq,
      letterDate: body.letterDate,
      subject,
      recipient,
      refs,
      attachments,
      body: text,
      closing,
      intro: intro || null,
      signerTitle,
      showReceipt: body.showReceipt !== false,
      templateId,
      fields,
    },
  }
}

/** แถวที่จะเขียนลง `letters` (ใช้ทั้ง insert และ update) */
export const letterRow = (v: LetterInput, letterhead: Letterhead) => ({
  series_id: v.seriesId,
  seq: v.seq,
  letter_date: v.letterDate,
  subject: v.subject,
  recipient: v.recipient,
  refs: v.refs,
  attachments: v.attachments,
  body: v.body,
  closing: v.closing,
  intro: v.intro,
  signer_title: v.signerTitle,
  show_receipt: v.showReceipt,
  template_id: v.templateId,
  fields: v.fields,
  letterhead,
})

/**
 * `23505` บน `letters` = เลขซ้ำในชุดเดียวกันปีเดียวกัน (`letters_no_uniq`)
 * — ตารางนี้มี unique แค่ตัวนั้นกับ primary key (ซึ่งเราไม่เคยส่งเอง)
 */
export const isDuplicateNo = (e: { code?: string } | null) => e?.code === '23505'

/* ── ชุดเลขหนังสือ (`/settings/letters`) ───────────────────────────────── */

export type SeriesInput = {
  label: string
  prefix: string
  recipient: string
  contractRef: string
  intro: string
  signerTitle: string
  siteId: string | null
  isActive: boolean
}

export type ParsedSeries = { ok: true; value: SeriesInput } | { ok: false; error: string }

export function parseSeriesInput(body: Record<string, unknown>): ParsedSeries {
  const label = String(body.label ?? '').trim()
  if (!label || label.length > 80) return { ok: false, error: 'LETTER_SERIES_LABEL_REQUIRED' }
  const prefix = String(body.prefix ?? '').trim()
  // ตรงกับ check ของตาราง — `/` คือตัวคั่นปีบนกระดาษ
  if (!/^[^\s/]{1,12}$/.test(prefix)) return { ok: false, error: 'LETTER_SERIES_PREFIX_INVALID' }

  const recipient = String(body.recipient ?? '').trim()
  const contractRef = String(body.contractRef ?? '').trim()
  const intro = String(body.intro ?? '').trim()
  const signerTitle = String(body.signerTitle ?? '').trim()
  if (recipient.length > 300 || contractRef.length > 300 || intro.length > 2000 || signerTitle.length > 80) {
    return { ok: false, error: 'LETTER_TOO_LONG' }
  }
  return {
    ok: true,
    value: {
      label, prefix, recipient, contractRef, intro, signerTitle,
      siteId: isUuid(body.siteId) ? body.siteId : null,
      isActive: body.isActive !== false,
    },
  }
}

export const seriesRow = (v: SeriesInput) => ({
  label: v.label,
  prefix: v.prefix,
  recipient: v.recipient,
  contract_ref: v.contractRef,
  intro: v.intro,
  signer_title: v.signerTitle,
  site_id: v.siteId,
  is_active: v.isActive,
})
