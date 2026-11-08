import type { BoqCategory, BoqItem, BoqTask, Span } from './core'

/**
 * แผนงานที่บันทึกไว้ในเว็บ (R20i · ตาราง `construction_plans`) — รูปร่างข้อมูล + ตัวตรวจ
 * ใช้ทั้งฝั่ง API (ตรวจก่อนเขียน) และหน้าจอ · ไฟล์นี้ไม่มี import ค่าจากไฟล์อื่น (unit test รันด้วย node ตรง ๆ)
 *
 * 🔴 คีย์ผลงานรายการ = `<หมวด>.<งาน>.<รายการ>` นับจาก `categories` ทั้งก้อน รวมงานที่ปิดไว้
 *    ปิด/เปิดงานแล้วผลงานที่กรอกไว้ไม่สลับรายการ · ค่าในอาร์เรย์ = % สะสม ณ สิ้นสัปดาห์นั้น (0–1)
 *    `null` = ไม่ได้กรอก (เท่าสัปดาห์ก่อน) — กติกาเดียวกับช่องว่างในไฟล์ Excel
 */

export type PlanProject = {
  name: string; owner: string; loc1: string; loc2: string; code: string; total: number | null
  contractor: string; contractNo: string; contractDate: string; contractorRep: string
}
export type PlanProgress = {
  /** รูปแบบรายสัปดาห์ (26 ต.ค. 2569) — ไม่มีธงนี้ = แบบงวดเดิม `{ dates, items }` ที่ `parseProgress` แปลงให้ */
  weekly: true
  /** % สะสม ณ สิ้นสัปดาห์ ยาวเท่าจำนวนสัปดาห์ของสัญญา (0 = W1) — รายการที่แยกค่าวัสดุ/ค่าแรง ใช้ % เดียวกับทั้งสองก้อน */
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
export const emptyProgress = (): PlanProgress => ({ weekly: true, items: {} })

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
  const head = str(v.head, 300)
  // ค่าวัสดุ/ค่าแรง (R28): ต้องมีทั้งคู่และรวมเท่ายอดของรายการ — ไม่ลงตัว = ทิ้ง (ไม่ใช่ error · แผนเก่าไม่มีสองช่องนี้)
  const split = finite(v.mat) && finite(v.lab) && v.mat >= 0 && v.lab >= 0 && Math.abs(v.mat + v.lab - v.amount) <= Math.max(0.01, v.amount * 1e-6)
  return {
    code: str(v.code, 40), name: str(v.name), qty, unit: str(v.unit, 40), amount: v.amount, ...(head ? { head } : {}),
    ...(split ? { mat: v.mat as number, lab: v.lab as number } : {}),
  }
}

function parseTask(v: unknown, days: number): BoqTask | null {
  if (!isObj(v) || !finite(v.amount) || v.amount < 0 || !Array.isArray(v.items) || v.items.length > 3000) return null
  if (!Number.isInteger(v.offset) || !Number.isInteger(v.dur)) return null
  const offset = v.offset as number
  const dur = v.dur as number
  if (offset < 0 || dur < 1 || offset + dur > days) return null
  const items = v.items.map(parseItem)
  if (items.some((x) => !x)) return null
  const fast = parseSpan(v.fast, days)
  const ops = parseSpan(v.ops, days)
  if (fast === false || ops === false) return null
  return {
    name: str(v.name), amount: v.amount, source: str(v.source), offset, dur, on: v.on !== false, items: items as BoqItem[],
    ...(fast ? { fast } : {}), ...(ops ? { ops } : {}),
  }
}

/** ช่วงวันของแผนเสริม (เร่งรัด/ดำเนินการ) · ไม่มี = `null` · รูปร่างผิด = `false` */
function parseSpan(v: unknown, days: number): Span | null | false {
  if (v == null) return null
  if (!isObj(v) || !Number.isInteger(v.offset) || !Number.isInteger(v.dur)) return false
  const offset = v.offset as number
  const dur = v.dur as number
  return offset < 0 || dur < 1 || offset + dur > days ? false : { offset, dur }
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

const DAY = 864e5
/** จำนวนสัปดาห์ของสัญญา — สูตรเดียวกับ `weekCount()` ใน core.ts (ไฟล์นี้ import ค่าจากไฟล์อื่นไม่ได้) */
export const planWeeks = (days: number) => Math.max(1, Math.ceil(days / 7))
/** สัปดาห์ (0 = W1) ของวันที่ — นอกช่วงสัญญาถูกบีบเข้าสัปดาห์แรก/สุดท้าย */
const weekIndex = (start: string, iso: string, weeks: number) =>
  Math.max(0, Math.min(weeks - 1, Math.floor((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY / 7)))
/** วันนี้ตามเวลาไทย `YYYY-MM-DD` */
const bangkokToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)

/**
 * ผลงานรายสัปดาห์ (คำสั่งเจ้าของ 26 ต.ค. 2569 · กลับไปกรอกราย W แทนรายงวด) — ยาวเท่าจำนวนสัปดาห์ของสัญญา
 * และทิ้งคีย์ที่ไม่มีรายการจริง (ไม่ใช่ error: ย่นระยะเวลาแล้วสัปดาห์ที่หายไปต้องถูกตัดทิ้ง ไม่ใช่ทำให้บันทึกไม่ได้)
 * · ค่านอก 0–1 = error เพราะแปลว่าหน้าจอส่งของเสียมา
 * · ข้อมูลแบบงวดเดิม (`dates` + ค่ารายงวด) แปลงเป็นสัปดาห์ของวันส่งงวด · งวดที่ไม่มีวันที่ = สัปดาห์ของวันนี้
 */
export function parseProgress(
  v: unknown,
  plan: { categories: BoqCategory[]; days: number; start: string },
  todayIso = bangkokToday(),
): Result<PlanProgress> {
  if (!isObj(v)) return fail('PROGRESS_INVALID')
  const weeks = planWeeks(plan.days)
  const keys = new Set<string>()
  plan.categories.forEach((c, ci) => c.tasks.forEach((t, ti) => t.items.forEach((_, ii) => keys.add(itemKey(ci, ti, ii)))))
  const raw = isObj(v.items) ? v.items : {}
  // แบบงวดเดิม: งวด k → สัปดาห์ของวันส่งงวด (งวดหลังทับงวดก่อนถ้าตกสัปดาห์เดียวกัน)
  const legacy = v.weekly !== true
  const datesIn = Array.isArray(v.dates) ? v.dates : []
  const slot = (k: number) => {
    if (!legacy) return k
    const d = datesIn[k]
    return weekIndex(plan.start, isIsoDate(d) ? d : todayIso, weeks)
  }
  const series = (src: Record<string, unknown>, isLegacy: boolean): Record<string, (number | null)[]> | null => {
    const out: Record<string, (number | null)[]> = {}
    for (const [key, arr] of Object.entries(src)) {
      if (!keys.has(key) || !Array.isArray(arr)) continue
      const vals: (number | null)[] = new Array(weeks).fill(null)
      for (let k = 0; k < (isLegacy ? Math.min(arr.length, 24) : weeks); k += 1) {
        const x = arr[k]
        if (x == null) continue
        if (!finite(x) || x < 0 || x > 1) return null
        vals[isLegacy ? slot(k) : k] = Math.round(x * 10000) / 10000
      }
      if (vals.some((x) => x != null)) out[key] = vals
    }
    return out
  }
  const items = series(raw, legacy)
  if (!items) return fail('PROGRESS_VALUE_INVALID')
  return { ok: true, value: { weekly: true, items } }
}

/** แถวจากฐานข้อมูล → แผนงาน (jsonb ผ่านตัวตรวจอีกรอบ — ข้อมูลเก่าที่รูปร่างเพี้ยนต้องไม่ทำหน้าพัง) */
export function planFromRow(row: Record<string, unknown>): SavedPlan | null {
  const parsed = parsePlanInput({
    name: row.name, project: row.project, factor: row.factor == null ? null : Number(row.factor),
    vat: row.vat == null ? null : Number(row.vat), categories: row.categories, start: row.start_date,
    days: row.days, periods: row.periods, w124: row.w124, sourceFile: row.source_file,
  })
  if (!parsed.ok) return null
  const progress = parseProgress(row.progress, parsed.value)
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

/** นับรายการที่ยังไม่มีค่าวัสดุ/ค่าแรงแยก (แผนที่บันทึกก่อน R28) */
export function splitCount(categories: BoqCategory[]) {
  let total = 0
  let split = 0
  categories.forEach((c) => c.tasks.forEach((t) => t.items.forEach((it) => {
    total += 1
    if (it.mat != null && it.lab != null) split += 1
  })))
  return { total, split }
}

const nameKey = (s: string) => s.replace(/\s+/g, '').replace(/^[-–•]+/, '')
const sameAmount = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.01, Math.abs(a) * 1e-6)

/**
 * เติมค่าวัสดุ/ค่าแรงให้แผนที่บันทึกไว้แล้ว จาก BOQ ที่อ่านใหม่ (R28) — ไม่แตะลำดับ/ยอด/ผลงาน (คีย์ผลงานยังเป็นรายการเดิม)
 * · จับคู่ตามลำดับ: ชื่อ + ยอดเงินตรงกัน ถัดจากคู่ก่อนหน้า → ทั้งไฟล์ → ยอดเงินอย่างเดียวถ้ามีคู่เดียว
 * · รายการที่หาคู่ไม่ได้ปล่อยไว้แบบไม่แยก (ไม่เดา)
 */
export function fillSplit(target: BoqCategory[], source: BoqCategory[]) {
  const pool = source.flatMap((c) => c.tasks.flatMap((t) => t.items))
    .filter((it) => it.mat != null && it.lab != null)
    .map((it) => ({ it, name: nameKey(it.name), used: false }))
  let at = 0
  let filled = 0
  const take = (i: number) => {
    pool[i].used = true
    at = i + 1
    filled += 1
    return pool[i].it
  }
  const find = (it: BoqItem) => {
    const n = nameKey(it.name)
    const ok = (x: (typeof pool)[number]) => !x.used && x.name === n && sameAmount(x.it.amount, it.amount)
    for (let i = at; i < pool.length; i += 1) if (ok(pool[i])) return take(i)
    for (let i = 0; i < at; i += 1) if (ok(pool[i])) return take(i)
    const byAmount = pool.map((x, i) => (!x.used && sameAmount(x.it.amount, it.amount) ? i : -1)).filter((i) => i >= 0)
    return byAmount.length === 1 ? take(byAmount[0]) : null
  }
  const categories = target.map((c) => ({
    ...c,
    tasks: c.tasks.map((t) => ({
      ...t,
      items: t.items.map((it) => {
        if (it.mat != null && it.lab != null) return it
        const hit = find(it)
        if (!hit) return it
        // สัดส่วนจาก BOQ ใหม่ คูณยอดของแผน — ยอดรวมของรายการไม่เปลี่ยนแม้ต่างกันเศษสตางค์
        const mat = hit.amount ? (it.amount * (hit.mat as number)) / hit.amount : 0
        return { ...it, mat, lab: Math.max(0, it.amount - mat) }
      }),
    })),
  }))
  return { categories, filled }
}

/** จำนวนวันจากวันเริ่มถึงวันสิ้นสุด (นับทั้งสองวัน) · ผิดรูป = null */
export function spanDaysIso(start: string, end: string): number | null {
  if (!isIsoDate(start) || !isIsoDate(end)) return null
  const d = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY) + 1
  return d > 0 ? d : null
}

/**
 * ย้ายวันของแผนไปตามวันสัญญาของโครงการ (R28b) — งานคงตำแหน่งเทียบวันเริ่มเดิม (บีบให้อยู่ในระยะใหม่)
 * · ผลงานที่กรอกไว้ย้ายตาม**วันที่จริง** ของสิ้นสัปดาห์เดิม → สัปดาห์ใหม่ที่วันนั้นตกอยู่ (ไม่ใช่ตามเลข W)
 * · สัปดาห์ที่ตกนอกสัญญาใหม่ถูกทิ้ง และนับไว้ใน `dropped` ให้หน้าจอเตือน
 */
export function rebaseSchedule(
  p: { categories: BoqCategory[]; start: string; days: number; progress: PlanProgress },
  start: string,
  days: number,
) {
  const clamp = (s: Span): Span => {
    const offset = Math.max(0, Math.min(days - 1, s.offset))
    return { offset, dur: Math.max(1, Math.min(s.dur, days - offset)) }
  }
  const categories = p.categories.map((c) => ({
    ...c,
    tasks: c.tasks.map((t) => {
      const base = clamp({ offset: t.offset, dur: t.dur })
      return {
        ...t, ...base,
        ...(t.fast ? { fast: clamp(t.fast) } : {}),
        ...(t.ops ? { ops: clamp(t.ops) } : {}),
      }
    }),
  }))
  const oldWeeks = planWeeks(p.days)
  const weeks = planWeeks(days)
  const t0 = Date.parse(`${p.start}T00:00:00Z`)
  const n0 = Date.parse(`${start}T00:00:00Z`)
  let dropped = 0
  const items: PlanProgress['items'] = {}
  for (const [key, arr] of Object.entries(p.progress.items)) {
    const out: (number | null)[] = new Array(weeks).fill(null)
    arr.slice(0, oldWeeks).forEach((v, k) => {
      if (v == null) return
      const end = t0 + (Math.min(p.days, 7 * (k + 1)) - 1) * DAY
      const j = Math.floor((end - n0) / DAY / 7)
      if (j < 0 || j >= weeks) dropped += 1
      else out[j] = v
    })
    if (out.some((x) => x != null)) items[key] = out
  }
  return { categories, progress: { weekly: true as const, items }, dropped }
}

/** สัปดาห์ล่าสุดที่กรอกผลงานอย่างน้อยหนึ่งช่อง (1 = W1) · 0 = ยังไม่กรอก */
export function lastFilledWeek(p: PlanProgress) {
  let last = 0
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
