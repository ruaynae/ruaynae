/**
 * คลังเอกสาร (R21) — สัญญาจ้าง · แบบก่อสร้าง · BOQ · หนังสือรับรองผลงาน
 * ไฟล์ล้วน ไม่มี `'use client'` ไม่แตะฐานข้อมูล — ใช้ทั้ง API และหน้าจอ (§17 ข้อ 25)
 *
 * 🔴 ชนิดไฟล์ตัดสินจาก **นามสกุล** แล้วเซิร์ฟเวอร์เป็นคนกำหนด content-type ที่ใช้ตอน PUT/GET เอง
 *    ไม่เชื่อ `file.type` ของเบราว์เซอร์ (DWG ได้ค่าว่าง · ไฟล์ .html ปลอมเป็น PDF ได้)
 *    และไม่รับ html/svg/js เลย — เปิดแบบ inline จากโดเมน R2 แล้วรันสคริปต์ได้
 */

export const FILE_CATEGORIES = ['contract', 'drawing', 'boq', 'certificate', 'other'] as const
export type FileCategory = (typeof FILE_CATEGORIES)[number]

export const FILE_CATEGORY_LABEL: Record<FileCategory, string> = {
  contract: 'สัญญาจ้าง',
  drawing: 'แบบก่อสร้าง',
  boq: 'BOQ / ราคากลาง',
  certificate: 'หนังสือรับรองผลงาน',
  other: 'อื่น ๆ',
}

export const isFileCategory = (v: unknown): v is FileCategory =>
  typeof v === 'string' && (FILE_CATEGORIES as readonly string[]).includes(v)

/** 100 MB ต่อไฟล์ — แบบ PDF ทั้งชุดของงานราชการ ~20–80 MB · ไบต์วิ่งตรงเข้า R2 ไม่ผ่าน Vercel */
export const FILE_MAX_BYTES = 100 * 1024 * 1024

/** นามสกุล → content-type ที่เก็บใน R2 · `inline` = เปิดดูในเบราว์เซอร์ได้ */
export const FILE_TYPES: Record<string, { type: string; inline?: boolean }> = {
  pdf: { type: 'application/pdf', inline: true },
  jpg: { type: 'image/jpeg', inline: true },
  jpeg: { type: 'image/jpeg', inline: true },
  png: { type: 'image/png', inline: true },
  webp: { type: 'image/webp', inline: true },
  heic: { type: 'image/heic' },
  tif: { type: 'image/tiff' },
  tiff: { type: 'image/tiff' },
  xlsx: { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  xls: { type: 'application/vnd.ms-excel' },
  csv: { type: 'text/csv' },
  docx: { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  doc: { type: 'application/msword' },
  pptx: { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  dwg: { type: 'application/acad' },
  dxf: { type: 'application/dxf' },
  skp: { type: 'application/octet-stream' },
  zip: { type: 'application/zip' },
  rar: { type: 'application/vnd.rar' },
  '7z': { type: 'application/x-7z-compressed' },
}

export const FILE_ACCEPT = Object.keys(FILE_TYPES).map((e) => `.${e}`).join(',')

export const extOf = (name: string) => {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name.trim())
  return m ? m[1].toLowerCase() : ''
}

export const fileTypeOf = (name: string) => FILE_TYPES[extOf(name)] ?? null

/** ชื่อไฟล์ → ชื่อเรื่องตั้งต้น (ตัดนามสกุล · ขีดล่างเป็นช่องว่าง) */
export const titleFromFileName = (name: string) =>
  name.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) || 'เอกสาร'

export const cleanFileName = (name: string) =>
  // อักขระควบคุม/ทับ/แบ็กสแลช ทำ header Content-Disposition พัง
  name.replace(/[\u0000-\u001f\u007f/\\"]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)

export type FileMeta = {
  category: FileCategory
  title: string
  siteId: string | null
  docNo: string | null
  docDate: string | null
  note: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO = /^\d{4}-\d{2}-\d{2}$/
const opt = (v: unknown, max: number) => {
  const s = typeof v === 'string' ? v.trim().slice(0, max) : ''
  return s || null
}

/** ข้อมูลประกอบของไฟล์ — ใช้ทั้งตอนบันทึกไฟล์ใหม่และตอนแก้ */
export function parseFileMeta(b: Record<string, unknown>): { ok: true; value: FileMeta } | { ok: false; error: string } {
  if (!isFileCategory(b.category)) return { ok: false, error: 'CATEGORY_INVALID' }
  const title = opt(b.title, 300)
  if (!title) return { ok: false, error: 'TITLE_REQUIRED' }
  const siteRaw = b.siteId
  const siteId = siteRaw == null || siteRaw === '' ? null : typeof siteRaw === 'string' && UUID.test(siteRaw) ? siteRaw : undefined
  if (siteId === undefined) return { ok: false, error: 'SITE_NOT_FOUND' }
  const docDate = opt(b.docDate, 10)
  if (docDate) {
    if (!ISO.test(docDate) || Number.isNaN(Date.parse(`${docDate}T00:00:00Z`))) return { ok: false, error: 'DATE_INVALID' }
    // ฐานข้อมูลเก็บ ค.ศ. เสมอ (§15) — ช่องวันที่แปลงให้แล้ว แต่กันอีกชั้น
    if (Number(docDate.slice(0, 4)) > 2200) return { ok: false, error: 'DATE_BUDDHIST_ERA' }
  }
  return {
    ok: true,
    value: { category: b.category, title, siteId, docNo: opt(b.docNo, 100), docDate, note: opt(b.note, 2000) },
  }
}

export const metaRow = (m: FileMeta) => ({
  category: m.category, title: m.title, site_id: m.siteId, doc_no: m.docNo, doc_date: m.docDate, note: m.note,
})

export const FILE_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
  FORBIDDEN: 'เฉพาะเจ้าของเท่านั้น',
  BAD_REQUEST: 'ข้อมูลไม่ถูกต้อง ลองใหม่อีกครั้ง',
  UNSUPPORTED_TYPE: 'ไม่รองรับไฟล์ชนิดนี้ — ใช้ PDF รูปภาพ Excel Word DWG หรือ ZIP',
  FILE_TOO_LARGE: 'ไฟล์ใหญ่เกิน 100 MB — แยกเป็นหลายไฟล์ หรือบีบอัดก่อน',
  FILE_EMPTY: 'ไฟล์ว่างเปล่า',
  CATEGORY_INVALID: 'เลือกหมวดเอกสาร',
  TITLE_REQUIRED: 'ใส่ชื่อเอกสาร',
  SITE_NOT_FOUND: 'ไม่พบโครงการที่เลือก',
  DATE_INVALID: 'วันที่ไม่ถูกต้อง',
  DATE_BUDDHIST_ERA: 'ปีที่กรอกเป็น พ.ศ. — เลือกวันจากปฏิทินใหม่',
  INTENT_NOT_FOUND: 'ลิงก์อัปโหลดหมดอายุ — อัปโหลดไฟล์ใหม่อีกครั้ง',
  FILE_NOT_UPLOADED: 'อัปโหลดไฟล์ไม่สำเร็จ — ลองใหม่อีกครั้ง',
  NOT_FOUND: 'ไม่พบเอกสารนี้ — อาจถูกลบไปแล้ว',
  TABLE_MISSING: 'ยังไม่ได้ติดตั้งตารางคลังเอกสาร — รัน migration 20261023090000_project_files.sql ก่อน',
}
export const fileMessage = (code: string, fallback = 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง') => FILE_MESSAGES[code] ?? fallback

/** คำค้นที่ยัดเข้า `.or()` ได้ปลอดภัย — คอมมา/วงเล็บกลายเป็นเงื่อนไขใหม่ (§7) */
export const safeFileQuery = (q: string) => q.replace(/[,()\\%_*:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
