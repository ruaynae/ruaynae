/**
 * ไฟล์ PDF ที่แนบกับหนังสือ (เช่น เอกสารที่เคยเสนองานเพิ่มไป) — เก็บเป็นรายการอ้างอิงถึงไฟล์ในคลังเอกสาร (R21)
 * ใน `letters.fields.pdfs` (jsonb เดิม ไม่ต้องรัน migration) · ไฟล์จริงอยู่ R2 เปิดผ่าน `/api/files/[id]`
 *
 * 🔴 ไฟล์ล้วน ไม่มี import (unit test รันด้วย node ตรง ๆ · ใช้ทั้งฟอร์มและตัวตรวจฝั่งเซิร์ฟเวอร์)
 * · ลบรายการออกจากหนังสือ ≠ ลบไฟล์ — ไฟล์ยังอยู่ในคลังเอกสาร · ถ้าไฟล์ในคลังถูกลบ ลิงก์เปิดได้ 404
 */

export type LetterPdf = { id: string; name: string; size: number }

export const LETTER_PDF_MAX = 10

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** ตรวจรายการจากฟอร์ม/jsonb — รูปร่างผิดข้ามแถวนั้น · id ซ้ำนับครั้งเดียว · เกินเพดานตัดทิ้ง */
export function parseLetterPdfs(v: unknown): LetterPdf[] {
  if (!Array.isArray(v)) return []
  const out: LetterPdf[] = []
  const seen = new Set<string>()
  for (const x of v) {
    if (!x || typeof x !== 'object') continue
    const r = x as Record<string, unknown>
    if (typeof r.id !== 'string' || !UUID.test(r.id) || seen.has(r.id.toLowerCase())) continue
    const name = String(r.name ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
    const size = Number(r.size)
    seen.add(r.id.toLowerCase())
    out.push({ id: r.id, name: name || 'เอกสาร.pdf', size: Number.isFinite(size) && size > 0 ? Math.round(size) : 0 })
    if (out.length >= LETTER_PDF_MAX) break
  }
  return out
}

/** ขนาดไฟล์อ่านง่าย */
export const pdfSizeText = (n: number) =>
  n <= 0 ? '' : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
