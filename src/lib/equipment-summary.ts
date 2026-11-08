/**
 * R34 · สรุปรายการครุภัณฑ์ที่ใช้ในโครงการ (หนังสือ "ขอส่งสรุปรายการครุภัณฑ์")
 *
 * "แบบฟอร์มบันทึกข้อมูลครุภัณฑ์" — ต่อครุภัณฑ์หนึ่งรายการ: ชื่อ / ยี่ห้อ-รุ่น / ผู้ขาย / ระยะเวลารับประกัน + รูป
 * · รายการดึงจาก BOQ (หมวดครุภัณฑ์ · เครื่องใช้ไฟฟ้า) หรือพิมพ์เอง · รูปเจ้าของหามาใส่เอง
 * · รูปย่อเป็น JPEG เล็กที่เบราว์เซอร์แล้วเก็บเป็น data URL ในแถวเลย (ไม่ผ่าน R2 — ตารางหนึ่งชุดไม่กี่สิบรูป)
 *   เพดานต่อรูป `EQ_PHOTO_MAX_CHARS` · ตัวตรวจฝั่งเซิร์ฟเวอร์ทิ้งรูปที่ไม่ใช่ JPEG data URL หรือใหญ่เกิน
 * · เก็บใน `letters.fields.equipSummary` (jsonb เดิม · ไม่มี migration)
 *
 * 🔴 ไฟล์ล้วน ไม่มี import (unit test รันด้วย node ตรง ๆ)
 */

export const EQ_ATTACHMENT = 'เอกสารสรุปรายการครุภัณฑ์ จำนวน 1 ชุด'
export const EQ_TITLE = 'แบบฟอร์มบันทึกข้อมูลครุภัณฑ์'
export const EQ_LIMITS = { rows: 100, text: 200 } as const
/** รูปย่อ: ด้านยาวสุด px · คุณภาพ JPEG · เพดานตัวอักษรของ data URL (~ 70 KB) */
export const EQ_PHOTO_PX = 560
export const EQ_PHOTO_QUALITY = 0.72
export const EQ_PHOTO_MAX_CHARS = 100_000
export const EQ_UNSPECIFIED = '-'

export type EquipItem = {
  name: string
  /** ยี่ห้อ รุ่น เช่น "MIKAEL รุ่น PB-341N" */
  brand: string
  seller: string
  /** เช่น "1 ปี" */
  warranty: string
  /** `data:image/jpeg;base64,…` หรือ '' */
  photo: string
}
export type EquipSummary = { v: 1; items: EquipItem[] }

export const emptyEquipItem = (name = ''): EquipItem => ({ name, brand: '', seller: '', warranty: '', photo: '' })
export const emptyEquipSummary = (): EquipSummary => ({ v: 1, items: [] })

export const eqFilled = (it: EquipItem) => Boolean(it.name.trim())
export const eqItems = (s: EquipSummary | null | undefined) => (s ? s.items.filter(eqFilled) : [])
export const hasEqItems = (s: EquipSummary | null | undefined) => eqItems(s).length > 0
export const eqCell = (v: string) => v.trim() || EQ_UNSPECIFIED

export const isJpegDataUrl = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= EQ_PHOTO_MAX_CHARS && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(v)

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, EQ_LIMITS.text) : '')

/** ตัวตรวจข้อมูลจากเครือข่าย/ฐานข้อมูล — ไม่ผ่าน = null · รูปที่ไม่ผ่านถูกทิ้งเงียบ ๆ (ตัวหนังสือยังอยู่) */
export function parseEquipSummary(v: unknown): EquipSummary | null {
  if (!isObj(v) || v.v !== 1 || !Array.isArray(v.items) || v.items.length > EQ_LIMITS.rows) return null
  const items = v.items.map((x): EquipItem => {
    const o = isObj(x) ? x : {}
    return { name: str(o.name), brand: str(o.brand), seller: str(o.seller), warranty: str(o.warranty), photo: isJpegDataUrl(o.photo) ? o.photo : '' }
  })
  return { v: 1, items }
}

/** เก็บเฉพาะแถวที่มีชื่อ */
export const compactEquipSummary = (s: EquipSummary | null): EquipSummary | null => {
  const items = eqItems(s)
  return items.length ? { v: 1, items } : null
}
