import type { Grid } from './core'

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

export function readProgress(form: Grid, plan: Grid): ProgressReport {
  let head = -1
  for (let r = 0; r < Math.min(form.rows, 40); r += 1)
    if (form.w(r, 1) === 'รายการ' && /^งวดที่/.test(form.w(r, 6))) { head = r; break }
  if (head < 0) throw new Error('NOT_PLAN_FILE')
  const P0 = 6
  let periods = 0
  while (/^งวดที่/.test(form.w(head, P0 + periods))) periods += 1
  let dateRow = -1
  for (let r = 0; r < head; r += 1) if (/^วันที่ส่งงวด/.test(form.w(r, 0))) dateRow = r
  const dates = Array.from({ length: periods }, (_, k) => (dateRow >= 0 ? dayOf(form.v(dateRow, P0 + k)) : null))

  // รายการย่อย = แถวที่มีปริมาณ (คอลัมน์ C) · แถวงาน = รหัส N.k ไม่มีปริมาณ · หมวด = รหัสเลขเดียว
  type Item = { amount: number; eff: number[] }
  const tasks: { code: string; name: string; category: string; amount: number; items: Item[] }[] = []
  let category = ''
  let lastPeriod = 0
  for (let r = head + 1; r < form.rows; r += 1) {
    const a = form.w(r, 0)
    if (/^รวม/.test(a)) break
    const qty = n(form.v(r, 2))
    if (/^\d+$/.test(a) && qty == null) { category = form.w(r, 1); continue }
    if (/^\d+\.\d+$/.test(a) && qty == null) { tasks.push({ code: a, name: form.w(r, 1), category, amount: 0, items: [] }); continue }
    const t = tasks[tasks.length - 1]
    const amount = n(form.v(r, 4))
    if (!t || qty == null || amount == null) continue
    const eff: number[] = []
    let prev = 0
    for (let k = 0; k < periods; k += 1) {
      const v = pct(form.v(r, P0 + k))
      if (v != null) {
        prev = v
        lastPeriod = Math.max(lastPeriod, k + 1)
      }
      eff.push(prev)
    }
    t.items.push({ amount, eff })
    t.amount += amount
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
  return {
    projectName: form.w(1, 0),
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
