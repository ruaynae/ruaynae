/**
 * คลังวัสดุขออนุมัติ (R27 · 3 พ.ย. 2569) — เก็บวัสดุที่ใช้ประจำ + แค็ตตาล็อก แล้วเลือกเข้าหนังสือขออนุมัติใช้วัสดุ
 *
 * 🔴 ไฟล์ล้วน ไม่มี import ภายนอก — ใช้ทั้งหน้าจอ (เบราว์เซอร์) · API · unit test (node ตรง ๆ)
 * · หนังสืออ้างอิงไฟล์ในคลังโดยตรง ไม่คัดลอก (`letter_photos.object_key` ชี้ `catalog/…`)
 */

export const CATALOG_LIMITS = {
  name: 200,
  category: 60,
  detail: 300,
  note: 300,
  /** หน้าแค็ตตาล็อกต่อวัสดุหนึ่งรายการ */
  pages: 30,
  /** รายการในคลังที่โหลดมาแสดงทีเดียว (PostgREST ตัดที่ 1,000 · §7) */
  list: 500,
} as const

/** เพดานรูปแนบท้ายหนังสือ — ต้องตรงกับ `LETTER_LIMITS.photos` และ check `seq` ใน migration */
export const LETTER_PHOTO_MAX = 60

/** ตัวช่วยพิมพ์ช่อง "หมวด" (datalist) — พิมพ์เองได้ */
export const CATALOG_CATEGORIES = [
  'ปูน/คอนกรีต', 'กระเบื้อง', 'กระจก/อะลูมิเนียม', 'ระบบไฟฟ้า', 'สุขภัณฑ์/ประปา',
  'สี', 'ฝ้า/ผนังเบา', 'เหล็ก', 'งานไม้', 'ประตู/หน้าต่าง', 'อื่น ๆ',
] as const

export type CatalogPage = { id: string; key: string; seq: number }

export type CatalogItem = {
  id: string
  name: string
  category: string
  /** รายละเอียดที่ขออนุมัติใช้ เช่น "ยี่ห้อ CHANG รุ่น MV-18" */
  detail: string
  /** หมายเหตุเริ่มต้นในตาราง เช่น "ตรงตามแบบรูปรายการ" */
  note: string
  isActive: boolean
  pages: CatalogPage[]
}

/** ข้อมูลที่แก้ได้ของวัสดุ (ไม่รวมหน้าแค็ตตาล็อก) */
export type CatalogMeta = { name: string; category: string; detail: string; note: string }

export type ParsedMeta = { ok: true; value: CatalogMeta } | { ok: false; error: string }

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '')

/** ตัวตรวจข้อมูลวัสดุจากฟอร์ม — ผิดรูปตอบเป็นรหัส ไม่ปล่อยให้ check ของฐานข้อมูลเด้งเป็น 500 */
export function parseCatalogMeta(body: unknown): ParsedMeta {
  const o = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  const name = clip(o.name, CATALOG_LIMITS.name)
  if (!name) return { ok: false, error: 'CATALOG_NAME_REQUIRED' }
  if (typeof o.name === 'string' && o.name.trim().length > CATALOG_LIMITS.name) return { ok: false, error: 'CATALOG_NAME_TOO_LONG' }
  return {
    ok: true,
    value: {
      name,
      category: clip(o.category, CATALOG_LIMITS.category),
      detail: clip(o.detail, CATALOG_LIMITS.detail),
      note: clip(o.note, CATALOG_LIMITS.note),
    },
  }
}

/** คีย์ไฟล์ในคลัง — `catalog/<uuid>.<ext>` เท่านั้น (ตัวเดียวกับ `objectKey('catalog', ext)`) */
export const CATALOG_KEY = /^catalog\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/
export const isCatalogKey = (k: unknown): k is string => typeof k === 'string' && CATALOG_KEY.test(k)

/** คีย์รูปแนบของหนังสือ — ไฟล์ของหนังสือเอง (`letters/…`) หรืออ้างไฟล์ในคลัง (`catalog/…`) */
export const LETTER_PHOTO_KEY = /^(letters|catalog)\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/
/** `catalog/…` เป็นของคลัง — ลบไฟล์ตอนเอาออกจากหนังสือไม่ได้ */
export const isSharedKey = (k: string) => k.startsWith('catalog/')

/**
 * รายการวัสดุในหนังสือ ← วัสดุในคลัง
 * ช่องที่ขึ้นกับโครงการ (รูปแบบรายการ · แบบแสดงปริมาณราคา · รายการประกอบแบบ) ปล่อยว่างให้กรอกเอง
 */
export function catalogToRow(it: Pick<CatalogItem, 'name' | 'detail' | 'note'>) {
  return { name: it.name, drawing: '', boq: '', spec: '', detail: it.detail, note: it.note }
}

type RowLike = { name: string; detail: string }
const rowEmpty = (r: RowLike) => !r.name.trim() && !r.detail.trim()

/**
 * เติมวัสดุที่เลือกลงรายการ — แถวว่างท้ายตารางถูกแทนที่ก่อน · วัสดุที่มีอยู่แล้ว (ชื่อ+รายละเอียดเท่ากัน) ไม่เติมซ้ำ
 * คืนรายการใหม่ + จำนวนที่เติม/ข้าม
 */
export function mergeCatalogRows<T extends RowLike, P extends RowLike>(
  rows: readonly T[],
  picked: readonly P[],
  make: (p: P) => T,
  max: number,
): { rows: T[]; added: number; skipped: number } {
  const out = rows.filter((r) => !rowEmpty(r))
  const same = (a: RowLike, b: RowLike) => a.name.trim() === b.name.trim() && a.detail.trim() === b.detail.trim()
  let added = 0
  let skipped = 0
  for (const p of picked) {
    if (out.some((r) => same(r, p)) || out.length >= max) { skipped += 1; continue }
    out.push(make(p))
    added += 1
  }
  return { rows: out.length ? out : [...rows], added, skipped }
}

/**
 * ต่อหน้าแค็ตตาล็อกท้ายรูปแนบของหนังสือ — ข้ามคีย์ที่แนบอยู่แล้ว · เกินเพดานข้ามส่วนที่เกิน
 * คืนรายการใหม่ + จำนวนหน้าที่เติม/ข้าม
 */
export function appendCatalogPhotos<P extends { key?: string }>(
  photos: readonly P[],
  pages: readonly P[],
  max = LETTER_PHOTO_MAX,
): { photos: P[]; added: number; skipped: number } {
  const out = [...photos]
  const have = new Set(out.map((p) => p.key).filter(Boolean))
  let added = 0
  let skipped = 0
  for (const p of pages) {
    if ((p.key && have.has(p.key)) || out.length >= max) { skipped += 1; continue }
    out.push(p)
    if (p.key) have.add(p.key)
    added += 1
  }
  return { photos: out, added, skipped }
}

export const CATALOG_MESSAGES: Record<string, string> = {
  CATALOG_NAME_REQUIRED: 'กรุณาใส่ชื่อวัสดุ',
  CATALOG_NAME_TOO_LONG: `ชื่อวัสดุยาวเกิน ${CATALOG_LIMITS.name} ตัวอักษร`,
  CATALOG_NOT_FOUND: 'ไม่พบวัสดุนี้ (อาจถูกลบไปแล้ว) — รีเฟรชหน้านี้',
  CATALOG_IN_USE: 'มีหนังสือใช้แค็ตตาล็อกของวัสดุนี้อยู่ ลบไม่ได้ — กด “ซ่อน” แทน วัสดุจะไม่โผล่ตอนเลือก แต่หนังสือเก่ายังมีรูปครบ',
  CATALOG_PAGES_TOO_MANY: `แค็ตตาล็อกใส่ได้ไม่เกิน ${CATALOG_LIMITS.pages} หน้าต่อวัสดุ`,
  CATALOG_TABLE_MISSING: 'ยังไม่ได้ติดตั้งคลังวัสดุในฐานข้อมูล — รัน migration 20261103090000_r27_material_library.sql',
  CATALOG_CHANGED: 'มีการแก้ไขจากที่อื่น — รีเฟรชหน้านี้แล้วทำใหม่',
  INTENT_NOT_FOUND: 'ไฟล์ที่อัปโหลดหมดอายุ — เลือกไฟล์แล้วบันทึกใหม่อีกครั้ง',
  FILE_NOT_UPLOADED: 'อัปโหลดไฟล์ไม่สำเร็จ ตรวจสัญญาณแล้วลองใหม่',
  BAD_REQUEST: 'ข้อมูลไม่ถูกต้อง',
  FORBIDDEN: 'ไม่มีสิทธิ์ทำรายการนี้',
  SAVE_FAILED: 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง',
  DELETE_FAILED: 'ลบไม่สำเร็จ ลองใหม่อีกครั้ง',
  LOAD_FAILED: 'โหลดคลังวัสดุไม่สำเร็จ',
}

export const catalogMessage = (code: string | undefined) => CATALOG_MESSAGES[code ?? ''] ?? CATALOG_MESSAGES.SAVE_FAILED
