/**
 * R33 · แผนปฏิบัติงานบำรุงรักษาครุภัณฑ์ (หนังสือ "ขอส่งแผนการบำรุงรักษาครุภัณฑ์ อุปกรณ์ประกอบอาคาร")
 *
 * ตารางแนวนอนต่อท้ายหนังสือ: รายการซ่อมบำรุง × เดือนที่เข้าตรวจ (ติ๊กถูก) ตลอดระยะเวลาประกัน
 * · รายการดึงจาก BOQ ที่บันทึกไว้ (ครุภัณฑ์ · เครื่องใช้ไฟฟ้า) หรือพิมพ์เอง · ไม่มีรายการสำเร็จรูปในโค้ด
 * · ความถี่ตาม TOR: ปีละกี่ครั้ง (ค่าตั้งต้น 2 · ถ้า TOR ระบุให้แก้) · ติ๊ก/เอาติ๊กรายช่องได้ (บางรายการตรวจถี่/ห่างต่างกัน)
 * · เก็บใน `letters.fields.maintPlan` (jsonb เดิม · ไม่มี migration)
 *
 * 🔴 ไฟล์ล้วน ไม่มี import — ใช้ทั้งฟอร์ม · ตัวตรวจฝั่งเซิร์ฟเวอร์ · unit test (node ตรง ๆ)
 */

export const MP_ATTACHMENT = 'แผนการบำรุงรักษาครุภัณฑ์ อุปกรณ์ประกอบอาคาร จำนวน 1 ชุด'
export const MP_TITLE = 'ตารางตรวจสอบและบำรุงรักษาครุภัณฑ์'
export const MP_SUBTITLE = 'แผนปฏิบัติงานบำรุงรักษาครุภัณฑ์'
export const MP_LIMITS = { rows: 200, text: 300, header: 300, years: 5, cols: 24 } as const
/** จำนวนครั้งต่อปีที่หารเดือนลงตัว */
export const MP_PER_YEAR = [1, 2, 3, 4, 6, 12] as const
/** แถวต่อแผ่นแนวนอน (หัวตารางซ้ำทุกแผ่น) — ประมาณจากกระดาษจริง เผื่อที่ว่างไว้ */
export const MP_ROWS_PER_PAGE = 13

export type MaintPlan = {
  v: 1
  project: string
  location: string
  /** เดือนแรกที่เข้าตรวจ `YYYY-MM` (ค.ศ. — แสดงผลเป็น พ.ศ.) */
  start: string
  years: number
  perYear: number
  items: string[]
  /** ช่องที่ไม่ติ๊ก `"แถว.คอลัมน์"` — ค่าตั้งต้นติ๊กทุกช่อง */
  off: string[]
}

const TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/

export const isMonth = (v: unknown): v is string => typeof v === 'string' && MONTH_RE.test(v)

export function emptyMaintPlan(project = '', location = '', start = ''): MaintPlan {
  return { v: 1, project: project.trim().replace(/^โครงการ\s*/, ''), location, start: isMonth(start) ? start : '', years: 2, perYear: 2, items: [], off: [] }
}

/** เดือนที่เข้าตรวจทั้งหมด (เรียงตามเวลา) — `perYear` ครั้งต่อปีห่างเท่ากัน เริ่มที่ `start` */
export function mpMonths(p: Pick<MaintPlan, 'start' | 'years' | 'perYear'>): { y: number; m: number }[] {
  const mm = MONTH_RE.exec(p.start)
  if (!mm) return []
  const step = Math.round(12 / Math.max(1, p.perYear))
  const total = Math.min(p.years * p.perYear, MP_LIMITS.cols)
  const base = Number(mm[1]) * 12 + (Number(mm[2]) - 1)
  return Array.from({ length: total }, (_, i) => {
    const t = base + i * step
    return { y: Math.floor(t / 12), m: (t % 12) + 1 }
  })
}

/** ป้ายหัวคอลัมน์ "พ.ย.-69" (พ.ศ. 2 หลักท้าย) */
export const mpLabel = (c: { y: number; m: number }) => `${TH_MONTH[c.m - 1]}-${String((c.y + 543) % 100).padStart(2, '0')}`

/** "เดือน/ประจำปี พ.ศ. 2569 ถึง ปี พ.ศ. 2571" — ว่าง = ยังไม่ตั้งเดือนเริ่ม */
export function mpSpanText(cols: { y: number; m: number }[]): string {
  if (!cols.length) return 'เดือน/ประจำปี พ.ศ. ....'
  const a = cols[0].y + 543
  const b = cols[cols.length - 1].y + 543
  return a === b ? `เดือน/ประจำปี พ.ศ. ${a}` : `เดือน/ประจำปี พ.ศ. ${a} ถึง ปี พ.ศ. ${b}`
}

export const mpOn = (p: Pick<MaintPlan, 'off'>, row: number, col: number) => !p.off.includes(`${row}.${col}`)

/** สลับช่อง — คืนรายการ off ใหม่ (ไม่แก้ของเดิม) */
export function mpToggle(off: readonly string[], row: number, col: number): string[] {
  const k = `${row}.${col}`
  return off.includes(k) ? off.filter((x) => x !== k) : [...off, k]
}

/** ลบแถว → เลื่อนเลขแถวของช่องที่ปิดไว้ตาม */
export function mpRemoveRow(p: MaintPlan, row: number): MaintPlan {
  const off = p.off.flatMap((k) => {
    const [r, c] = k.split('.').map(Number)
    if (r === row) return []
    return [`${r > row ? r - 1 : r}.${c}`]
  })
  return { ...p, items: p.items.filter((_, i) => i !== row), off }
}

export const mpItems = (p: MaintPlan | null | undefined) => (p ? p.items.map((s) => s.trim()).filter(Boolean) : [])
export const hasMpItems = (p: MaintPlan | null | undefined) => Boolean(p && mpItems(p).length > 0 && mpMonths(p).length > 0)

/** แบ่งแผ่น: [เริ่ม, จบ) ของแต่ละแผ่น */
export function mpPages(n: number, per = MP_ROWS_PER_PAGE): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < n; i += per) out.push([i, Math.min(i + per, n)])
  return out.length ? out : [[0, 0]]
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

/** ตัวตรวจข้อมูลจากเครือข่าย/ฐานข้อมูล — ไม่ผ่าน = null */
export function parseMaintPlan(v: unknown): MaintPlan | null {
  if (!isObj(v) || v.v !== 1) return null
  const years = Number(v.years)
  const perYear = Number(v.perYear)
  if (!Number.isInteger(years) || years < 1 || years > MP_LIMITS.years) return null
  if (!(MP_PER_YEAR as readonly number[]).includes(perYear)) return null
  if (years * perYear > MP_LIMITS.cols) return null
  const start = typeof v.start === 'string' && (v.start === '' || isMonth(v.start)) ? v.start : null
  if (start == null || !Array.isArray(v.items) || v.items.length > MP_LIMITS.rows) return null
  const items = v.items.map((x) => str(x, MP_LIMITS.text))
  const cols = years * perYear
  const off = Array.isArray(v.off)
    ? v.off.filter((k): k is string => typeof k === 'string' && /^\d{1,3}\.\d{1,2}$/.test(k)).filter((k) => {
        const [r, c] = k.split('.').map(Number)
        return r < items.length && c < cols
      })
    : []
  return { v: 1, project: str(v.project, MP_LIMITS.header), location: str(v.location, MP_LIMITS.header), start, years, perYear, items, off: [...new Set(off)] }
}
