/**
 * ตารางวัสดุที่จะส่งคืน (หนังสือ "ขอนำส่งคืนวัสดุที่ได้จากการรื้อถอน" · 10 พ.ย. 2569)
 * ลำดับ · รายการ · จำนวน · หน่วย · ภาพประกอบ (1–4 รูปต่อรายการ)
 *
 * · รูปย่อเป็น JPEG เล็กที่เบราว์เซอร์แล้วเก็บเป็น data URL ในแถวเลย (ไม่ผ่าน R2 · เหมือน `equipment-summary.ts`) — เก็บใน
 *   `letters.fields.returnMaterials` (jsonb เดิม · ไม่มี migration) · ต่อรูปไม่เกิน `RM_PHOTO_MAX_CHARS` · รวมทั้งหนังสือไม่เกิน `RM_TOTAL_MAX_CHARS`
 *   (คำขอบันทึกทั้งก้อนต้องไม่ชนเพดาน body ของ Vercel ~4.5 MB)
 * 🔴 ไฟล์ล้วน ไม่มี import (unit test รันด้วย node ตรง ๆ)
 */

export const RM_TITLE = 'ตารางวัสดุที่ส่งคืน'
export const RM_LIMITS = { rows: 30, text: 300, unit: 40, photos: 4 } as const
export const RM_PHOTO_PX = 400
export const RM_PHOTO_MAX_CHARS = 45_000
export const RM_TOTAL_MAX_CHARS = 2_800_000

export type ReturnItem = {
  name: string
  /** จำนวน — เก็บเป็นข้อความที่พิมพ์ (ว่าง = ยังไม่กรอก) */
  qty: string
  unit: string
  /** `data:image/jpeg;base64,…` 0–4 รูป */
  photos: string[]
}
export type ReturnMaterials = { v: 1; items: ReturnItem[] }

export const emptyReturnItem = (): ReturnItem => ({ name: '', qty: '', unit: '', photos: [] })
export const emptyReturnMaterials = (): ReturnMaterials => ({ v: 1, items: [] })

export const rmFilled = (it: ReturnItem) => Boolean(it.name.trim())
export const rmItems = (s: ReturnMaterials | null | undefined) => (s ? s.items.filter(rmFilled) : [])
export const hasRmItems = (s: ReturnMaterials | null | undefined) => rmItems(s).length > 0

export const isJpegDataUrl = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= RM_PHOTO_MAX_CHARS && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(v)

/** จำนวนตัวอักษรของรูปทั้งหมด — ใช้โชว์/กันเกินเพดาน */
export const rmPhotoChars = (s: ReturnMaterials | null | undefined) =>
  s ? s.items.reduce((a, it) => a + it.photos.reduce((b, p) => b + p.length, 0), 0) : 0

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

/** ตัวตรวจข้อมูลจากเครือข่าย/ฐานข้อมูล — โครงสร้างผิดหรือรูปรวมเกินเพดาน = null · รูปที่ไม่ผ่านถูกทิ้ง (ตัวหนังสือยังอยู่) */
export function parseReturnMaterials(v: unknown): ReturnMaterials | null {
  if (!isObj(v) || v.v !== 1 || !Array.isArray(v.items) || v.items.length > RM_LIMITS.rows) return null
  const items = v.items.map((x): ReturnItem => {
    const o = isObj(x) ? x : {}
    const photos = Array.isArray(o.photos) ? o.photos.filter(isJpegDataUrl).slice(0, RM_LIMITS.photos) : []
    return { name: str(o.name, RM_LIMITS.text), qty: str(o.qty, 30), unit: str(o.unit, RM_LIMITS.unit), photos }
  })
  const out: ReturnMaterials = { v: 1, items }
  return rmPhotoChars(out) > RM_TOTAL_MAX_CHARS ? null : out
}

/** เก็บเฉพาะแถวที่มีชื่อ */
export const compactReturnMaterials = (s: ReturnMaterials | null): ReturnMaterials | null => {
  const items = rmItems(s)
  return items.length ? { v: 1, items } : null
}
