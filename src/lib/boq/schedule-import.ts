import type { BoqCategory, Grid, Span } from './core'

/**
 * R31 · ปรับวันของงานตามไฟล์แผนงาน Excel ของห้าง (แถว Plan / Actual รายสัปดาห์) — อ่านล้วน ไม่แตะฐานข้อมูล
 * · ไฟล์ของห้างใช้สองแถวต่องาน: แถว Plan (มีระยะเวลา/เริ่ม/เสร็จ ตามวัน) กับแถว Actual — ห้างอาจใช้แถว Actual (สีเหลือง)
 *   วาดแผนงานตามสัญญา และแถว Plan (สีน้ำเงิน) วาดแผนการทำงานดำเนินการ (ดูป้ายสัญลักษณ์ในไฟล์) → เลือกแถวต่อไฟล์ที่หน้าจอ
 * · ไฟล์นี้ไม่มี import ค่าจากไฟล์อื่น (unit test รันด้วย node ตรง ๆ) — ตัวจับคู่ชื่อส่งเข้ามาเป็นพารามิเตอร์
 */

const DAY = 864e5
const ISO = /^\d{4}-\d{2}-\d{2}$/

export type WeekRange = [number, number]
export type FileRow = {
  name: string
  /** วันตามคอลัมน์ เริ่ม/เสร็จ ของแถว Plan (ถ้ามี) */
  planDates: { start: string; end: string } | null
  /** สัปดาห์แรก–สุดท้าย (0 = W1) ที่มีช่องแรเงาของแถว Plan / Actual */
  planWeeks: WeekRange | null
  actualWeeks: WeekRange | null
}
export type FileSchedule = { weeks: number; start: string | null; end: string | null; rows: FileRow[] }

const t = (g: Grid, r: number, c: number) => g.w(r, c).replace(/\s+/g, '')
const toIso = (v: unknown): string | null => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  if (typeof v === 'string' && ISO.test(v.trim())) return v.trim()
  return null
}
const diffDays = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY)

/** อ่านตารางแผนงานของห้าง: หัวสัปดาห์ W1… · แถวป้าย `Plan`/`Actual` · วันเริ่ม/แล้วเสร็จของโครงการ */
export function readSchedule(g: Grid): FileSchedule | null {
  let hr = -1
  let c0 = -1
  for (let r = 0; r < Math.min(g.rows, 30) && hr < 0; r += 1) {
    for (let c = 0; c < g.cols; c += 1) if (/^W1$/i.test(t(g, r, c))) { hr = r; c0 = c; break }
  }
  if (hr < 0) return null
  let weeks = 0
  while (/^W\d+$/i.test(t(g, hr, c0 + weeks))) weeks += 1

  // คอลัมน์ ระยะเวลา / เริ่ม / เสร็จ — หาจากหัวตารางสองแถวบนของ W1 (ไม่เจอ = C/D/E)
  const colOf = (re: RegExp, fallback: number) => {
    for (let r = Math.max(0, hr - 3); r <= hr; r += 1) for (let c = 0; c < c0; c += 1) if (re.test(t(g, r, c))) return c
    return fallback
  }
  const cStart = colOf(/^เริ่ม/, 3)
  const cEnd = colOf(/^เสร็จ/, 4)

  const range = (r: number): WeekRange | null => {
    let a = -1
    let b = -1
    for (let k = 0; k < weeks; k += 1) {
      const v = g.v(r, c0 + k)
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) { if (a < 0) a = k; b = k }
    }
    return a < 0 ? null : [a, b]
  }
  const rows: FileRow[] = []
  for (let r = hr + 1; r < g.rows; r += 1) {
    let isPlan = false
    for (let c = 0; c < c0; c += 1) if (/^plan$/i.test(t(g, r, c))) isPlan = true
    if (!isPlan) continue
    // ชื่องาน = ข้อความแรกที่ไม่ใช่ตัวเลขล้วน/ป้าย ก่อนคอลัมน์ระยะเวลา
    let name = ''
    for (let c = 0; c < Math.min(cStart, c0); c += 1) {
      const x = g.w(r, c)
      if (x && !/^\d+(\.\d+)*$/.test(x) && !/^(plan|actual)$/i.test(x)) { name = x; break }
    }
    if (!name) continue
    const s = toIso(g.v(r, cStart))
    const e = toIso(g.v(r, cEnd))
    rows.push({
      name,
      planDates: s && e && diffDays(s, e) >= 0 ? { start: s, end: e } : null,
      planWeeks: range(r),
      actualWeeks: range(r + 1),
    })
  }
  if (!rows.length) return null

  // วันเริ่ม/แล้วเสร็จของโครงการ: ป้าย "วันที่เริ่ม" / "วันที่แล้วเสร็จ" → ค่าอยู่ช่องเดียวกันแถวถัดไป
  const dateBelow = (re: RegExp) => {
    for (let r = 0; r < Math.min(g.rows, 12); r += 1) {
      for (let c = 0; c < c0; c += 1) {
        if (re.test(t(g, r, c))) {
          for (let d = 0; d <= 1; d += 1) { const iso = toIso(g.v(r + d, c)); if (iso) return iso }
        }
      }
    }
    return null
  }
  return { weeks, start: dateBelow(/^วันที่เริ่ม/), end: dateBelow(/^วันที่แล้วเสร็จ/), rows }
}

/**
 * วางตารางวันเป็นข้อความ (ไม่มีไฟล์ Excel) — บรรทัดละงาน: `ชื่องาน` + แท็บ/ขีดตั้ง + `วันเริ่ม` + `วันเสร็จ` (ISO `2026-07-13`)
 * · บรรทัดว่าง/หัวข้อ (ขึ้นต้น #) ข้าม · วันเสร็จก่อนวันเริ่ม = ข้ามบรรทัดนั้น
 */
export function parsePastedSchedule(text: string): FileRow[] {
  const rows: FileRow[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const parts = line.split(/\t|\|/).map((x) => x.trim()).filter(Boolean)
    if (parts.length < 3) continue
    const start = parts[parts.length - 2]
    const end = parts[parts.length - 1]
    if (!ISO.test(start) || !ISO.test(end) || diffDays(start, end) < 0) continue
    rows.push({ name: parts.slice(0, -2).join(' '), planDates: { start, end }, planWeeks: null, actualWeeks: null })
  }
  return rows
}

export type ScheduleOptions = {
  /** วันเริ่ม/จำนวนวันของแผนที่จะใช้คิด offset (หลังตั้งตามไฟล์แล้วถ้าเลือก) */
  start: string
  days: number
  /** แถวไหนของไฟล์คือแผนงานตามสัญญา */
  contractFrom: 'Plan' | 'Actual'
  /** ตั้งอีกแถวเป็นแผนการทำงานดำเนินการ */
  withOps: boolean
  /** ความคล้ายของชื่อ 0..1 (`similarity` ใน core.ts) */
  similarity: (a: string, b: string) => number
  minScore?: number
}
export type Matched = { fileName: string; taskName: string; score: number; contract: Span | null; ops: Span | null }
export type ScheduleResult = { categories: BoqCategory[]; matched: Matched[]; unmatched: string[]; untouched: string[] }

const clamp = (s: Span, days: number): Span => {
  const offset = Math.max(0, Math.min(days - 1, Math.round(s.offset)))
  return { offset, dur: Math.max(1, Math.min(Math.round(s.dur), days - offset)) }
}
const weekSpan = (w: WeekRange): Span => ({ offset: w[0] * 7, dur: (w[1] - w[0] + 1) * 7 })

/** จับคู่งานในไฟล์กับงานในแผน (เฉพาะงานที่เปิดอยู่) แล้วตั้งช่วงวัน — คืนสำเนาใหม่ ไม่แก้ของเดิม */
export function applySchedule(cats: BoqCategory[], rows: FileRow[], o: ScheduleOptions): ScheduleResult {
  const min = o.minScore ?? 0.6
  const refs: { ci: number; ti: number; name: string }[] = []
  cats.forEach((c, ci) => c.tasks.forEach((tk, ti) => { if (tk.on) refs.push({ ci, ti, name: tk.name }) }))
  const used = new Set<number>()
  const out = cats.map((c) => ({ ...c, tasks: c.tasks.map((tk) => ({ ...tk })) }))
  const matched: Matched[] = []
  const unmatched: string[] = []
  const exact = (d: { start: string; end: string }): Span => ({ offset: diffDays(o.start, d.start), dur: diffDays(d.start, d.end) + 1 })

  for (const row of rows) {
    let best = -1
    let bestScore = 0
    refs.forEach((ref, i) => {
      if (used.has(i)) return
      const s = o.similarity(row.name, ref.name)
      if (s > bestScore) { bestScore = s; best = i }
    })
    if (best < 0 || bestScore < min) { unmatched.push(row.name); continue }
    used.add(best)
    const { ci, ti } = refs[best]

    const weeksOf = (which: 'Plan' | 'Actual') => (which === 'Plan' ? row.planWeeks : row.actualWeeks)
    const spanOfRow = (which: 'Plan' | 'Actual'): Span | null => {
      const w = weeksOf(which)
      if (which === 'Plan' && row.planDates) return clamp(exact(row.planDates), o.days)
      if (!w) return null
      // แถวที่ไม่มีวันที่ตรง ๆ แต่ช่วงสัปดาห์ตรงกับของแถว Plan = ใช้วันที่ของแถว Plan (แม่นกว่า)
      const p = row.planWeeks
      if (row.planDates && p && p[0] === w[0] && p[1] === w[1]) return clamp(exact(row.planDates), o.days)
      return clamp(weekSpan(w), o.days)
    }
    const other = o.contractFrom === 'Plan' ? 'Actual' : 'Plan'
    const contract = spanOfRow(o.contractFrom)
    const ops = o.withOps ? spanOfRow(other) : null
    const tk = out[ci].tasks[ti]
    if (contract) { tk.offset = contract.offset; tk.dur = contract.dur }
    if (o.withOps) tk.ops = ops ?? { offset: tk.offset, dur: tk.dur }
    matched.push({ fileName: row.name, taskName: refs[best].name, score: bestScore, contract, ops })
  }
  // งานที่เปิดอยู่แต่ไม่มีในไฟล์ — คงวันเดิม · เปิดแผนดำเนินการ = เริ่มจากแผนสัญญา
  const untouched: string[] = []
  refs.forEach((ref, i) => {
    if (used.has(i)) return
    untouched.push(ref.name)
    if (o.withOps && !out[ref.ci].tasks[ref.ti].ops) out[ref.ci].tasks[ref.ti].ops = { offset: out[ref.ci].tasks[ref.ti].offset, dur: out[ref.ci].tasks[ref.ti].dur }
  })
  return { categories: out, matched, unmatched, untouched }
}
