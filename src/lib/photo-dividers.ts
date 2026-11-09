/**
 * หน้าคั่นระหว่างหมวดรูป/เอกสารแนบท้ายหนังสือ (คำสั่งเจ้าของ 9 พ.ย. 2569) — หน้าเปล่าพิมพ์ข้อความกลางหน้า
 * เช่น "รูปภาพระหว่างก่อสร้าง" ก่อนรูปหน้างาน · "ผลการทดสอบแสงสว่าง" ก่อนรายละเอียดผลทดสอบ
 *
 * · ผูกกับ **รูปที่อยู่ถัดไป** (หน้าคั่นขึ้นก่อนรูปนั้น) — เก็บเป็นแผนที่ `ลำดับรูป (1…) → ข้อความ` ใน `letters.fields.photoDividers`
 *   (jsonb เดิม · ไม่มี migration) คำนวณใหม่จากลำดับรูปทุกครั้งที่บันทึก จึงตามรูปเมื่อเลื่อนลำดับ
 * · ไฟล์ Word ไม่มีหน้าคั่น (ใช้ปุ่มพิมพ์ / PDF) · ไฟล์ล้วน (unit test รันด้วย node ตรง ๆ)
 */

export const DIVIDER_MAX = 120
/** ข้อความแนะนำ (ตัวช่วยพิมพ์) */
export const DIVIDER_SUGGESTIONS = ['รูปภาพระหว่างก่อสร้าง', 'ผลการทดสอบแสงสว่าง', 'ผลการทดสอบเต้ารับ', 'ผลการทดสอบระบบไฟฟ้า'] as const

export type Dividers = Record<string, string>

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** ตรวจก้อนจากเครือข่าย/ฐานข้อมูล — คีย์ต้องเป็นเลขลำดับ 1–999 · ข้อความว่างถูกทิ้ง */
export function parseDividers(v: unknown): Dividers {
  const out: Dividers = {}
  if (!isObj(v)) return out
  for (const [k, x] of Object.entries(v)) {
    if (!/^\d{1,3}$/.test(k) || Number(k) < 1 || typeof x !== 'string') continue
    const t = x.replace(/\s+/g, ' ').trim().slice(0, DIVIDER_MAX)
    if (t) out[k] = t
  }
  return out
}

/** แผนที่จากรูปตามลำดับปัจจุบัน (1 = รูปแรก) */
export function dividersFromPhotos(photos: readonly { divider?: string }[]): Dividers {
  const out: Dividers = {}
  photos.forEach((p, i) => {
    const t = (p.divider ?? '').replace(/\s+/g, ' ').trim().slice(0, DIVIDER_MAX)
    if (t) out[String(i + 1)] = t
  })
  return out
}

/** ใส่หน้าคั่นกลับลงรูปตามลำดับ — ไม่แก้ของเดิม */
export function applyDividers<T extends { divider?: string }>(photos: readonly T[], map: Dividers | null | undefined): T[] {
  return photos.map((p, i) => {
    const t = map?.[String(i + 1)]
    return t ? { ...p, divider: t } : p
  })
}
