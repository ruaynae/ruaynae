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

export const isDate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
