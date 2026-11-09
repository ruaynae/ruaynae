/**
 * R37 · ใบ "รายละเอียดโครงการ" + "สรุปความก้าวหน้าของโครงการ" แนบหลังใบปะหน้าหนังสือส่งมอบงาน (คำสั่งเจ้าของ 9 พ.ย. 2569)
 *
 * · ข้อมูลโครงการ (ชื่อ ผู้ว่าจ้าง สัญญา วันเริ่ม/สิ้นสุด งวด ราคา) เติมจากโครงการ/แผนงานให้ แก้ได้ — เก็บใน `letters.fields.projectSummary` (jsonb เดิม · ไม่มี migration)
 * · 🔴 ใบสรุปความก้าวหน้า **คิดตอนพิมพ์จากภาพนิ่งปริมาณงานที่แล้วเสร็จของหนังสือฉบับเดียวกัน** (`progressWork`) —
 *   ตัวเลขจึงตรงกับตารางปริมาณงาน/S-Curve เสมอ (สูตรเดียวกับ `catSum` ใน progress-work.ts: Σ (ค่าวัสดุ×%วัสดุ + ค่าแรง×%แรง) × ตัวคูณ)
 *   ส่วนระยะเวลาคิดจากวันเริ่ม/สิ้นสุดสัญญา ณ "ผลงาน ณ วันที่" · ส่วนปีงบประมาณ (เบิกจ่ายแล้ว) เจ้าของกรอก
 * · ไฟล์ล้วน import ได้เฉพาะ type (unit test รันด้วย node ตรง ๆ)
 */
import type { ProgressWork } from './progress-work'

export const PS_ATTACHMENT = 'รายละเอียดโครงการและสรุปความก้าวหน้าของโครงการ 1 ชุด'
export const PS_GROUP_BUILD = 'งานปรับปรุงอาคาร'
export const PS_GROUP_EQUIP = 'งานครุภัณฑ์จัดซื้อ หรือสั่งซื้อ'
export const PS_LIMITS = { text: 300, budgetRows: 10 } as const

export type PsBudgetRow = { label: string; budget: number; paid: number }
export type ProjectSummary = {
  v: 1
  project: string
  owner: string
  location: string
  contractNo: string
  /** `YYYY-MM-DD` หรือ '' */
  contractDate: string
  start: string
  end: string
  /** งวดงานทั้งหมด · null = ยังไม่กรอก */
  installments: number | null
  amendments: string
  /** ราคาค่าก่อสร้างตามสัญญา · null = ยังไม่กรอก */
  contract: number | null
  contractor: string
  rep: string
  budget: PsBudgetRow[]
}

const ISO = /^\d{4}-\d{2}-\d{2}$/
const DAY = 864e5
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`)
const validIso = (s: string) => ISO.test(s) && !Number.isNaN(ms(s))

/** ปีงบประมาณ (พ.ศ.) ของวันที่ — ต.ค.–ธ.ค. นับเป็นปีงบถัดไป */
export function fiscalYearBE(iso: string): number {
  if (!validIso(iso)) return 0
  const y = Number(iso.slice(0, 4))
  const m = Number(iso.slice(5, 7))
  return y + 543 + (m >= 10 ? 1 : 0)
}

export function emptyProjectSummary(): ProjectSummary {
  return { v: 1, project: '', owner: '', location: '', contractNo: '', contractDate: '', start: '', end: '', installments: null, amendments: '', contract: null, contractor: '', rep: '', budget: [] }
}

/** ระยะเวลาก่อสร้างรวม (วัน นับวันเริ่มและวันสิ้นสุด) — ข้อมูลไม่ครบ = null */
export function psTotalDays(s: Pick<ProjectSummary, 'start' | 'end'>): number | null {
  if (!validIso(s.start) || !validIso(s.end)) return null
  const d = Math.round((ms(s.end) - ms(s.start)) / DAY) + 1
  return d >= 1 ? d : null
}

export type PsTime = { total: number; used: number; remain: number; usedPct: number; remainPct: number }
/** ใช้ไปแล้ว/คงเหลือ ณ วัน `asOf` (นับวันเริ่มเป็นวันที่ 1 · ไม่เกิน/ต่ำกว่าช่วงสัญญา) */
export function psTime(s: Pick<ProjectSummary, 'start' | 'end'>, asOf: string): PsTime | null {
  const total = psTotalDays(s)
  if (total == null || !validIso(asOf)) return null
  const used = Math.min(total, Math.max(0, Math.round((ms(asOf) - ms(s.start)) / DAY) + 1))
  return { total, used, remain: total - used, usedPct: (used / total) * 100, remainPct: ((total - used) / total) * 100 }
}

export type PsGroup = { name: string; contract: number; actual: number }
/** มูลค่าตามสัญญา/ที่ได้จริงต่อกลุ่ม (หลังตัวคูณ Factor F / VAT) — กลุ่มครุภัณฑ์ = หมวดที่มาจากแบบ ปร.5(ข) */
export function psGroups(pw: ProgressWork): PsGroup[] {
  const sum = (cats: ProgressWork['cats']): { contract: number; actual: number } => {
    let contract = 0
    let actual = 0
    for (const c of cats) {
      for (const t of c.tasks) {
        for (const it of t.items) {
          contract += (it.mat + it.lab) * c.mult
          actual += (it.mat * it.pm + it.lab * it.pl) * c.mult
        }
      }
    }
    return { contract, actual }
  }
  const build = pw.cats.filter((c) => !c.equip)
  const equip = pw.cats.filter((c) => c.equip)
  const out: PsGroup[] = []
  if (build.length) out.push({ name: PS_GROUP_BUILD, ...sum(build) })
  if (equip.length) out.push({ name: PS_GROUP_EQUIP, ...sum(equip) })
  return out
}

export type PsProgress = { groups: PsGroup[]; contract: number; actual: number; contractPct: number[]; actualPct: number[]; leftPct: number[]; totalActualPct: number; totalLeftPct: number }
/** ตารางหมวดงาน: % คิดจากราคาค่าก่อสร้างตามสัญญา (`pw.contract`) — คงค้าง % = % ตามสัญญา − % ที่ได้จริง */
export function psProgress(pw: ProgressWork): PsProgress {
  const groups = psGroups(pw)
  const base = pw.contract > 0 ? pw.contract : groups.reduce((s, g) => s + g.contract, 0)
  const pct = (x: number) => (base > 0 ? (x / base) * 100 : 0)
  const actual = groups.reduce((s, g) => s + g.actual, 0)
  return {
    groups, contract: base, actual,
    contractPct: groups.map((g) => pct(g.contract)),
    actualPct: groups.map((g) => pct(g.actual)),
    leftPct: groups.map((g) => pct(g.contract - g.actual)),
    totalActualPct: pct(actual),
    totalLeftPct: pct(base - actual),
  }
}

/** แถวปีงบประมาณ: เงินงบประมาณ / เบิกจ่ายแล้ว / คงเหลือ (บาท · % ของงบรวม) */
export function psBudget(rows: readonly PsBudgetRow[]) {
  const totalBudget = rows.reduce((s, r) => s + r.budget, 0)
  const pct = (x: number) => (totalBudget > 0 ? (x / totalBudget) * 100 : 0)
  const lines = rows.map((r) => ({ label: r.label, budget: r.budget, budgetPct: pct(r.budget), paid: r.paid, paidPct: pct(r.paid), left: r.budget - r.paid, leftPct: pct(r.budget - r.paid) }))
  const paid = rows.reduce((s, r) => s + r.paid, 0)
  return { lines, total: { budget: totalBudget, budgetPct: totalBudget > 0 ? 100 : 0, paid, paidPct: pct(paid), left: totalBudget - paid, leftPct: pct(totalBudget - paid) } }
}

/** ค่าตั้งต้นแถวปีงบประมาณ: ปีงบของวันสิ้นสุดสัญญา · งบ = ราคาตามสัญญา · เบิกจ่ายแล้ว 0 */
export function defaultBudget(end: string, contract: number | null): PsBudgetRow[] {
  const y = fiscalYearBE(end)
  return y > 0 && contract != null && contract > 0 ? [{ label: `พ.ศ. ${y}`, budget: contract, paid: 0 }] : []
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, max: number = PS_LIMITS.text) => (typeof v === 'string' ? v.slice(0, max) : '')
const iso = (v: unknown) => (typeof v === 'string' && validIso(v) ? v : '')
const money = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e13 ? v : null)

export function parseProjectSummary(v: unknown): ProjectSummary | null {
  if (!isObj(v) || v.v !== 1) return null
  const inst = typeof v.installments === 'number' && Number.isInteger(v.installments) && v.installments >= 1 && v.installments <= 99 ? v.installments : null
  const budget: PsBudgetRow[] = []
  if (Array.isArray(v.budget)) {
    for (const r of v.budget.slice(0, PS_LIMITS.budgetRows)) {
      if (!isObj(r)) continue
      const b = money(r.budget)
      const p = money(r.paid)
      if (b != null && p != null) budget.push({ label: str(r.label, 40), budget: b, paid: p })
    }
  }
  return {
    v: 1, project: str(v.project), owner: str(v.owner), location: str(v.location), contractNo: str(v.contractNo, 60),
    contractDate: iso(v.contractDate), start: iso(v.start), end: iso(v.end), installments: inst, amendments: str(v.amendments),
    contract: money(v.contract), contractor: str(v.contractor), rep: str(v.rep, 120), budget,
  }
}
