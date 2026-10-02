/**
 * ค่าแรงรายเดือน (คำขอเจ้าของ 2 ต.ค. 2569) — ไฟล์ล้วน ใช้ได้ทั้งบอท หน้าเว็บ และ unit test
 *
 * เดือนแทนด้วยวันที่ 1 ของเดือน (`YYYY-MM-01`) แบบ ค.ศ. เสมอ · พ.ศ. มีแค่ตอนแสดงผล
 * สูตรเงินอยู่ในฐานข้อมูล (`payroll_month_balances`) ที่นี่มีแค่เรื่องปฏิทินกับป้าย
 */

const MONTH_RE = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/

const longFmt = new Intl.DateTimeFormat('th-TH', { timeZone: 'UTC', month: 'long', year: 'numeric' })
const shortFmt = new Intl.DateTimeFormat('th-TH', { timeZone: 'UTC', month: 'short', year: 'numeric' })

const pad = (n: number) => String(n).padStart(2, '0')
const toDate = (month: string) => new Date(`${month.slice(0, 7)}-01T00:00:00Z`)

/** `2026-09-17` / `2026-09` → `2026-09-01` · อ่านไม่ออก = `null` */
export function parseMonth(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const m = MONTH_RE.exec(raw.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  if (y < 2000 || y > 2200 || mo < 1 || mo > 12) return null
  return `${y}-${pad(mo)}-01`
}

/** วันที่ (หรือเดือน) → วันที่ 1 ของเดือนนั้น */
export const monthOf = (iso: string): string => `${iso.slice(0, 7)}-01`

/** วันสุดท้ายของเดือน — วันที่ 0 ของเดือนถัดไป */
export function monthEnd(month: string): string {
  const d = toDate(month)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)
}

/** เดือนถัดไป (`2026-12-01` → `2027-01-01`) */
export function nextMonth(month: string): string {
  const d = toDate(month)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)
}

/** `2026-09-01` → `กันยายน 2569` */
export const monthLabel = (month: string): string => longFmt.format(toDate(month))

/** `2026-09-01` → `ก.ย. 2569` */
export const monthShort = (month: string): string => shortFmt.format(toDate(month))

/** เดือนนี้ยังไม่จบ (หรือยังไม่ถึง) — ยอดยังเปลี่ยนได้ตามการลงชื่อ */
export const isOpenMonth = (month: string, today: string): boolean => monthOf(month) >= monthOf(today)

/**
 * เดือนที่ปุ่มจ่าย/ใบสรุปเลือกให้ก่อน = เดือนล่าสุดที่จบแล้วและมีของค้าง
 * (จ่ายวันที่ 5 ของเดือนถัดไป → วันที่ 5 ต.ค. ได้ ก.ย.) · ไม่มีเดือนที่จบแล้ว = เดือนล่าสุดในรายการ
 * · รายการว่าง = เดือนปัจจุบัน
 */
export function defaultMonth(months: readonly string[], today: string): string {
  const current = monthOf(today)
  const past = months.map(monthOf).filter((m) => m < current).sort()
  if (past.length > 0) return past[past.length - 1]
  const all = months.map(monthOf).sort()
  return all.length > 0 ? all[all.length - 1] : current
}

/** รายการเดือนจาก RPC (ไม่เชื่อรูป) → เดือนที่อ่านได้ เรียงเก่า→ใหม่ ไม่ซ้ำ */
export function cleanMonths(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : []
  const ok = list.map(parseMonth).filter((m): m is string => m !== null)
  return [...new Set(ok)].sort()
}

/** `2026-09` สำหรับ URL */
export const monthKey = (month: string): string => month.slice(0, 7)
