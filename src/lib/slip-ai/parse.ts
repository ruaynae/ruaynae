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
  /** ข้อความที่คนโอนพิมพ์ไว้ในสลิป (ช่อง "บันทึก"/"หมายเหตุ") เช่น "รางไฟ รพ แมว" */
  memo: string | null
  /** ชื่อสินค้าในบิล/หน้าคำสั่งซื้อออนไลน์ (31 ต.ค. 2569 · เจ้าของส่งหน้าจอคำสั่งซื้อไทวัสดุ) */
  items: string | null
}

/** คำสั่งที่ส่งให้ AI — ขอ JSON ล้วนตามรูปนี้ */
export const SLIP_PROMPT = `รูปนี้คือหลักฐานการจ่ายเงินของบริษัทรับเหมาก่อสร้างในประเทศไทย อาจเป็น สลิปโอนเงิน ใบเสร็จ บิลร้านค้า
หรือภาพหน้าจอคำสั่งซื้อออนไลน์ (เช่น แอปไทวัสดุ โฮมโปร Shopee Lazada)
อ่านแล้วตอบเป็น JSON อย่างเดียว ห้ามมีข้อความอื่น ตามรูปนี้:
{"is_receipt": true/false,
 "amount": ตัวเลขยอดที่จ่ายจริงทั้งใบ (ยอดชำระ/ยอดสุทธิ ไม่ใช่ราคาต่อชิ้น ไม่ใส่คอมมา) หรือ null
   — ถ้าในรูปมีหลายยอดที่ขัดกัน ให้ใช้ยอด "ชำระ/สุทธิ/ยอดรวม" ที่ตรงกับผลรวมราคาสินค้า ถ้ายังไม่แน่ใจให้ใช้ผลรวมราคาสินค้าทุกบรรทัด,
 "date": "YYYY-MM-DD" วันที่จ่าย/วันที่สั่งซื้อตามที่พิมพ์ในรูป (ปี พ.ศ. ให้คงเป็น พ.ศ. ตามที่เห็น · รูปแบบ วัน/เดือน/ปี ให้แปลงเป็น ปี-เดือน-วัน) หรือ null,
 "payee": ชื่อผู้รับเงินหรือชื่อร้าน/สาขาที่ขาย (ฝั่ง "ไปที่"/ผู้รับ ไม่ใช่ชื่อเจ้าของบัญชีที่โอนออก) หรือ null,
 "ref": เลขอ้างอิงของธนาคาร หรือเลขที่ใบเสร็จ/เลขที่คำสั่งซื้อ (ถ้ามีหลายเลข เลือกเลขอ้างอิงรายการที่ยาวที่สุด) หรือ null,
 "memo": ข้อความที่ผู้จ่ายพิมพ์ไว้เอง ในช่อง "บันทึก" "หมายเหตุ" "บันทึกช่วยจำ" หรือกล่องข้อความท้ายสลิป ตามที่เห็นทุกตัวอักษร หรือ null,
 "items": ชื่อสินค้าที่ซื้อ สั้น ๆ (ตัดรหัสสินค้าออก) คั่นด้วย ", " ถ้ามีหลายรายการ ใส่ไม่เกิน 3 รายการแรก หรือ null ถ้าเป็นสลิปโอนที่ไม่มีชื่อสินค้า}
ถ้ารูปไม่ใช่หลักฐานการจ่ายเงิน ให้ is_receipt เป็น false · ถ้าไม่แน่ใจช่องไหนให้ใส่ null อย่าเดา`

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
  // เผื่อ AI ส่งรูปแบบไทย วัน/เดือน/ปี มา (เช่น 13/10/2026) — ปีต้องมี 4 หลักเท่านั้น
  const dmy = m ? null : v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (!m && !dmy) return null
  let y = Number(m ? m[1] : dmy![3])
  const mo = Number(m ? m[2] : dmy![2])
  const d = Number(m ? m[3] : dmy![1])
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
    memo: cleanText(r.memo, 100),
    items: cleanText(r.items, 120),
    ref: ref && /^[\w-]{4,40}$/.test(ref.replace(/\s/g, '')) ? ref.replace(/\s/g, '') : null,
  }
}

/**
 * หมายเหตุที่เติมให้: "ข้อความในสลิป · ผู้รับ · อ้างอิง xxx" (≤ 200 ตัว — เพดานเดียวกับหมายเหตุของบอท)
 * ข้อความที่เจ้าของพิมพ์ไว้ในสลิปมาก่อน เพราะเป็นชื่อของที่ซื้อ/โครงการที่เจ้าของตั้งใจจด
 */
export function slipNote(r: SlipRead): string {
  return [r.memo, r.items, r.payee, r.ref ? `อ้างอิง ${r.ref}` : null].filter(Boolean).join(' · ').slice(0, 200)
}

/** หมายเหตุที่เจ้าของพิมพ์เอง + สิ่งที่ AI อ่านได้ (ไม่ทิ้งของ AI · ≤ 200 ตัว) */
export function joinNote(typed: string | null | undefined, ai: string | null | undefined): string {
  const t = (typed ?? '').trim()
  const a = (ai ?? '').trim()
  if (!t) return a.slice(0, 200)
  if (!a || a.includes(t)) return (a || t).slice(0, 200)
  return `${t} · ${a}`.slice(0, 200)
}

const squash = (v: string) => v.toLowerCase().replace(/[\s.\-_/()]/g, '')

/**
 * ข้อความในสลิปเอ่ยถึงโครงการไหน — ชื่อย่อของโครงการ (ไม่นับช่องว่าง/จุด) อยู่ในข้อความ
 * เช่น "รางไฟ รพ แมว" + โครงการ "รพ.แมว" → ตรง · ตรงหลายโครงการหรือไม่ตรงเลย = null (ไม่เดา)
 * ชื่อสั้นกว่า 2 ตัวไม่นับ (กันตรงมั่ว)
 */
export function siteFromMemo<T extends { id: string; name: string }>(memo: string | null | undefined, sites: T[]): T | null {
  if (!memo) return null
  const m = squash(memo)
  const hits = sites.filter((x) => {
    const n = squash(x.name)
    return n.length >= 2 && m.includes(n)
  })
  if (hits.length === 1) return hits[0]
  // ตรงหลายโครงการเพราะชื่อหนึ่งเป็นส่วนของอีกชื่อ ("รพ" กับ "รพแมว") → เอาชื่อที่ยาวที่สุดถ้ายาวกว่าตัวอื่นชัดเจน
  if (hits.length > 1) {
    const sorted = [...hits].sort((a, b) => squash(b.name).length - squash(a.name).length)
    const top = squash(sorted[0].name)
    if (sorted.slice(1).every((x) => top.includes(squash(x.name)) && top !== squash(x.name))) return sorted[0]
  }
  return null
}
