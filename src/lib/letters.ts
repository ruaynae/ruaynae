import { bahtText } from '@/lib/baht-text'
import type { LetterAuto, LetterTemplate } from '@/lib/letter-templates'

/**
 * หนังสือบริษัท (R19) — สูตรที่ใช้ร่วมกันทั้งฟอร์ม กระดาษ ไฟล์ Word และ API
 *
 * ไฟล์ล้วน ไม่มี `'use client'` และไม่แตะฐานข้อมูล — ทั้งสองฝั่ง import จากที่นี่
 * (§17 ข้อ 25) · กระดาษบนจอกับไฟล์ Word ต้องตัดย่อหน้า/ใส่เลขข้อด้วยกติกาเดียวกัน
 */

export const MONTHS_TH = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
] as const

export const DEFAULT_CLOSING = 'จึงเรียนมาเพื่อทราบและโปรดพิจารณาอนุมัติ'
export const CLOSING_OPTIONS = [
  DEFAULT_CLOSING,
  'จึงเรียนมาเพื่อโปรดทราบและดำเนินการต่อไป',
  'จึงเรียนมาเพื่อโปรดพิจารณา',
  'จึงเรียนมาเพื่อโปรดทราบ',
] as const

/** ช่องที่ยังไม่ได้กรอก — เห็นชัดบนกระดาษว่ายังขาดอะไร */
export const BLANK = '……………………'

export const LETTER_LIMITS = {
  subject: 300,
  recipient: 300,
  refs: 10,
  attachments: 10,
  item: 300,
  body: 8000,
  closing: 300,
  intro: 2000,
  signerTitle: 80,
  /** รูปแนบท้ายต่อไฟล์ — คำขอทั้งก้อนต้องไม่ชนเพดาน body ของ Vercel (~4.5 MB) */
  photos: 12,
  photoBytes: 3.6 * 1024 * 1024,
} as const

/** หัวกระดาษ — สำเนาที่แช่แข็งในแถว (`letters.letterhead`) */
export type Letterhead = {
  companyName: string
  /** บรรทัดใต้ชื่อห้าง: ที่อยู่ + โทร */
  address: string
  signerName: string
}

export const emptyLetterhead: Letterhead = { companyName: '', address: '', signerName: '' }

export function asLetterhead(v: unknown): Letterhead {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const s = (x: unknown) => (typeof x === 'string' ? x : '')
  return { companyName: s(o.companyName), address: s(o.address), signerName: s(o.signerName) }
}

/* ── วันที่และเลขที่ ─────────────────────────────────────────────────── */

const parseIso = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null
}

/** ปี ค.ศ. ของวันที่ — ฐานข้อมูลเก็บ ค.ศ. เสมอ (§15) */
export const yearCeOf = (iso: string) => parseIso(iso)?.y ?? new Date().getFullYear()

/** `2026-10-20` → `20 ตุลาคม 2569` */
export function thaiDate(iso: string): string {
  const p = parseIso(iso)
  return p ? `${p.d} ${MONTHS_TH[p.m - 1]} ${p.y + 543}` : ''
}

/** บรรทัดวันที่บนกระดาษ — เว้นสองช่องรอบเลขวันตามต้นฉบับ */
export function letterDateLine(iso: string): string {
  const p = parseIso(iso)
  return p
    ? `วันที่  ${p.d}  เดือน ${MONTHS_TH[p.m - 1]} พ.ศ. ${p.y + 543}`
    : 'วันที่ ……  เดือน …………… พ.ศ. ……'
}

/** `reg` + 48 + 2026 → `reg048/2569` */
export const formatLetterNo = (prefix: string, seq: number, yearCe: number) =>
  `${prefix}${String(seq).padStart(3, '0')}/${yearCe + 543}`

/** ชื่อไฟล์ Word — แบบเดียวกับที่ห้างตั้งเองอยู่แล้ว (`reg001_<เรื่อง>.docx`) */
export function letterFileName(prefix: string, seq: number, subject: string) {
  const s = subject.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 90)
  return `${prefix}${String(seq).padStart(3, '0')}_${s || 'หนังสือ'}.docx`
}

/* ── ข้อความ ────────────────────────────────────────────────────────── */

/** บรรทัดที่ไม่ว่าง — ช่อง "อ้างถึง" "สิ่งที่ส่งมาด้วย" พิมพ์บรรทัดละรายการ */
export const splitLines = (s: string) =>
  s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)

/** ตัดเลขข้อที่ผู้ใช้พิมพ์มาเอง — กระดาษใส่ 1. 2. ให้แล้ว จะได้ไม่ซ้อนเป็น "1. 1." */
export const stripItemNo = (s: string) => s.replace(/^\s*\d+\s*[.)]\s*/, '')

export type BodyBlock =
  | { type: 'p'; text: string }
  | { type: 'li'; mark: string; text: string; last: boolean }

/**
 * เนื้อความ → ย่อหน้า · 1 บรรทัด = 1 ย่อหน้า · ขึ้นต้นด้วย `1.` `2)` `-` = ข้อย่อย
 * (หนังสือ `reg017` มีข้อย่อยสองข้อกลางเนื้อความ)
 */
export function bodyBlocks(body: string): BodyBlock[] {
  const ls = splitLines(body)
  const re = /^(\d+[.)]|[-–•])\s*(.*)$/
  return ls.map((l, i) => {
    const m = re.exec(l)
    if (!m) return { type: 'p', text: l }
    const nextIsItem = i + 1 < ls.length && re.test(ls[i + 1])
    return { type: 'li', mark: m[1].replace(/[–•]/, '-'), text: m[2], last: !nextIsItem }
  })
}

/** "ห้างหุ้นส่วนจำกัด …" → "ห้างฯ" · "บริษัท … จำกัด" → "บริษัทฯ" — คำเรียกซ้ำในย่อหน้าเดียวกัน */
export function companyShortRef(companyName: string): string {
  const n = companyName.trim()
  if (/^ห้าง/.test(n)) return 'ห้างฯ'
  if (/^บริษัท/.test(n)) return 'บริษัทฯ'
  return n
}

export const fillCompany = (text: string, companyName: string) =>
  text.replace(/\{บริษัท\}/g, companyName).replace(/\{ห้างฯ\}/g, companyShortRef(companyName))

/** ตัวเลขเงินบนหนังสือ — ทศนิยมสองตำแหน่ง มีคอมมา */
export function letterMoney(raw: string): string {
  const n = Number(String(raw).replace(/,/g, ''))
  return String(raw).trim() !== '' && Number.isFinite(n)
    ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : ''
}

export type GeneratedText = {
  subject: string
  attachments: string
  body: string
  closing: string
  photoTitle: string
}

/** ข้อความของแบบหนังสือ + ค่าช่องด่วน → ข้อความจริง */
export function generateFromTemplate(
  t: LetterTemplate,
  fields: Record<string, string>,
  companyName: string,
): GeneratedText {
  const vals: Record<string, string> = { ...fields }
  if (t.id === 'change') {
    const n = Number(String(fields.amount ?? '').replace(/,/g, ''))
    vals.amountText = String(fields.amount ?? '').trim() !== '' && Number.isFinite(n) ? bahtText(n) : ''
    vals.amount = letterMoney(fields.amount ?? '')
  }
  const fill = (s: string) =>
    fillCompany(s, companyName).replace(/\{(\w+)\}/g, (_, k: string) => {
      const v = vals[k]
      return v !== undefined && String(v).trim() !== '' ? String(v).trim() : BLANK
    })
  return {
    subject: fill(t.subject),
    attachments: t.atts.map(fill).join('\n'),
    body: fill(t.body),
    closing: t.closing ?? DEFAULT_CLOSING,
    photoTitle: t.photoTitle ? fill(t.photoTitle) : '',
  }
}

/* ── ตัวนับอัตโนมัติจากทะเบียน ───────────────────────────────────────── */

export type RegisterEntry = {
  id: string
  seriesId: string
  seq: number
  yearCe: number
  date: string
  subject: string
}

/** เลขถัดไปของชุดนี้ในปีนี้ = เลขสูงสุด + 1 */
export function nextSeq(entries: readonly RegisterEntry[], seriesId: string, yearCe: number) {
  let max = 0
  for (const e of entries) if (e.seriesId === seriesId && e.yearCe === yearCe && e.seq > max) max = e.seq
  return max + 1
}

function nextCounter(entries: readonly RegisterEntry[], seriesId: string, re: RegExp) {
  let max = 0
  for (const e of entries) {
    if (e.seriesId !== seriesId) continue
    const m = re.exec(e.subject)
    if (m && Number(m[1]) > max) max = Number(m[1])
  }
  return max + 1
}

/** ค่าที่ระบบเติมให้: ครั้งที่ของวัสดุ · งวดที่ส่งมอบ · เดือนที่แล้ว (รายงานความปลอดภัย) */
export function autoFieldValue(
  kind: LetterAuto,
  entries: readonly RegisterEntry[],
  seriesId: string,
  dateIso: string,
): string {
  if (kind === 'materialNext') return String(nextCounter(entries, seriesId, /ขออนุมัติใช้วัสดุ ครั้งที่\s*(\d+)/))
  if (kind === 'deliveryNext') return String(nextCounter(entries, seriesId, /ส่งมอบงานงวดที่\s*(\d+)/))
  const p = parseIso(dateIso) ?? { y: new Date().getFullYear(), m: new Date().getMonth() + 1, d: 1 }
  const m = p.m === 1 ? 12 : p.m - 1
  const y = p.m === 1 ? p.y - 1 : p.y
  return `${MONTHS_TH[m - 1]} ${y + 543}`
}

/** ทำซ้ำหนังสือเก่าเป็นฉบับใหม่ — ขยับ "ครั้งที่/งวดที่/ประจำเดือน" ให้เป็นค่าถัดไป */
export function bumpCounters(text: string, kind: LetterAuto, value: string): string {
  if (kind === 'materialNext') return text.replace(/ครั้งที่\s*\d+/g, `ครั้งที่ ${value}`)
  if (kind === 'deliveryNext') return text.replace(/งวดที่\s*\d+/g, `งวดที่ ${value}`)
  const re = new RegExp(`ประจำเดือน\\s*(${MONTHS_TH.join('|')})\\s*\\d{4}`, 'g')
  return text.replace(re, `ประจำเดือน${value}`)
}

/* ── ข้อมูลที่ฟอร์มส่งมา ─────────────────────────────────────────────── */

/** ตัวหนังสือหนึ่งฉบับตามที่กระดาษ/ไฟล์ Word ต้องใช้ — ไม่ผูกกับรูปแถวในฐานข้อมูล */
export type LetterPaperData = {
  letterNo: string
  date: string
  subject: string
  recipient: string
  refs: string[]
  attachments: string[]
  intro: string | null
  body: string
  closing: string
  signerTitle: string
  showReceipt: boolean
  letterhead: Letterhead
}

/** ข้อความ error ของ API → ภาษาไทยบนจอ (§17 ข้อ 13) */
export const LETTER_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
  FORBIDDEN: 'เฉพาะเจ้าของเท่านั้นที่ทำได้',
  BAD_REQUEST: 'ข้อมูลไม่ครบ กรุณาลองใหม่',
  LETTER_SERIES_REQUIRED: 'กรุณาเลือกชุดเลขหนังสือ (โครงการ)',
  LETTER_SERIES_NOT_FOUND: 'ไม่พบชุดเลขหนังสือนี้แล้ว — อาจถูกลบไป',
  LETTER_SEQ_INVALID: 'เลขที่หนังสือต้องเป็นตัวเลข 1–99999',
  LETTER_NO_TAKEN: 'เลขที่นี้ถูกใช้ไปแล้วในปีนี้ — กดปุ่ม ↻ เพื่อใช้เลขถัดไป',
  LETTER_SUBJECT_REQUIRED: 'กรุณาใส่ “เรื่อง”',
  LETTER_RECIPIENT_REQUIRED: 'กรุณาใส่ “เรียน”',
  LETTER_TOO_LONG: 'ข้อความยาวเกินไป กรุณาตัดให้สั้นลง',
  DATE_INVALID: 'วันที่ไม่ถูกต้อง',
  DATE_BUDDHIST_ERA: 'ปีของวันที่เป็น พ.ศ. — กรุณาเลือกจากปฏิทินอีกครั้ง',
  LETTER_NOT_FOUND: 'ไม่พบหนังสือฉบับนี้แล้ว',
  LETTER_PHOTO_INVALID: 'เปิดรูปแนบไม่ได้ — รองรับ JPG PNG WebP',
  LETTER_PHOTOS_TOO_MANY: `แนบรูปได้ไม่เกิน ${LETTER_LIMITS.photos} รูปต่อฉบับ`,
  LETTER_PHOTOS_TOO_LARGE: 'รูปแนบรวมกันใหญ่เกินไป — ลดจำนวนรูปแล้วลองใหม่',
  LETTER_SERIES_PREFIX_INVALID: 'คำนำหน้าเลขที่ต้องยาว 1–12 ตัว ไม่มีช่องว่างและ /',
  LETTER_SERIES_PREFIX_TAKEN: 'คำนำหน้านี้มีชุดอื่นใช้อยู่แล้ว',
  LETTER_SERIES_LABEL_REQUIRED: 'กรุณาใส่ชื่อเรียกชุดเลข',
  LETTER_SERIES_IN_USE: 'ชุดเลขนี้มีหนังสืออยู่ ลบไม่ได้ — ปิดใช้งานแทนได้',
  SITE_NOT_FOUND: 'ไม่พบโครงการที่เลือก',
  IMPORT_INVALID: 'ไฟล์นี้ไม่ใช่ไฟล์สำรองของระบบออกหนังสือ',
  CREATE_FAILED: 'บันทึกไม่สำเร็จ กรุณาลองใหม่',
  UPDATE_FAILED: 'บันทึกไม่สำเร็จ กรุณาลองใหม่',
  DELETE_FAILED: 'ลบไม่สำเร็จ กรุณาลองใหม่',
  DOCX_FAILED: 'สร้างไฟล์ Word ไม่สำเร็จ กรุณาลองใหม่',
}

export const letterMessage = (code: string | undefined) =>
  (code && LETTER_MESSAGES[code]) || 'ทำรายการไม่สำเร็จ กรุณาลองใหม่'
