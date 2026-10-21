import type { Alignment, Borders, CellValue, Font, Worksheet } from 'exceljs'

/** ของใช้ร่วมของชีตในไฟล์แผนงาน — สี ฟอนต์ ตัวช่วยวางค่า (ไม่มี import ค่าของ exceljs) */

export const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
export const FONT = 'Tahoma'
export const C = {
  ink: 'FF1F2A37', muted: 'FF52606D', head: 'FFDCE6F0', cat: 'FFEEF2F6', sum: 'FFF3F6F9',
  plan: 'FF3E6FA3', act: 'FFE8A33D', input: 'FFFFF6CC', line: 'FF9AA8B6',
  good: 'FF1F7A4D', bad: 'FFB42318',
}
/** `[$-1070000]` = ปฏิทินพุทธ — Excel แสดง พ.ศ. เองโดยที่ค่าในช่องยังเป็นวันที่จริง */
export const DATE_FMT = '[$-1070000]d mmm yy'
export const PCT = '0.00%;-0.00%;;@'

/** ชื่อชีตที่สูตรข้ามชีตอ้างถึง — ต้องตรงกับที่ addWorksheet ใช้ */
export const SHEET = {
  plan: 'แผนงานก่อสร้าง',
  progress: 'ปริมาณงานที่แล้วเสร็จ',
  calc: 'คำนวณ',
} as const
/** อ้างชีตในสูตร — ชื่อไทยต้องครอบด้วย ' เสมอ */
export const ref = (sheet: string, addr: string) => `'${sheet}'!${addr}`

export const isoToDate = (iso: string) => new Date(`${iso}T00:00:00Z`)
export const addDays = (d: Date, n: number) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n))
export const col = (n: number) => {
  let s = ''
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s
  return s
}
export const baht = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** สูตร + ค่าที่คำนวณไว้แล้ว — โปรแกรมดูไฟล์ที่ไม่คำนวณสูตรเองยังเห็นตัวเลข */
export const f = (formula: string, result: number | string | Date) => ({ formula, result }) as CellValue

export type Style = { font?: Partial<Font>; fill?: string; align?: Partial<Alignment>; fmt?: string; border?: boolean }

const thin = { style: 'thin' as const, color: { argb: C.line } }
export const BOX: Partial<Borders> = { top: thin, left: thin, bottom: thin, right: thin }

export function kit(ws: Worksheet) {
  const put = (addr: string, value: CellValue, s: Style = {}) => {
    const c = ws.getCell(addr)
    c.value = value
    c.font = { name: FONT, size: 9, color: { argb: C.ink }, ...s.font }
    if (s.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: s.fill } }
    c.alignment = { vertical: 'middle', wrapText: true, ...s.align }
    if (s.fmt) c.numFmt = s.fmt
    if (s.border !== false) c.border = BOX
    return c
  }
  const merge = (r1: number, c1: number, r2: number, c2: number) => {
    if (r1 !== r2 || c1 !== c2) ws.mergeCells(r1, c1, r2, c2)
  }
  return { put, merge }
}

/** ช่วงเดือนของหัวสัปดาห์ — สัปดาห์อยู่เดือนไหนตามวันแรกของสัปดาห์ */
export function monthBands(start: Date, weeks: number) {
  const out: { d: Date; from: number; to: number }[] = []
  for (let k = 0; k < weeks; k += 1) {
    const d = addDays(start, 7 * k)
    const last = out[out.length - 1]
    if (last && last.d.getUTCMonth() === d.getUTCMonth() && last.d.getUTCFullYear() === d.getUTCFullYear()) last.to = k
    else out.push({ d, from: k, to: k })
  }
  return out
}
export const monthLabel = (d: Date) =>
  `${TH_MON[d.getUTCMonth()]} ${String((d.getUTCFullYear() + 543) % 100).padStart(2, '0')}`
