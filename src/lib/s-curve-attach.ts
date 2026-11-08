import type { ProgressReport } from './boq/progress-core'

/**
 * R30 · S-Curve แนบหนังสือส่งมอบงาน — ภาพนิ่งของกราฟแผนเทียบผลงานจริง ณ สิ้นสัปดาห์ที่เลือก
 * · เก็บใน `letters.fields.sCurve` (jsonb เดิม · ไม่มี migration) · แก้ผลงานในแผนทีหลัง หนังสือไม่เปลี่ยนจนกด "ดึงใหม่"
 * · ไฟล์นี้ไม่มี import ค่าจากไฟล์อื่น (unit test รันด้วย node ตรง ๆ) — รายงานคำนวณที่หน้าจอด้วย `planReport` แล้วส่งเข้ามา
 */

export const SC_ATTACHMENT = 'แผนงานก่อสร้างแสดงความก้าวหน้า (S-Curve) 1 ชุด'
export const SC_MAX_WEEKS = 300

export type ScPaper = 'A4' | 'A3'
export type SCurveCheck = { x: number; marks: { y: number; text: string }[] }

export type SCurveAttach = {
  v: 1
  planId: string
  planName: string
  project: string
  /** สัปดาห์ที่ตัดผลงาน (1 = W1) */
  week: number
  /** ผลงาน ณ วันที่ (วันส่งงวดจริง · แก้ได้) `YYYY-MM-DD` */
  asOf: string
  /** ขนาดแผ่นตอนพิมพ์: A4 = แผ่นแนวนอนหมุนลงกระดาษแนวตั้ง · A3 = หน้า A3 แนวนอนของตัวเอง (ไม่มีค่า = A4) */
  paper?: ScPaper
  labels: string[]
  sublabels: string[]
  planWeekly: number[]
  planCum: number[]
  /** null = หลังสัปดาห์ที่ตัด — เส้นหยุดตรงนั้น */
  actualCum: (number | null)[]
  w124Cum?: number[]
  fastCum?: number[]
  opsCum?: number[]
  checks: SCurveCheck[]
  /** แผนสะสม ณ สัปดาห์ที่ตัด · ผลงานสะสมก่อนตัวคูณ (เทียบแผน) · หลังตัวคูณ ÷ ราคาสัญญา (ตรงกับตารางปริมาณงาน) */
  planNow: number
  actualNow: number
  actualValue: number | null
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '')
const ISO = /^\d{4}-\d{2}-\d{2}$/

/** ภาพนิ่งจากรายงานที่คำนวณด้วยผลงานถึงสัปดาห์ `week` เท่านั้น */
export function buildSCurveAttach(
  r: ProgressReport,
  meta: { planId: string; planName: string; project: string; week: number; asOf: string },
): SCurveAttach {
  const k = Math.min(Math.max(meta.week, 1), r.planCum.length) - 1
  const cur = r.installments[r.installments.length - 1]
  return {
    v: 1,
    planId: meta.planId,
    planName: meta.planName,
    project: meta.project,
    week: meta.week,
    asOf: meta.asOf,
    labels: r.labels,
    sublabels: r.sublabels ?? [],
    planWeekly: r.planWeekly,
    planCum: r.planCum,
    actualCum: r.actualCum,
    ...(r.w124Cum ? { w124Cum: r.w124Cum } : {}),
    ...(r.fastCum ? { fastCum: r.fastCum } : {}),
    ...(r.opsCum ? { opsCum: r.opsCum } : {}),
    checks: [...new Set(r.w124.map((c) => c.x))].map((x) => ({
      x,
      marks: r.w124.filter((c) => c.x === x).map((c) => ({ y: c.min, text: `ว.124 ข้อ ${c.clause} ≥ ${Math.round(c.min * 100)}%` })),
    })),
    planNow: r.planCum[k] ?? 0,
    actualNow: cur?.actual ?? 0,
    actualValue: r.actualValueNow ?? null,
  }
}

const nums = (v: unknown, n: number, max: number): number[] | null => {
  if (!Array.isArray(v) || v.length !== n) return null
  return v.every((x) => fin(x) && x >= 0 && x <= max) ? (v as number[]) : null
}

/** ตัวตรวจภาพนิ่งจาก jsonb / client — รูปร่างผิดหรือค่าเกินช่วง = null */
export function parseSCurveAttach(v: unknown): SCurveAttach | null {
  if (!isObj(v) || v.v !== 1 || !Array.isArray(v.planCum)) return null
  const n = v.planCum.length
  if (n < 1 || n > SC_MAX_WEEKS) return null
  const week = v.week
  if (!Number.isInteger(week) || (week as number) < 1 || (week as number) > n) return null
  if (typeof v.asOf !== 'string' || !ISO.test(v.asOf)) return null
  const planCum = nums(v.planCum, n, 1.0001)
  const planWeekly = nums(v.planWeekly, n, 1.0001)
  if (!planCum || !planWeekly) return null
  if (!Array.isArray(v.actualCum) || v.actualCum.length !== n) return null
  if (!v.actualCum.every((x) => x === null || (fin(x) && x >= 0 && x <= 1.0001))) return null
  const opt = (x: unknown) => (x == null ? undefined : nums(x, n, 1.0001) ?? null)
  const w124Cum = opt(v.w124Cum)
  const fastCum = opt(v.fastCum)
  const opsCum = opt(v.opsCum)
  if (w124Cum === null || fastCum === null || opsCum === null) return null
  const labels = Array.isArray(v.labels) && v.labels.length === n ? v.labels.map((x) => str(x, 12)) : null
  if (!labels) return null
  const sublabels = Array.isArray(v.sublabels) && v.sublabels.length === n ? v.sublabels.map((x) => str(x, 20)) : []
  const checks: SCurveCheck[] = []
  for (const c of Array.isArray(v.checks) ? v.checks.slice(0, 6) : []) {
    if (!isObj(c) || !fin(c.x) || c.x < 0 || c.x > n || !Array.isArray(c.marks)) return null
    const marks = c.marks.slice(0, 6).map((m) => (isObj(m) && fin(m.y) && m.y >= 0 && m.y <= 1.0001 ? { y: m.y, text: str(m.text, 80) } : null))
    if (marks.some((m) => m == null)) return null
    checks.push({ x: c.x, marks: marks as { y: number; text: string }[] })
  }
  if (!fin(v.planNow) || !fin(v.actualNow)) return null
  return {
    v: 1,
    planId: str(v.planId, 60),
    planName: str(v.planName),
    project: str(v.project),
    week: week as number,
    asOf: v.asOf,
    ...(v.paper === 'A3' ? { paper: 'A3' as const } : {}),
    labels,
    sublabels,
    planWeekly,
    planCum,
    actualCum: v.actualCum as (number | null)[],
    ...(w124Cum ? { w124Cum } : {}),
    ...(fastCum ? { fastCum } : {}),
    ...(opsCum ? { opsCum } : {}),
    checks,
    planNow: v.planNow,
    actualNow: v.actualNow,
    actualValue: fin(v.actualValue) ? v.actualValue : null,
  }
}

export const hasSCurve = (s: SCurveAttach | null | undefined): s is SCurveAttach => s != null && s.planCum.length > 0
