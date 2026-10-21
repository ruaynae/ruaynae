import type { Grid } from './core'
import type { W124State } from './w124'

/**
 * อ่านไฟล์แผนงานที่เจ้าของกรอกผลงานรายงวดกลับมา — ส่วนคำนวณล้วน (ไม่ผูก exceljs)
 *
 * 🔴 ผลงานจริง **คำนวณใหม่จากช่องที่กรอก** ไม่อ่านค่าที่ Excel คำนวณไว้ — ไฟล์ที่ถูกแก้ด้วยโปรแกรม
 * ที่ไม่คำนวณสูตร (หรือเปิดบนมือถือ) จะไม่มีค่าเหล่านั้น · แผน ณ วันส่งงวดคิดรายวันจากวันเริ่ม/เสร็จ/ระยะเวลา
 * ของแต่ละงานในชีตแผนงาน — สูตรเดียวกับชีต "คำนวณ" ในไฟล์
 * กติกาตรงกับไฟล์: ช่องรายการที่ว่าง = เท่างวดก่อน · งวดล่าสุด = งวดสุดท้ายที่มีการกรอกอย่างน้อยหนึ่งช่อง
 */

export type TaskProgress = {
  code: string
  name: string
  category: string
  amount: number
  weight: number
  plan: number
  actual: number
}
export type Installment = {
  no: number
  /** `YYYY-MM-DD` · null = ยังไม่ใส่วันที่ส่งงวด */
  date: string | null
  /** สัปดาห์ของแผน (1-based) */
  week: number | null
  plan: number | null
  actual: number
}
export type W124Check = {
  clause: string
  when: string
  rule: string
  min: number
  /** วันที่ตรวจ `YYYY-MM-DD` */
  date: string
  /** ตำแหน่งบนแกนสัปดาห์ (ทศนิยม · สิ้นวันตรวจ) */
  x: number
  /** ผลงานสะสมของงวดล่าสุดที่ส่งไม่เกินวันตรวจ */
  actual: number
  /** งวดที่ใช้ประเมิน · null = ไม่มีงวดก่อนวันตรวจ */
  period: number | null
  state: W124State
}
export type ProgressReport = {
  projectName: string
  /** วันเริ่มสัญญาในไฟล์ `YYYY-MM-DD` */
  start: string | null
  /** ป้ายสัปดาห์ของแผน W1… และวันแรกของสัปดาห์ */
  labels: string[]
  sublabels: string[]
  /** ความคืบหน้าแผนรายสัปดาห์ (ไม่สะสม) */
  planWeekly: number[]
  planCum: number[]
  /** มีค่าเฉพาะสัปดาห์ที่ส่งงวด — กราฟลากเส้นต่อจุดของแต่ละงวด */
  actualCum: (number | null)[]
  installments: Installment[]
  tasks: TaskProgress[]
  /** ระยะเวลาสัญญา (วัน) ในชีตแผนงาน */
  days: number | null
  /** ข้อมูล ณ วันที่ `YYYY-MM-DD` — ตรงกับชีตสรุป */
  asOf: string
  /** ประเมินตาม ว.124 ข้อ 2.2 — `withW124()` เติมให้ · ว่างถ้าไฟล์ไม่มีวันเริ่ม/ระยะเวลา */
  w124: W124Check[]
}

export type Status = 'ahead' | 'on' | 'behind'
/** เกณฑ์เดียวกับไฟล์ Excel: โครงการ ±0.5 จุด · รายงาน ±1 จุด */
export const statusOf = (diff: number, tol: number): Status => (diff >= tol ? 'ahead' : diff <= -tol ? 'behind' : 'on')

const DAY = 864e5
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
/** พิมพ์ 40 ในช่องที่ไม่ได้จัดรูปแบบ % = 40% · ค่าใน 0–1 คือสัดส่วนอยู่แล้ว */
const pct = (v: unknown) => {
  const x = n(v)
  if (x == null) return null
  return Math.min(1, Math.max(0, x > 1 ? x / 100 : x))
}
/** วันที่จากช่อง Excel → เวลา UTC เที่ยงคืน · รับทั้ง Date และเลขลำดับวันของ Excel */
const dayOf = (v: unknown): number | null => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate())
  const x = n(v)
  return x != null && x > 30000 && x < 80000 ? Math.round((x - 25569) * DAY) : null
}
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
const thShort = (t: number) => new Date(t).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/**
 * @param summary ชีต "สรุปผลเบิกจ่าย" — ตารางผลงานรายงวด (คอลัมน์ A "งวดที่ k" · C วันที่ส่งงวด)
 * @param sheets ชีตหมวดเรียงตามไฟล์ — หัวตารางแถว 8 · คอลัมน์งวดเริ่มที่ M · ส่วนรายละเอียดอยู่ใต้แถว "รวม…" แรก
 * @param plan ชีตแผนงาน
 */
export function readProgress(summary: Grid, sheets: Grid[], plan: Grid): ProgressReport {
  if (!sheets.length) throw new Error('NOT_PLAN_FILE')
  const P0 = 12
  const periods = (() => {
    let n = 0
    while (/^งวดที่/.test(sheets[0].w(7, P0 + n))) n += 1
    return n
  })()
  if (!periods) throw new Error('NOT_PLAN_FILE')
  const dates: (number | null)[] = new Array(periods).fill(null)
  for (let r = 0; r < summary.rows; r += 1) {
    const m = /^งวดที่ (\d+)$/.exec(summary.w(r, 0))
    if (m && Number(m[1]) <= periods) dates[Number(m[1]) - 1] = dayOf(summary.v(r, 2))
  }

  // รายการย่อย = แถวที่มีจำนวน (C) และมูลค่า (E) ในส่วนรายละเอียด · แถวงาน = รหัส N.k ไม่มีจำนวน
  type Item = { amount: number; eff: number[] }
  const tasks: { code: string; name: string; category: string; amount: number; items: Item[] }[] = []
  let lastPeriod = 0
  for (const g of sheets) {
    const category = g.w(9, 1)
    let r = 10
    while (r < g.rows && !/^รวม/.test(g.w(r, 1))) r += 1 // ข้ามตารางสรุปหัวชีต
    for (r += 1; r < g.rows; r += 1) {
      const a = g.w(r, 0)
      const name = g.w(r, 1)
      const qty = n(g.v(r, 2))
      if (/^รวม/.test(name)) continue
      if (/^\d+\.\d+$/.test(a) && qty == null) { tasks.push({ code: a, name, category, amount: 0, items: [] }); continue }
      const t = tasks[tasks.length - 1]
      const amount = n(g.v(r, 4))
      if (!t || qty == null || amount == null || !name) continue
      const eff: number[] = []
      let prev = 0
      for (let k = 0; k < periods; k += 1) {
        const v = pct(g.v(r, P0 + k))
        if (v != null) {
          prev = v
          lastPeriod = Math.max(lastPeriod, k + 1)
        }
        eff.push(prev)
      }
      t.items.push({ amount, eff })
      t.amount += amount
    }
  }
  if (!tasks.length) throw new Error('NOT_PLAN_FILE')
  const total = tasks.reduce((s, t) => s + t.amount, 0) || 1

  // ชีตแผนงาน: C2 = วันเริ่ม · แถว Plan = งานเรียงลำดับเดียวกับแบบฟอร์ม (C ระยะเวลา · D เริ่ม · E เสร็จ)
  const start = dayOf(plan.v(1, 2))
  let weeks = 0
  for (let r = 0; r < Math.min(plan.rows, 12) && !weeks; r += 1)
    if (plan.w(r, 6) === 'W1') while (/^W\d+$/.test(plan.w(r, 6 + weeks))) weeks += 1
  const planRows: number[] = []
  for (let r = 0; r < plan.rows; r += 1) if (plan.w(r, 5) === 'Plan') planRows.push(r)
  const planWeekly = Array.from({ length: weeks }, (_, k) => planRows.reduce((s, r) => s + (n(plan.v(r, 6 + k)) ?? 0), 0))
  let acc = 0
  const planCum = planWeekly.map((x) => (acc += x))
  const weekOf = (t: number) => (start == null ? null : Math.max(1, Math.min(weeks, Math.floor((t - start) / DAY / 7) + 1)))

  /** สัดส่วนแผนของงาน ณ วัน t — เสร็จแล้ว 1 · กำลังทำ = วันที่ผ่านไป ÷ ระยะเวลา · ยังไม่เริ่ม 0 */
  const taskPlan = (ti: number, t: number) => {
    const r = planRows[ti]
    const d0 = r == null ? null : dayOf(plan.v(r, 3))
    const d1 = r == null ? null : dayOf(plan.v(r, 4))
    const dur = r == null ? null : n(plan.v(r, 2))
    if (d0 == null || d1 == null || !dur) return 0
    if (t >= d1) return 1
    if (t >= d0) return Math.min(1, ((t - d0) / DAY + 1) / dur)
    return 0
  }
  const weight = (ti: number) => tasks[ti].amount / total
  const planAt = (t: number) => tasks.reduce((s, _, ti) => s + weight(ti) * taskPlan(ti, t), 0)
  const actualAt = (k: number) => tasks.reduce((s, t) => s + t.items.reduce((q, it) => q + it.amount * it.eff[k], 0), 0) / total

  const installments: Installment[] = Array.from({ length: lastPeriod }, (_, k) => {
    const t = dates[k]
    return { no: k + 1, date: t == null ? null : iso(t), week: t == null ? null : weekOf(t), plan: t == null ? null : planAt(t), actual: actualAt(k) }
  })
  const actualCum: (number | null)[] = new Array(weeks).fill(null)
  for (const p of installments) if (p.week) actualCum[p.week - 1] = p.actual

  const lastDate = lastPeriod ? dates[lastPeriod - 1] : null
  // ข้อมูลสำหรับประเมิน ว.124 (คำนวณใน w124.ts) — ข้อมูล ณ วันที่ = ช่อง E4 · ว่าง = วันส่งงวดล่าสุด · ยังไม่มี = วันนี้
  const now = new Date()
  const asOf = dayOf(summary.v(3, 4)) ?? lastDate ?? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return {
    days: n(plan.v(4, 3)),
    asOf: iso(asOf),
    w124: [],
    projectName: summary.w(2, 0),
    start: start == null ? null : iso(start),
    labels: Array.from({ length: weeks }, (_, k) => `W${k + 1}`),
    sublabels: Array.from({ length: weeks }, (_, k) => (start == null ? '' : thShort(start + k * 7 * DAY))),
    planWeekly,
    planCum,
    actualCum,
    installments,
    tasks: tasks.map((t, ti) => ({
      code: t.code, name: t.name, category: t.category, amount: t.amount, weight: weight(ti),
      plan: lastDate == null ? 0 : taskPlan(ti, lastDate),
      actual: lastPeriod && t.amount ? t.items.reduce((q, it) => q + it.amount * it.eff[lastPeriod - 1], 0) / t.amount : 0,
    })),
  }
}
