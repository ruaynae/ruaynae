/**
 * R41 · ระบบตรวจบิล — รูปร่างข้อมูล + คำสั่ง AI อ่านบิล + ตัวตรวจคำตอบ (ไฟล์ล้วน · ไม่มี import — unit test รันด้วย node ตรง ๆ)
 *
 * บิล = ใบเสร็จ/ใบกำกับภาษี/บิลเงินสดจากผู้ขาย (หลักฐานที่สำนักงานบัญชีใช้ยื่นสรรพากร) — คนละอย่างกับสลิปโอน (หลักฐานว่าจ่ายแล้ว)
 * 🔴 ไม่เชื่อ AI: ทุกช่องตรวจรูปแบบเอง ช่องที่ผิดรูป = ทิ้งช่องนั้น · ปี พ.ศ. → ค.ศ. ที่นี่ (ฐานข้อมูลเก็บ ค.ศ. · CLAUDE.md §15)
 * 🔴 ตัวแปลงวันที่/ยอดเงินซ้ำกับ `slip-ai/parse.ts` โดยตั้งใจ (ไฟล์ล้วน import ข้ามไฟล์ไม่ได้ในเทสต์) — แก้กติกาปีย่อที่หนึ่งให้แก้อีกที่
 */

export type BillRead = {
  vendor: string | null
  /** เลขผู้เสียภาษีผู้ขาย 13 หลัก */
  taxId: string | null
  billNo: string | null
  /** YYYY-MM-DD ค.ศ. */
  date: string | null
  /** ยอดรวมทั้งสิ้นที่ต้องจ่าย (รวม VAT) */
  amount: number | null
  vat: number | null
}

export type BillReadStatus = 'pending' | 'read' | 'failed' | 'manual'

export const BILL_READ_LABEL: Record<BillReadStatus, string> = {
  pending: 'รออ่าน',
  read: 'อ่านแล้ว',
  failed: 'อ่านไม่ได้',
  manual: 'แก้เองแล้ว',
}

export const BILL_PROMPT = `รูปนี้น่าจะเป็นบิลที่บริษัทรับเหมาก่อสร้างในประเทศไทยได้รับจากผู้ขาย เช่น ใบเสร็จรับเงิน ใบกำกับภาษี บิลเงินสด ใบส่งของ
อ่านแล้วตอบเป็น JSON อย่างเดียว ห้ามมีข้อความอื่น ตามรูปนี้:
{"is_bill": true/false,
 "vendor": ชื่อร้าน/บริษัทผู้ขาย (ผู้ออกบิล ไม่ใช่ชื่อลูกค้า/ผู้ซื้อ) หรือ null,
 "tax_id": เลขประจำตัวผู้เสียภาษีของผู้ขาย 13 หลัก (ตัวเลขล้วน) หรือ null,
 "bill_no": เลขที่บิล/เลขที่ใบเสร็จ/เลขที่ใบกำกับภาษี หรือ null,
 "date": "YYYY-MM-DD" วันที่ของบิล เป็นปี พ.ศ. 4 หลัก (ปีย่อ 2 หลัก เช่น "15/10/69" = "2569-10-15" · ปี ค.ศ. เช่น 13/10/2026 ให้คงเป็น "2026-10-13") หรือ null,
 "amount": ยอดรวมทั้งสิ้นที่ต้องชำระทั้งใบ (รวมภาษีมูลค่าเพิ่มแล้ว ไม่ใส่คอมมา) หรือ null,
 "vat": ยอดภาษีมูลค่าเพิ่ม (ถ้าบิลแสดง) หรือ null}
ถ้ารูปไม่ใช่บิล/ใบเสร็จ (เช่นเป็นสลิปโอนเงิน หรือรูปอื่น) ให้ is_bill เป็น false · ถ้าไม่แน่ใจช่องไหนให้ใส่ null อย่าเดา`

const MAX_AMOUNT = 99_999_999

function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max) : null
}

export function cleanMoney(v: unknown): number | null {
  let n: number
  if (typeof v === 'number') n = v
  else if (typeof v === 'string') {
    const s = v.replace(/[฿,\s]/g, '').replace(/บาท$/, '')
    if (!/^\d+(\.\d+)?$/.test(s)) return null
    n = Number(s)
  } else return null
  if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT) return null
  return Math.round(n * 100) / 100
}

const realDate = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

/** วันที่บนบิล → ค.ศ. · ไม่อยู่ในอนาคต · ไม่เก่ากว่า 2 ปี (บิลเก่ามาก = น่าจะอ่านปีผิด) */
export function cleanBillDate(v: unknown, today: string): string | null {
  if (typeof v !== 'string') return null
  const m = v.trim().match(/^(\d{2}|\d{4})-(\d{1,2})-(\d{1,2})/)
  const dmy = m ? null : v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?!\d)/)
  if (!m && !dmy) return null
  let y = Number(m ? m[1] : dmy![3])
  const mo = Number(m ? m[2] : dmy![2])
  const d = Number(m ? m[3] : dmy![1])
  if (y < 100) y += 2500
  else if (y >= 2040 && y <= 2099) y += 500
  if (y >= 2400 && y <= 2799) y -= 543
  if (!realDate(y, mo, d)) return null
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  if (iso > today) return null
  const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) / 86_400_000
  return age <= 730 ? iso : null
}

function firstJson(t0: string): unknown {
  const t = t0.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  try {
    return JSON.parse(t)
  } catch {
    const a = t.indexOf('{')
    const b = t.lastIndexOf('}')
    if (a < 0 || b <= a) return null
    try {
      return JSON.parse(t.slice(a, b + 1))
    } catch {
      return null
    }
  }
}

/** คำตอบ AI → BillRead · ไม่ใช่บิล/อ่านไม่ได้ทั้งใบ = null (ยอดเงินไม่มีก็ยังคืนได้ — เจ้าของกรอกเองบนจอ) */
export function parseBillReply(raw: string, today: string): BillRead | null {
  const o = firstJson(raw)
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null
  const r = o as Record<string, unknown>
  if (r.is_bill === false) return null
  const amount = cleanMoney(r.amount)
  const tax = typeof r.tax_id === 'string' ? r.tax_id.replace(/\D/g, '') : ''
  const read: BillRead = {
    vendor: text(r.vendor, 200),
    taxId: /^\d{13}$/.test(tax) ? tax : null,
    billNo: text(r.bill_no, 60),
    date: cleanBillDate(r.date, today),
    amount: amount && amount > 0 ? amount : null,
    vat: cleanMoney(r.vat),
  }
  return read.vendor || read.amount || read.billNo ? read : null
}

/* ── ข้อมูลที่หน้าจอส่งมาแก้ (ตัวตรวจฝั่งเซิร์ฟเวอร์) ─────────────────── */

export type BillPatch = Partial<{
  vendor: string | null
  vendorTaxId: string | null
  billNo: string | null
  billDate: string | null
  amount: number | null
  vatAmount: number | null
  ignored: boolean
  note: string
}>

const ISO = /^\d{4}-\d{2}-\d{2}$/
const nullableText = (v: unknown, max: number): string | null | undefined =>
  v === null ? null : typeof v === 'string' ? (v.replace(/\s+/g, ' ').trim().slice(0, max) || null) : undefined

/** ตรวจช่องที่ส่งมา — ช่องที่ไม่ได้ส่ง = ไม่แตะ · ผิดรูป = `{ ok: false }` */
export function parseBillPatch(b: Record<string, unknown>): { ok: true; value: BillPatch } | { ok: false; error: string } {
  const v: BillPatch = {}
  if ('vendor' in b) { const x = nullableText(b.vendor, 200); if (x === undefined) return { ok: false, error: 'BAD_REQUEST' }; v.vendor = x }
  if ('billNo' in b) { const x = nullableText(b.billNo, 60); if (x === undefined) return { ok: false, error: 'BAD_REQUEST' }; v.billNo = x }
  if ('vendorTaxId' in b) {
    const x = b.vendorTaxId === null || b.vendorTaxId === '' ? null : typeof b.vendorTaxId === 'string' ? b.vendorTaxId.replace(/\D/g, '') : undefined
    if (x === undefined || (x !== null && !/^\d{13}$/.test(x))) return { ok: false, error: 'BILL_TAX_ID_INVALID' }
    v.vendorTaxId = x
  }
  if ('billDate' in b) {
    if (b.billDate !== null && (typeof b.billDate !== 'string' || !ISO.test(b.billDate))) return { ok: false, error: 'BAD_REQUEST' }
    v.billDate = b.billDate as string | null
  }
  for (const [k, out] of [['amount', 'amount'], ['vatAmount', 'vatAmount']] as const) {
    if (!(k in b)) continue
    if (b[k] === null || b[k] === '') { v[out] = null; continue }
    const n = cleanMoney(b[k])
    if (n === null || (k === 'amount' && n <= 0)) return { ok: false, error: 'BILL_AMOUNT_INVALID' }
    v[out] = n
  }
  if ('ignored' in b) { if (typeof b.ignored !== 'boolean') return { ok: false, error: 'BAD_REQUEST' }; v.ignored = b.ignored }
  if ('note' in b) { if (typeof b.note !== 'string') return { ok: false, error: 'BAD_REQUEST' }; v.note = b.note.slice(0, 500) }
  return { ok: true, value: v }
}

export const BILL_MESSAGES: Record<string, string> = {
  BILL_TABLE_MISSING: 'ยังไม่ได้ติดตั้งระบบตรวจบิลในฐานข้อมูล — รัน migration 20261112090000_bills.sql',
  BILL_NOT_FOUND: 'ไม่พบบิลนี้ (อาจถูกลบไปแล้ว) — รีเฟรชหน้านี้',
  BILL_TAX_ID_INVALID: 'เลขผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก',
  BILL_AMOUNT_INVALID: 'ยอดเงินไม่ถูกต้อง',
  BILL_AI_OFF: 'ยังไม่ได้ตั้งคีย์ AI อ่านสลิป — ตั้งที่หน้าตั้งค่า LINE แล้วลองใหม่ หรือกรอกข้อมูลบิลเอง',
  BILL_AI_QUOTA: 'โควตา AI วันนี้หมดแล้ว — ลองกด "อ่านที่เหลือ" ใหม่ทีหลัง หรือกรอกเอง',
  BILL_AI_FAILED: 'AI อ่านบิลนี้ไม่ได้ — กรอกข้อมูลเอง',
  TXN_NOT_FOUND: 'ไม่พบรายจ่ายนี้ (อาจถูกลบไปแล้ว)',
  FILE_NOT_UPLOADED: 'อัปโหลดไฟล์ไม่สำเร็จ ลองใหม่อีกครั้ง',
  SAVE_FAILED: 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง',
}
export const billMessage = (code: string | undefined) => BILL_MESSAGES[code ?? ''] ?? BILL_MESSAGES.SAVE_FAILED
