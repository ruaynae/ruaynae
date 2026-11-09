import type { BoqCategory } from './boq/core'

/**
 * R28 · "แบบแสดงรายการ ปริมาณงาน และราคา ที่แล้วเสร็จ" แนบท้ายหนังสือส่งมอบงาน (คำสั่งเจ้าของ 8 พ.ย. 2569)
 *
 * ภาพนิ่งของผลงาน ณ สิ้นสัปดาห์ที่เลือก จากแผนงานที่บันทึกไว้ (เมนูแผนงาน) — เก็บใน `letters.fields.progressWork`
 * (jsonb เดิม · ไม่มี migration) · แก้ผลงานในแผนทีหลัง หนังสือที่ส่งไปแล้วไม่เปลี่ยน (กด "ดึงผลงานใหม่" เอง)
 * · แยกยอดค่าวัสดุ / ค่าแรง ตาม ปร.4 · % แล้วเสร็จกรอกช่องเดียวต่อรายการ ใช้กับทั้งสองก้อน (คำสั่งเจ้าของ 8 พ.ย. 2569)
 * · % ของแต่ละหมวด/งาน **ถ่วงตามมูลค่า** (ไม่ใช่ค่าเฉลี่ยของ % รายการ)
 * · ไฟล์ล้วน ไม่ import ค่าจากไฟล์อื่น (unit test รันด้วย node ตรง ๆ)
 */

export const PW_TITLE = 'แบบแสดงรายการ ปริมาณงาน และราคา ที่แล้วเสร็จ'
/** บรรทัด "สิ่งที่ส่งมาด้วย" — ฟอร์มเติม/ถอดตามช่องติ๊ก */
export const PW_ATTACHMENT = `${PW_TITLE} 1 ชุด`

export type PwItem = {
  name: string
  qty: number | null
  unit: string
  mat: number
  lab: number
  /** % แล้วเสร็จสะสม 0–1 */
  pm: number
  pl: number
}
export type PwTask = { name: string; items: PwItem[] }
/** `equip` = หมวดที่มาจากแบบ ปร.5(ข) (ครุภัณฑ์จัดซื้อ · คูณ VAT) — ใช้แยกกลุ่มในใบสรุปความก้าวหน้า (R37) · snapshot เก่าไม่มี = งานปรับปรุงอาคาร */
export type PwCat = { name: string; mult: number; equip?: boolean; tasks: PwTask[] }
export type ProgressWork = {
  v: 1
  planId: string
  planName: string
  project: string
  location: string
  owner: string
  /** สัปดาห์ที่ดึงผลงาน (1 = W1) */
  week: number
  /** วันที่ที่พิมพ์ในตาราง "ผลงาน ณ วันที่" = วันส่งงวดจริง (เจ้าของกรอก · ตั้งต้น = วันที่ของหนังสือ) `YYYY-MM-DD` */
  asOf: string
  /** วันเริ่ม/ระยะเวลาของแผน ณ ตอนดึง — ไว้คำนวณวันสิ้นสัปดาห์ของ `week` ที่หน้าจอ */
  planStart: string
  planDays: number
  /** ราคาค่าก่อสร้างตามสัญญา (ตัวหารของ "คิดเป็น %") */
  contract: number
  /** รายการที่ BOQ ไม่ได้แยกค่าวัสดุ/ค่าแรง (ลงช่องค่าวัสดุทั้งก้อน) — ใช้เตือนบนจอ */
  unsplit: number
  cats: PwCat[]
}

/** ที่มาของภาพนิ่ง — รูปเดียวกับแผนที่บันทึกไว้ (`SavedPlan`) */
export type PwSource = {
  id: string
  name: string
  project: { name: string; owner: string; loc1: string; loc2: string; total: number | null }
  categories: BoqCategory[]
  progress: { items: Record<string, (number | null)[]> }
  start: string
  days: number
  /** เปิดประเมิน ว.124 ในแผนนี้ (ใช้กับ S-Curve แนบหนังสือ · R30) */
  w124?: boolean
}

const DAY = 864e5
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

/** ค่าที่มีผล ณ สัปดาห์ k (0 = W1): กรอกเอง หรือยกจากสัปดาห์ก่อน · ไม่เคยกรอก = `fallback` */
function at(vals: readonly (number | null)[] | undefined, k: number, fallback: number) {
  for (let i = k; i >= 0; i -= 1) if (vals?.[i] != null) return clamp01(vals[i] as number)
  return fallback
}

/** สัปดาห์ที่มีผลงานกรอกไว้อย่างน้อยหนึ่งช่อง (1 = W1) */
export function filledWeeks(p: PwSource['progress']): number[] {
  const s = new Set<number>()
  for (const a of Object.values(p.items)) a.forEach((x, k) => { if (x != null) s.add(k + 1) })
  return [...s].sort((a, b) => a - b)
}

/** วันสุดท้ายของสัปดาห์ (1 = W1) — สัปดาห์สุดท้ายจบที่วันสิ้นสุดสัญญา */
export const weekEndIso = (start: string, days: number, week: number) =>
  new Date(Date.parse(`${start}T00:00:00Z`) + (Math.min(days, 7 * week) - 1) * DAY).toISOString().slice(0, 10)

/** สร้างภาพนิ่ง ณ สิ้นสัปดาห์ `week` — เฉพาะงานที่เลือกไว้ในแผน (เลขหมวด/งานเหมือนไฟล์ Excel) */
export function buildProgressWork(src: PwSource, week: number): ProgressWork {
  const k = week - 1
  let unsplit = 0
  const cats: PwCat[] = []
  src.categories.forEach((c, ci) => {
    const tasks: PwTask[] = []
    c.tasks.forEach((t, ti) => {
      if (!t.on) return
      tasks.push({
        name: t.name,
        items: t.items.map((it, ii) => {
          const key = `${ci}.${ti}.${ii}`
          const m = at(src.progress.items[key], k, 0)
          const split = it.mat != null && it.lab != null
          if (!split) unsplit += 1
          const mat = split ? (it.mat as number) : it.amount
          const lab = split ? (it.lab as number) : 0
          // % เดียวของรายการ ใช้กับทั้งค่าวัสดุและค่าแรง · ก้อนที่เป็น 0 แสดง "-"
          const pm = mat > 0 ? m : 0
          const pl = lab > 0 ? m : 0
          return { name: it.name, qty: it.qty, unit: it.unit, mat, lab, pm, pl }
        }),
      })
    })
    if (tasks.length) cats.push({ name: c.name, mult: c.mult, ...(/ปร\.?\s*5\s*\(ข\)/.test(c.source ?? '') ? { equip: true } : {}), tasks })
  })
  const contract = src.project.total
    ?? cats.reduce((s, c) => s + c.tasks.reduce((q, t) => q + t.items.reduce((w, it) => w + it.mat + it.lab, 0), 0) * c.mult, 0)
  return {
    v: 1,
    planId: src.id,
    planName: src.name,
    project: src.project.name || src.name,
    location: [src.project.loc1, src.project.loc2].filter(Boolean).join(' '),
    owner: src.project.owner,
    week,
    asOf: weekEndIso(src.start, src.days, week),
    planStart: src.start,
    planDays: src.days,
    contract,
    unsplit,
    cats,
  }
}

/* ── ยอดรวม ─────────────────────────────────────────────────────── */

export type PwSum = {
  mat: number; matDone: number; lab: number; labDone: number
  /** มูลค่าที่แล้วเสร็จก่อนตัวคูณ / หลังคูณ Factor F หรือ VAT */
  done: number; value: number
}
const zero = (): PwSum => ({ mat: 0, matDone: 0, lab: 0, labDone: 0, done: 0, value: 0 })
const add = (a: PwSum, b: PwSum): PwSum => ({
  mat: a.mat + b.mat, matDone: a.matDone + b.matDone, lab: a.lab + b.lab, labDone: a.labDone + b.labDone,
  done: a.done + b.done, value: a.value + b.value,
})
export function itemSum(it: PwItem, mult: number): PwSum {
  const matDone = it.mat * it.pm
  const labDone = it.lab * it.pl
  return { mat: it.mat, matDone, lab: it.lab, labDone, done: matDone + labDone, value: (matDone + labDone) * mult }
}
export const taskSum = (t: PwTask, mult: number) => t.items.reduce((s, it) => add(s, itemSum(it, mult)), zero())
export const catSum = (c: PwCat) => c.tasks.reduce((s, t) => add(s, taskSum(t, c.mult)), zero())
export const pwTotal = (pw: ProgressWork) => pw.cats.reduce((s, c) => add(s, catSum(c)), zero())
/** % ถ่วงมูลค่า (0 เมื่อฐานเป็น 0) */
export const ratio = (done: number, base: number) => (base > 0 ? done / base : 0)

/* ── แถวของตารางบนกระดาษ ────────────────────────────────────────── */

export type PwRow =
  | { k: 'cat'; no: string; name: string }
  | { k: 'task'; no: string; name: string }
  | { k: 'item'; item: PwItem; mult: number; name: string }
  | { k: 'sub' | 'catTotal' | 'grand'; name: string; sum: PwSum; mult: number | null }

/** ลำดับแถวทั้งตาราง — หมวด → งาน → รายการ → รวมงาน · รวมหมวด · รวมทั้งสิ้น */
export function pwRows(pw: ProgressWork): PwRow[] {
  const out: PwRow[] = []
  pw.cats.forEach((c, ci) => {
    out.push({ k: 'cat', no: String(ci + 1), name: c.name })
    c.tasks.forEach((t, ti) => {
      out.push({ k: 'task', no: `${ci + 1}.${ti + 1}`, name: t.name })
      t.items.forEach((it) => out.push({ k: 'item', item: it, mult: c.mult, name: it.name }))
      out.push({ k: 'sub', name: `รวม${t.name}`, sum: taskSum(t, c.mult), mult: c.mult })
    })
    out.push({ k: 'catTotal', name: `รวม${c.name}`, sum: catSum(c), mult: c.mult })
  })
  if (pw.cats.length) out.push({ k: 'grand', name: 'รวมทั้งสิ้น', sum: pwTotal(pw), mult: null })
  return out
}

/** ความกว้างคอลัมน์ (%) — ลำดับ · รายการ · จำนวน · หน่วย · วัสดุ (มูลค่า · เสร็จ) · แรง (มูลค่า · เสร็จ) · % แล้วเสร็จ · รวมเสร็จ · ตัวคูณ · รวมเป็นมูลค่า · คิดเป็น % */
export const PW_COLS = [4, 24.5, 5, 4, 8, 8, 8, 8, 5, 8, 4.5, 8, 5] as const
/**
 * ตัวอักษรต่อบรรทัดของช่องรายการ — ตาราง ~1025px ตอนพิมพ์ · 13pt ของฟอนต์หนังสือ ~6px ต่อตัว
 * (วัดในเบราว์เซอร์ด้วยฟอนต์ 'Letter Sarabun' ของเว็บ · ประมาณเกินไว้)
 */
const NAME_CPL = Math.floor((PW_COLS[1] * 10.25 - 8) / 6)
const ROW_LINE = 22
const ROW_PAD = 3
/** พื้นที่ของแถวในหนึ่งแผ่นแนวนอนตอนพิมพ์ (px ที่ 96dpi · ขอบ 14/12mm) หลังหักหัวเรื่อง หัวตาราง บรรทัดสรุปท้าย */
export const PW_PAGE_BUDGET = 470
const THAI_MARKS = /[ัิ-ฺ็-๎]/g

export function pwRowHeight(r: PwRow): number {
  const text = r.k === 'item' ? ` - ${r.name}` : r.name
  const lines = Math.max(1, Math.ceil(text.replace(THAI_MARKS, '').length / NAME_CPL))
  return lines * ROW_LINE + ROW_PAD
}

/**
 * แบ่งแถวเป็นแผ่น (แผ่นแนวนอนหมุนลงกระดาษแนวตั้งไหลข้ามหน้าไม่ได้ — §17 ข้อ 44)
 * · หัวหมวด/หัวงานไม่ค้างท้ายแผ่นโดยไม่มีรายการตาม · คืนช่วง [เริ่ม, จบ)
 */
export function pwPages(rows: readonly PwRow[], budget = PW_PAGE_BUDGET): [number, number][] {
  const out: [number, number][] = []
  let start = 0
  let used = 0
  rows.forEach((r, i) => {
    const h = pwRowHeight(r)
    if (i > start && used + h > budget) {
      // ถอยหัวหมวด/หัวงานที่ค้างท้ายแผ่นไปขึ้นแผ่นใหม่ด้วย
      let cut = i
      while (cut - 1 > start && (rows[cut - 1].k === 'cat' || rows[cut - 1].k === 'task')) cut -= 1
      out.push([start, cut])
      start = cut
      used = rows.slice(cut, i).reduce((s, x) => s + pwRowHeight(x), 0)
    }
    used += h
  })
  if (rows.length) out.push([start, rows.length])
  return out
}

/* ── ตัวตรวจ (ข้อมูลจากฟอร์ม/ฐานข้อมูล) ────────────────────────── */

export const PW_LIMITS = { cats: 60, tasks: 600, items: 4000, text: 500 } as const
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, max: number = PW_LIMITS.text) => (typeof v === 'string' ? v.slice(0, max) : '')
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const money = (v: unknown) => (fin(v) && v >= 0 && v < 1e12 ? v : null)
const pct = (v: unknown) => (fin(v) && v >= 0 && v <= 1 ? v : null)

/** ตรวจก้อนจาก jsonb/ฟอร์ม — รูปร่างผิดหรือเกินเพดาน = `null` (หนังสือยังบันทึก/เปิดได้ แค่ไม่มีตาราง) */
export function parseProgressWork(v: unknown): ProgressWork | null {
  if (!isObj(v) || v.v !== 1 || !Array.isArray(v.cats)) return null
  const week = v.week
  if (!Number.isInteger(week) || (week as number) < 1 || (week as number) > 300) return null
  if (typeof v.asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.asOf)) return null
  const contract = money(v.contract)
  if (contract == null || v.cats.length > PW_LIMITS.cats) return null
  let nTask = 0
  let nItem = 0
  const cats: PwCat[] = []
  for (const c of v.cats) {
    if (!isObj(c) || !Array.isArray(c.tasks) || !fin(c.mult) || c.mult <= 0 || c.mult > 3) return null
    const tasks: PwTask[] = []
    for (const t of c.tasks) {
      if (!isObj(t) || !Array.isArray(t.items) || (nTask += 1) > PW_LIMITS.tasks) return null
      const items: PwItem[] = []
      for (const it of t.items) {
        if (!isObj(it) || (nItem += 1) > PW_LIMITS.items) return null
        const mat = money(it.mat)
        const lab = money(it.lab)
        const pm = pct(it.pm)
        const pl = pct(it.pl)
        const qty = it.qty == null ? null : fin(it.qty) ? it.qty : NaN
        if (mat == null || lab == null || pm == null || pl == null || Number.isNaN(qty)) return null
        items.push({ name: str(it.name), qty, unit: str(it.unit, 40), mat, lab, pm, pl })
      }
      tasks.push({ name: str(t.name), items })
    }
    cats.push({ name: str(c.name), mult: c.mult, ...(c.equip === true ? { equip: true } : {}), tasks })
  }
  return {
    v: 1,
    planId: str(v.planId, 60),
    planName: str(v.planName),
    project: str(v.project),
    location: str(v.location),
    owner: str(v.owner),
    week: week as number,
    asOf: v.asOf,
    planStart: typeof v.planStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.planStart) ? v.planStart : v.asOf,
    planDays: Number.isInteger(v.planDays) && (v.planDays as number) >= 1 && (v.planDays as number) <= 1500 ? (v.planDays as number) : 7 * (week as number),
    contract,
    unsplit: Number.isInteger(v.unsplit) && (v.unsplit as number) >= 0 ? (v.unsplit as number) : 0,
    cats,
  }
}

/** มีอะไรให้พิมพ์ */
export const hasPwItems = (pw: ProgressWork | null | undefined): pw is ProgressWork =>
  Boolean(pw?.cats.some((c) => c.tasks.some((t) => t.items.length)))
