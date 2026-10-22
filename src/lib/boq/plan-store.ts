import type { BoqCategory, BoqItem, BoqTask } from './core'

/**
 * แผนงานที่บันทึกไว้ในเว็บ (R20i · ตาราง `construction_plans`) — รูปร่างข้อมูล + ตัวตรวจ
 * ใช้ทั้งฝั่ง API (ตรวจก่อนเขียน) และหน้าจอ · ไฟล์นี้ไม่มี import ค่าจากไฟล์อื่น (unit test รันด้วย node ตรง ๆ)
 *
 * 🔴 คีย์ผลงานรายการ = `<หมวด>.<งาน>.<รายการ>` นับจาก `categories` ทั้งก้อน รวมงานที่ปิดไว้
 *    ปิด/เปิดงานแล้วผลงานที่กรอกไว้ไม่สลับรายการ · ค่าในอาร์เรย์ = % สะสม ณ งวดนั้น (0–1)
 *    `null` = ไม่ได้กรอก (เท่างวดก่อน) — กติกาเดียวกับช่องว่างในไฟล์ Excel
 */

export type PlanProject = {
  name: string; owner: string; loc1: string; loc2: string; code: string; total: number | null
  contractor: string; contractNo: string; contractDate: string; contractorRep: string
}
export type PlanProgress = {
  /** วันที่ส่งงวด `YYYY-MM-DD` · ยาวเท่าจำนวนงวด */
  dates: (string | null)[]
  items: Record<string, (number | null)[]>
}
export type SavedPlanInput = {
  name: string
  project: PlanProject
  factor: number | null
  vat: number | null
  categories: BoqCategory[]
  start: string
  days: number
  periods: number
  w124: boolean
  sourceFile: string
}
/** แถวจากตาราง → รูปที่หน้าจอใช้ */
export type SavedPlan = SavedPlanInput & {
  id: string
  siteId: string | null
  progress: PlanProgress
  updatedAt: string
}

export const PLAN_COLUMNS =
  'id, name, site_id, project, factor, vat, categories, start_date, days, periods, w124, source_file, progress, updated_at'

export const itemKey = (ci: number, ti: number, ii: number) => `${ci}.${ti}.${ii}`
export const emptyProgress = (): PlanProgress => ({ dates: [], items: {} })

type Result<T> = { ok: true; value: T } | { ok: false; error: string }
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '')
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const ISO = /^\d{4}-\d{2}-\d{2}$/
export const isIsoDate = (v: unknown): v is string =>
  typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v)

function parseItem(v: unknown): BoqItem | null {
  if (!isObj(v) || !finite(v.amount) || v.amount < 0) return null
  const qty = v.qty == null ? null : finite(v.qty) ? v.qty : NaN
  if (Number.isNaN(qty)) return null
  return { code: str(v.code, 40), name: str(v.name), qty, unit: str(v.unit, 40), amount: v.amount }
}

function parseTask(v: unknown, days: number): BoqTask | null {
  if (!isObj(v) || !finite(v.amount) || v.amount < 0 || !Array.isArray(v.items) || v.items.length > 3000) return null
  if (!Number.isInteger(v.offset) || !Number.isInteger(v.dur)) return null
  const offset = v.offset as number
  const dur = v.dur as number
  if (offset < 0 || dur < 1 || offset + dur > days) return null
  const items = v.items.map(parseItem)
  if (items.some((x) => !x)) return null
  return { name: str(v.name), amount: v.amount, source: str(v.source), offset, dur, on: v.on !== false, items: items as BoqItem[] }
}

/** ตรวจหมวด/งาน/รายการทั้งก้อน — ตัวสร้าง Excel เชื่อรูปร่างนี้โดยไม่ตรวจซ้ำ */
export function parseCategories(v: unknown, days: number): BoqCategory[] | null {
  if (!Array.isArray(v) || !v.length || v.length > 200) return null
  const out: BoqCategory[] = []
  for (const c of v) {
    if (!isObj(c) || !Array.isArray(c.tasks) || !c.tasks.length || c.tasks.length > 500) return null
    if (!finite(c.mult) || c.mult <= 0 || c.mult > 3) return null
    const tasks = c.tasks.map((t) => parseTask(t, days))
    if (tasks.some((t) => !t)) return null
    out.push({ name: str(c.name), source: str(c.source), mult: c.mult, group: str(c.group), tasks: tasks as BoqTask[] })
  }
  return out.some((c) => c.tasks.some((t) => t.on)) ? out : null
}

function parseProject(v: unknown): PlanProject {
  const p = isObj(v) ? v : {}
  return {
    name: str(p.name), owner: str(p.owner), loc1: str(p.loc1), loc2: str(p.loc2), code: str(p.code, 100),
    total: finite(p.total) && p.total >= 0 ? p.total : null,
    contractor: str(p.contractor), contractNo: str(p.contractNo, 100), contractDate: str(p.contractDate, 100),
    contractorRep: str(p.contractorRep),
  }
}

/** ข้อมูลแผนทั้งฉบับจากหน้า "สร้างแผนงาน" */
export function parsePlanInput(body: unknown): Result<SavedPlanInput> {
  if (!isObj(body)) return fail('BAD_REQUEST')
  const days = body.days
  const periods = body.periods
  if (!Number.isInteger(days) || (days as number) < 14 || (days as number) > 1500) return fail('PLAN_DAYS_INVALID')
  if (!Number.isInteger(periods) || (periods as number) < 1 || (periods as number) > 24) return fail('PLAN_PERIODS_INVALID')
  if (!isIsoDate(body.start)) return fail('PLAN_START_INVALID')
  const categories = parseCategories(body.categories, days as number)
  if (!categories) return fail('PLAN_CATEGORIES_INVALID')
  const project = parseProject(body.project)
  const name = (str(body.name, 300) || project.name).trim()
  if (!name) return fail('PLAN_NAME_REQUIRED')
  const factor = finite(body.factor) && body.factor >= 1 && body.factor <= 3 ? body.factor : null
  const vat = finite(body.vat) && body.vat >= 0 && body.vat <= 1 ? body.vat : null
  return {
    ok: true,
    value: {
      name, project, factor, vat, categories, start: body.start as string, days: days as number,
      periods: periods as number, w124: body.w124 === true, sourceFile: str(body.sourceFile, 300),
    },
  }
}

/**
 * ผลงานรายงวด — ตัดให้พอดีจำนวนงวด และทิ้งคีย์ที่ไม่มีรายการจริง (ไม่ใช่ error:
 * แก้จำนวนงวดให้น้อยลงแล้วผลงานของงวดที่หายไปต้องถูกตัดทิ้ง ไม่ใช่ทำให้บันทึกไม่ได้)
 * · ค่านอก 0–1 หรือวันที่ผิดรูป = error เพราะแปลว่าหน้าจอส่งของเสียมา
 */
export function parseProgress(v: unknown, periods: number, categories: BoqCategory[]): Result<PlanProgress> {
  if (!isObj(v)) return fail('PROGRESS_INVALID')
  const datesIn = Array.isArray(v.dates) ? v.dates : []
  const dates: (string | null)[] = []
  for (let k = 0; k < periods; k += 1) {
    const d = datesIn[k]
    if (d == null || d === '') dates.push(null)
    else if (isIsoDate(d)) dates.push(d)
    else return fail('PROGRESS_DATE_INVALID')
  }
  const keys = new Set<string>()
  categories.forEach((c, ci) => c.tasks.forEach((t, ti) => t.items.forEach((_, ii) => keys.add(itemKey(ci, ti, ii)))))
  const items: Record<string, (number | null)[]> = {}
  const raw = isObj(v.items) ? v.items : {}
  for (const [key, arr] of Object.entries(raw)) {
    if (!keys.has(key) || !Array.isArray(arr)) continue
    const vals: (number | null)[] = []
    for (let k = 0; k < periods; k += 1) {
      const x = arr[k]
      if (x == null) vals.push(null)
      else if (finite(x) && x >= 0 && x <= 1) vals.push(Math.round(x * 10000) / 10000)
      else return fail('PROGRESS_VALUE_INVALID')
    }
    if (vals.some((x) => x != null)) items[key] = vals
  }
  return { ok: true, value: { dates, items } }
}

/** แถวจากฐานข้อมูล → แผนงาน (jsonb ผ่านตัวตรวจอีกรอบ — ข้อมูลเก่าที่รูปร่างเพี้ยนต้องไม่ทำหน้าพัง) */
export function planFromRow(row: Record<string, unknown>): SavedPlan | null {
  const parsed = parsePlanInput({
    name: row.name, project: row.project, factor: row.factor == null ? null : Number(row.factor),
    vat: row.vat == null ? null : Number(row.vat), categories: row.categories, start: row.start_date,
    days: row.days, periods: row.periods, w124: row.w124, sourceFile: row.source_file,
  })
  if (!parsed.ok) return null
  const progress = parseProgress(row.progress, parsed.value.periods, parsed.value.categories)
  return {
    ...parsed.value,
    id: String(row.id),
    siteId: typeof row.site_id === 'string' ? row.site_id : null,
    progress: progress.ok ? progress.value : emptyProgress(),
    updatedAt: String(row.updated_at),
  }
}

/** แผน → คอลัมน์ของตาราง */
export const planRow = (p: SavedPlanInput) => ({
  name: p.name, project: p.project, factor: p.factor, vat: p.vat, categories: p.categories,
  start_date: p.start, days: p.days, periods: p.periods, w124: p.w124, source_file: p.sourceFile,
})

/** งวดล่าสุดที่กรอกแล้ว (มีวันที่ หรือมีผลงานอย่างน้อยหนึ่งช่อง) · 0 = ยังไม่กรอก */
export function lastFilledPeriod(p: PlanProgress) {
  let last = 0
  p.dates.forEach((d, k) => { if (d) last = Math.max(last, k + 1) })
  Object.values(p.items).forEach((a) => a.forEach((x, k) => { if (x != null) last = Math.max(last, k + 1) }))
  return last
}

export const PLAN_MESSAGES: Record<string, string> = {
  BAD_REQUEST: 'ข้อมูลไม่ถูกต้อง ลองใหม่อีกครั้ง',
  PLAN_DAYS_INVALID: 'ระยะเวลาก่อสร้างต้องอยู่ระหว่าง 14 ถึง 1,500 วัน',
  PLAN_PERIODS_INVALID: 'จำนวนงวดงานต้องอยู่ระหว่าง 1 ถึง 24',
  PLAN_START_INVALID: 'วันเริ่มต้นสัญญาไม่ถูกต้อง',
  PLAN_CATEGORIES_INVALID: 'รายการงานไม่ครบหรือไม่ถูกต้อง — ต้องมีงานที่เลือกไว้อย่างน้อยหนึ่งงาน',
  PLAN_NAME_REQUIRED: 'ต้องมีชื่อโครงการ',
  PROGRESS_INVALID: 'ข้อมูลผลงานไม่ถูกต้อง',
  PROGRESS_DATE_INVALID: 'วันที่ส่งงวดไม่ถูกต้อง',
  PROGRESS_VALUE_INVALID: '% แล้วเสร็จต้องอยู่ระหว่าง 0 ถึง 100',
  PLAN_NOT_FOUND: 'ไม่พบแผนงานนี้ — อาจถูกลบไปแล้ว',
  PLAN_CHANGED: 'แผนงานนี้ถูกแก้จากอีกเครื่องระหว่างที่คุณแก้อยู่ — โหลดหน้าใหม่แล้วกรอกอีกครั้ง',
  SITE_NOT_FOUND: 'ไม่พบโครงการที่เลือก',
  PLAN_TABLE_MISSING: 'ยังไม่ได้ติดตั้งตารางแผนงานในฐานข้อมูล — รัน migration 20261022090000_r20_saved_plans.sql ก่อน',
}
export const planMessage = (code: string, fallback = 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง') => PLAN_MESSAGES[code] ?? fallback
