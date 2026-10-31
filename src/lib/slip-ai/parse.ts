/**
 * แปลงคำตอบของ AI ที่อ่านสลิป → ข้อมูลที่บอทเอาไปเติมได้ (ไฟล์ล้วน · ไม่มี import — unit test รันด้วย node ตรง ๆ)
 *
 * 🔴 ไม่เชื่อ AI: ทุกช่องตรวจรูปแบบเอง ช่องที่ผิดรูป = ทิ้งช่องนั้น ไม่ใช่เดา
 * 🔴 ยอดเงินคือสิ่งเดียวที่จำเป็น — ไม่มียอด = ถือว่าอ่านไม่ได้ (บอทถามยอดแบบเดิม)
 * ปีในสลิปไทยมักเป็น พ.ศ. → แปลงเป็น ค.ศ. ที่นี่ (ฐานข้อมูลเก็บ ค.ศ. เสมอ · CLAUDE.md §15)
 */

export type SlipRead = {
  amount: number
  /** YYYY-MM-DD (ค.ศ.) · null = อ่านไม่ได้ หรือวันที่ไม่สมเหตุสมผล */
  date: string | null
  /** ผู้รับเงิน / ชื่อร้าน */
  payee: string | null
  /** เลขอ้างอิงรายการ (สลิปโอน) */
  ref: string | null
}

/** คำสั่งที่ส่งให้ AI — ขอ JSON ล้วนตามรูปนี้ */
export const SLIP_PROMPT = `รูปนี้คือสลิปโอนเงิน ใบเสร็จ หรือบิลค่าใช้จ่ายของบริษัทรับเหมาก่อสร้างในประเทศไทย
อ่านแล้วตอบเป็น JSON อย่างเดียว ห้ามมีข้อความอื่น ตามรูปนี้:
{"is_receipt": true/false, "amount": ตัวเลขยอดที่จ่ายจริง (ยอดรวมสุทธิ ไม่ใช่ราคาต่อชิ้น ไม่ใส่คอมมา) หรือ null,
 "date": "YYYY-MM-DD" วันที่จ่ายตามที่พิมพ์ในรูป (ถ้าเป็นปี พ.ศ. ให้คงเป็น พ.ศ. ตามที่เห็น) หรือ null,
 "payee": ชื่อผู้รับเงินหรือชื่อร้าน (สั้น ๆ) หรือ null,
 "ref": เลขที่รายการ/เลขอ้างอิงของสลิปโอน หรือ null}
ถ้ารูปไม่ใช่สลิปหรือบิล ให้ is_receipt เป็น false · ถ้าไม่แน่ใจช่องไหนให้ใส่ null อย่าเดา`

const MAX_AMOUNT = 99_999_999

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max) : null
}

function cleanAmount(v: unknown): number | null {
  let n: number
  if (typeof v === 'number') n = v
  else if (typeof v === 'string') {
    const s = v.replace(/[฿,\s]/g, '').replace(/บาท$/, '')
    if (!/^\d+(\.\d+)?$/.test(s)) return null
    n = Number(s)
  } else return null
  if (!Number.isFinite(n) || n <= 0 || n > MAX_AMOUNT) return null
  return Math.round(n * 100) / 100
}

function isRealDate(y: number, m: number, d: number) {
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

/**
 * วันที่จากสลิป → YYYY-MM-DD ค.ศ. · ต้องไม่อยู่ในอนาคต และไม่เก่ากว่า `maxAgeDays`
 * (สลิปเก่ามาก = น่าจะอ่านปีผิด → ทิ้ง แล้วใช้วันนี้ตามเดิม ซึ่งเจ้าของเห็นบนการ์ดยืนยันอยู่แล้ว)
 */
export function cleanDate(v: unknown, today: string, maxAgeDays = 400): string | null {
  if (typeof v !== 'string') return null
  const m = v.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (!m) return null
  let y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (y >= 2400 && y <= 2799) y -= 543
  if (!isRealDate(y, mo, d)) return null
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  if (iso > today) return null
  const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) / 86_400_000
  return age <= maxAgeDays ? iso : null
}

/** ดึง JSON ก้อนแรกออกจากข้อความ (เผื่อ AI ห่อด้วย ```json … ```) */
function firstJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
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

/** ข้อความจาก AI → SlipRead · อ่านไม่ได้/ไม่ใช่สลิป/ไม่มียอด = null */
export function parseSlipReply(text: string, today: string): SlipRead | null {
  const o = firstJson(text)
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null
  const r = o as Record<string, unknown>
  if (r.is_receipt === false) return null
  const amount = cleanAmount(r.amount)
  if (amount === null) return null
  const ref = cleanText(r.ref, 40)
  return {
    amount,
    date: cleanDate(r.date, today),
    payee: cleanText(r.payee, 60),
    ref: ref && /^[\w-]{4,40}$/.test(ref.replace(/\s/g, '')) ? ref.replace(/\s/g, '') : null,
  }
}

/** หมายเหตุที่เติมให้: "ผู้รับ · อ้างอิง xxx" (≤ 200 ตัว — เพดานเดียวกับหมายเหตุของบอท) */
export function slipNote(r: SlipRead): string {
  return [r.payee, r.ref ? `อ้างอิง ${r.ref}` : null].filter(Boolean).join(' · ').slice(0, 200)
}
