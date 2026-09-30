import { fmtDate, todayInBangkok } from '@/lib/format'

export const today = todayInBangkok

/** `YYYY-MM-DD` ± n วัน (คำนวณบนปฏิทินล้วน ไม่ผูกเขตเวลาเครื่อง) */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export const thaiDate = (iso: string) => fmtDate(iso)

const money = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
/** ฿1,250 · มีสตางค์เมื่อมีจริง */
export const baht = (n: number) => `฿${money.format(n)}`

/** "1,200.50" · "1200" · "฿300" · "1.5k" ไม่รับ → null */
export function parseAmount(raw: string): number | null {
  const s = raw.replace(/[฿,\s]/g, '').replace(/บาท$/, '')
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const n = Number(s)
  return n > 0 && n <= 99_999_999 ? n : null
}

/** "20000 ค่าแรงช่างฝ้า" → ยอด + หมายเหตุ · ข้อความที่ไม่ขึ้นต้นด้วยตัวเลข → null */
export function parseAmountNote(raw: string): { amount: number; note: string } | null {
  const m = raw.trim().match(/^฿?\s*([\d,]+(?:\.\d{1,2})?)\s*(?:บาท)?\s*([^\d.,\s][\s\S]*)?$/)
  if (!m) return null
  const amount = parseAmount(m[1])
  if (amount === null) return null
  return { amount, note: (m[2] ?? '').trim().slice(0, 200) }
}

export const isDate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
