import type { BoqCategory, Grid } from './core'

/**
 * R29 · นำเส้นผลงานสะสมรวมรายสัปดาห์ (เช่น 53.9% ที่ 21 ก.ย.) มากระจายเป็น % รายรายการในแผนที่บันทึกไว้
 *
 * 🔴 เส้นสะสมรวมบอกแค่ "ทั้งโครงการเสร็จกี่ %" ไม่ได้บอกว่าแต่ละรายการเสร็จกี่ % — ค่ารายรายการเป็นค่าประมาณ
 *    ตามรูปทรงของแผน (งานที่แผนว่าควรเสร็จก่อนได้ % มากกว่า) แต่ **ยอดรวมถ่วงมูลค่าตรงกับเส้นที่ให้มา**
 *    น้ำหนัก = ยอดรายการ ÷ ยอดรวมของงานที่เปิดอยู่ (สูตรเดียวกับ `planReport` ใน core.ts)
 * ไฟล์นี้ไม่มี import ค่าจากไฟล์อื่น (unit test รันด้วย node ตรง ๆ)
 */

const DAY = 864e5

/** เติมช่องว่างระหว่างจุดที่รู้ด้วยเส้นตรง · ก่อนจุดแรกไต่จาก 0 ที่ก่อน W1 · หลังจุดสุดท้ายไม่เติม (null) */
export function interpolateCum(points: (number | null)[]): (number | null)[] {
  const known = points.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0)
  const out: (number | null)[] = points.map(() => null)
  if (!known.length) return out
  let prevI = -1
  let prevV = 0
  for (const i of known) {
    const v = Math.max(prevV, Math.min(1, points[i] as number))
    for (let k = prevI + 1; k <= i; k += 1) out[k] = prevV + ((v - prevV) * (k - prevI)) / (i - prevI)
    prevI = i
    prevV = v
  }
  return out
}

type Row = { key: string; amount: number; offset: number; dur: number }

/** รายการของงานที่เปิดอยู่ พร้อมคีย์ผลงาน `<หมวด>.<งาน>.<รายการ>` (นับรวมงานที่ปิด เหมือน plan-store) */
function activeItems(categories: BoqCategory[]): Row[] {
  const rows: Row[] = []
  categories.forEach((c, ci) => c.tasks.forEach((t, ti) => {
    if (!t.on) return
    t.items.forEach((it, ii) => rows.push({ key: `${ci}.${ti}.${ii}`, amount: it.amount * c.mult, offset: t.offset, dur: Math.max(1, t.dur) }))
  }))
  return rows
}

/**
 * `cum[w]` = ผลงานสะสมรวม (0–1) ณ สิ้นสัปดาห์ w (null = ไม่ระบุ · หยุดที่สัปดาห์สุดท้ายที่ไม่ใช่ null)
 * คืน % สะสมรายรายการทุกสัปดาห์ถึงสัปดาห์สุดท้ายนั้น (ใส่ค่าชัดเจนทุกช่อง) + ความคลาดเคลื่อนสูงสุดของยอดรวม
 */
export function fitCurve(
  p: { categories: BoqCategory[]; days: number },
  cum: (number | null)[],
): { items: Record<string, (number | null)[]>; lastWeek: number; maxErr: number } {
  const weeks = Math.max(1, Math.ceil(p.days / 7))
  const rows = activeItems(p.categories)
  const total = rows.reduce((s, r) => s + r.amount, 0)
  let last = -1
  cum.forEach((v, i) => { if (v != null && i < weeks) last = i })
  const items: Record<string, (number | null)[]> = {}
  if (last < 0 || total <= 0) return { items, lastWeek: 0, maxErr: 0 }
  const prev = rows.map(() => 0)
  let maxErr = 0
  for (const r of rows) items[r.key] = new Array(weeks).fill(null)
  for (let w = 0; w <= last; w += 1) {
    const target = Math.min(1, Math.max(0, cum[w] ?? 0))
    // ฐานของแต่ละรายการ = สัดส่วนของงานที่แผนว่าควรเสร็จ ณ สิ้นสัปดาห์ · ยังไม่ถึงเวลา = ค่าเล็กมาก (ให้ไต่ได้ถ้าเส้นสูงกว่าแผน)
    const elapsedDays = Math.min(p.days, 7 * (w + 1))
    const base = rows.map((r) => Math.max(1e-6, Math.min(1, (elapsedDays - r.offset) / r.dur)))
    const sum = (s: number) => rows.reduce((acc, r, i) => acc + r.amount * Math.max(prev[i], Math.min(1, base[i] * s)), 0) / total
    let lo = 0
    let hi = 1e7
    for (let n = 0; n < 80; n += 1) {
      const mid = (lo + hi) / 2
      if (sum(mid) < target) lo = mid
      else hi = mid
    }
    const s = hi
    let got = 0
    rows.forEach((r, i) => {
      const v = Math.round(Math.max(prev[i], Math.min(1, base[i] * s)) * 10000) / 10000
      prev[i] = v
      items[r.key][w] = v
      got += (r.amount * v) / total
    })
    maxErr = Math.max(maxErr, Math.abs(got - target))
  }
  return { items, lastWeek: last + 1, maxErr }
}

const SKIP = /\s+/g
const t = (g: Grid, r: number, c: number) => g.w(r, c).replace(SKIP, '')

/**
 * อ่านเส้น "ผลงานจริงสะสม" จากไฟล์แผนงานของห้าง (แถวป้าย "ดำเนินการได้จริง" + "ความคืบหน้าสะสม")
 * · หัวสัปดาห์ = แถวที่มีข้อความ W1, W2 … · ค่า 0–1 ต่อสัปดาห์ · สัปดาห์ที่ยังไม่มีผล = null
 */
export function readActualCurve(g: Grid): (number | null)[] | null {
  let hr = -1
  let c0 = -1
  for (let r = 0; r < Math.min(g.rows, 30) && hr < 0; r += 1) {
    for (let c = 0; c < g.cols; c += 1) if (/^W1$/i.test(t(g, r, c))) { hr = r; c0 = c; break }
  }
  if (hr < 0) return null
  let n = 0
  while (/^W\d+$/i.test(t(g, hr, c0 + n))) n += 1
  for (let r = hr + 1; r < g.rows; r += 1) {
    const label = (rr: number) => Array.from({ length: Math.min(c0, 8) }, (_, c) => t(g, rr, c)).join('')
    // ป้าย "ดำเนินการ ได้จริง" ผสานช่องลงมาหลายแถว (เหลือแค่แถวบนสุด) · "สะสม" อยู่ที่แถวของเส้นเอง
    if (!label(r).includes('สะสม')) continue
    if (![0, 1, 2, 3].some((d) => r - d > hr && label(r - d).includes('ได้จริง'))) continue
    const out: (number | null)[] = []
    for (let k = 0; k < n; k += 1) {
      const v = g.v(r, c0 + k)
      out.push(typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1.0001 ? Math.min(1, v) : null)
    }
    return out.some((x) => x != null) ? out : null
  }
  return null
}
