import type { Grid } from './core'

/**
 * อ่านไฟล์แผนงานที่เจ้าของกรอก % แล้วเสร็จกลับมา — ส่วนคำนวณล้วน (ไม่ผูก exceljs)
 *
 * 🔴 ผลงานจริง **คำนวณใหม่จากช่องที่กรอก** ไม่อ่านค่าที่ Excel คำนวณไว้ — ไฟล์ที่ถูกแก้ด้วยโปรแกรม
 * ที่ไม่คำนวณสูตร (หรือเปิดบนมือถือ) จะไม่มีค่าเหล่านั้น · ฝั่งแผนอ่านจากแถว Plan ของชีตแผนงาน
 * ซึ่งเป็นค่าที่เราเขียนไว้ตอนสร้างไฟล์ (หรือที่ Excel คำนวณใหม่หลังเจ้าของเลื่อนวัน)
 * กติกาตรงกับสูตรในไฟล์: ช่องว่าง = เท่าสัปดาห์ก่อน · สัปดาห์ล่าสุด = สัปดาห์สุดท้ายที่มีการกรอก
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
export type ProgressReport = {
  projectName: string
  labels: string[]
  /** ความคืบหน้าแผนรายสัปดาห์ (ไม่สะสม) */
  planWeekly: number[]
  planCum: number[]
  /** null = หลังสัปดาห์ล่าสุดที่กรอก */
  actualCum: (number | null)[]
  /** 1-based · 0 = ยังไม่กรอกเลย */
  lastWeek: number
  tasks: TaskProgress[]
}

export type Status = 'ahead' | 'on' | 'behind'
/** เกณฑ์เดียวกับไฟล์ Excel: โครงการ ±0.5 จุด · รายงาน ±1 จุด */
export const statusOf = (diff: number, tol: number): Status => (diff >= tol ? 'ahead' : diff <= -tol ? 'behind' : 'on')

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
/** พิมพ์ 40 ในช่องที่ไม่ได้จัดรูปแบบ % = 40% · ค่าใน 0–1 คือสัดส่วนอยู่แล้ว */
const pct = (v: unknown) => {
  const x = n(v)
  if (x == null) return null
  return Math.min(1, Math.max(0, x > 1 ? x / 100 : x))
}

export function readProgress(form: Grid, plan: Grid): ProgressReport {
  // หัวตารางของแบบฟอร์ม: แถวที่คอลัมน์ B = "รายการ" และคอลัมน์ G ขึ้นต้นด้วย W
  let head = -1
  for (let r = 0; r < Math.min(form.rows, 40); r += 1)
    if (form.w(r, 1) === 'รายการ' && /^W1\b/.test(form.w(r, 6))) { head = r; break }
  if (head < 0) throw new Error('NOT_PLAN_FILE')
  const W0 = 6
  let weeks = 0
  while (/^W\d+/.test(form.w(head, W0 + weeks))) weeks += 1
  const labels = Array.from({ length: weeks }, (_, k) => form.w(head, W0 + k))

  // รายการย่อย = แถวที่มีปริมาณ (คอลัมน์ C) · แถวงาน = รหัส N.k ไม่มีปริมาณ · หมวด = รหัสเลขเดียว
  type Row = { amount: number; eff: number[] }
  const tasks: (TaskProgress & { items: Row[] })[] = []
  let category = ''
  let lastWeek = 0
  for (let r = head + 1; r < form.rows; r += 1) {
    const a = form.w(r, 0)
    if (/^รวม/.test(a)) break
    const qty = n(form.v(r, 2))
    if (/^\d+$/.test(a) && qty == null) { category = form.w(r, 1); continue }
    if (/^\d+\.\d+$/.test(a) && qty == null) {
      tasks.push({ code: a, name: form.w(r, 1), category, amount: 0, weight: 0, plan: 0, actual: 0, items: [] })
      continue
    }
    const t = tasks[tasks.length - 1]
    const amount = n(form.v(r, 4))
    if (!t || qty == null || amount == null) continue
    const eff: number[] = []
    let prev = 0
    for (let k = 0; k < weeks; k += 1) {
      const v = pct(form.v(r, W0 + k))
      if (v != null) {
        prev = v
        lastWeek = Math.max(lastWeek, k + 1)
      }
      eff.push(prev)
    }
    t.items.push({ amount, eff })
    t.amount += amount
  }
  if (!tasks.length) throw new Error('NOT_PLAN_FILE')
  const total = tasks.reduce((s, t) => s + t.amount, 0) || 1

  // แถว Plan ของชีตแผนงาน เรียงตามงานเดียวกัน · คอลัมน์ "น้ำหนัก" อยู่ถัดจากสัปดาห์สุดท้าย 2 ช่อง
  const planRows: number[] = []
  for (let r = 0; r < plan.rows; r += 1) if (plan.w(r, 5) === 'Plan') planRows.push(r)
  const planOf = (ti: number, k: number) => {
    const r = planRows[ti]
    if (r == null) return 0
    let s = 0
    for (let j = 0; j < k; j += 1) s += n(plan.v(r, W0 + j)) ?? 0
    return s
  }
  const planWeekly = Array.from({ length: weeks }, (_, k) =>
    planRows.reduce((s, r) => s + (n(plan.v(r, W0 + k)) ?? 0), 0))
  let acc = 0
  const planCum = planWeekly.map((x) => (acc += x))

  const actualCum = Array.from({ length: weeks }, (_, k) =>
    k + 1 > lastWeek ? null : tasks.reduce((s, t) => s + t.items.reduce((q, it) => q + it.amount * it.eff[k], 0), 0) / total)

  return {
    projectName: form.w(1, 0),
    labels,
    planWeekly,
    planCum,
    actualCum,
    lastWeek,
    tasks: tasks.map((t, ti) => {
      const weight = t.amount / total
      const done = lastWeek ? t.items.reduce((q, it) => q + it.amount * it.eff[lastWeek - 1], 0) : 0
      return {
        code: t.code, name: t.name, category: t.category, amount: t.amount, weight,
        plan: lastWeek && weight ? Math.min(1, planOf(ti, lastWeek) / weight) : 0,
        actual: t.amount ? done / t.amount : 0,
      }
    }),
  }
}
