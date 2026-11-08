/**
 * R35 · สรุปการใช้พัสดุในประเทศ (หนังสือ "ขอส่งสรุปการใช้พัสดุในประเทศ")
 *
 * ภาพนิ่งของ "ตารางรายงานผลการใช้พัสดุที่ผลิตภายในประเทศ" (ชีตสรุปของไฟล์ Excel แผนการใช้พัสดุในประเทศ · R22)
 * คิดจากแผนที่บันทึกไว้ (`domestic_plans`) — พัสดุ = ทุกรายการ · เหล็ก = รายการที่ติ๊กเป็นเหล็ก (เกณฑ์ 60% / 90%)
 * · เก็บใน `letters.fields.domesticSummary` (jsonb เดิม · ไม่มี migration) · แก้แผนทีหลัง หนังสือไม่เปลี่ยนจนกด "ดึงใหม่"
 *
 * 🔴 ไฟล์ล้วน import ได้เฉพาะ type (unit test รันด้วย node ตรง ๆ) — เกณฑ์ซ้ำกับ `DOMESTIC_MIN`/`STEEL_MIN` ใน boq/domestic.ts (แก้คู่กัน)
 */
import type { DomItem, DomModel } from './boq/domestic'

export const DS_ATTACHMENT = 'สรุปการใช้พัสดุในประเทศ จำนวน 1 ชุด'
export const DS_TITLE = 'ตารางรายงานผลการใช้พัสดุที่ผลิตภายในประเทศ'
export const DS_MIN_MATERIAL = 0.6
export const DS_MIN_STEEL = 0.9

export type DsPart = { count: number; domestic: number; foreign: number }
export type DomesticSummary = {
  v: 1
  planId: string
  planName: string
  project: string
  material: DsPart
  /** null = โครงการไม่มีรายการเหล็ก */
  steel: DsPart | null
}

const r2 = (n: number) => Math.round(n * 100) / 100

function part(items: DomItem[]): DsPart {
  let domestic = 0
  let foreign = 0
  for (const it of items) {
    const t = it.qty * it.price
    if (it.foreign) foreign += t
    else domestic += t
  }
  return { count: items.length, domestic: r2(domestic), foreign: r2(foreign) }
}

export function buildDomesticSummary(model: DomModel, meta: { planId: string; planName: string }): DomesticSummary {
  const items = model.sheets.flatMap((s) => s.rows.filter((r): r is DomItem => r.kind === 'item'))
  const steel = items.filter((it) => it.steel)
  return {
    v: 1, planId: meta.planId, planName: meta.planName, project: model.project,
    material: part(items), steel: steel.length ? part(steel) : null,
  }
}

export const dsTotal = (p: DsPart) => r2(p.domestic + p.foreign)
/** สัดส่วนในประเทศ (0–1) — ไม่มีมูลค่า = 0 */
export const dsRate = (p: DsPart) => (dsTotal(p) > 0 ? p.domestic / dsTotal(p) : 0)
export const dsPass = (p: DsPart, min: number) => dsTotal(p) > 0 && dsRate(p) >= min
export const hasDomesticSummary = (s: DomesticSummary | null | undefined): s is DomesticSummary => Boolean(s && s.material.count > 0)

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '')
const money = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e13 ? v : null)
function parsePart(v: unknown): DsPart | null {
  if (!isObj(v)) return null
  const domestic = money(v.domestic)
  const foreign = money(v.foreign)
  const count = typeof v.count === 'number' && Number.isInteger(v.count) && v.count >= 0 ? v.count : null
  return domestic == null || foreign == null || count == null ? null : { count, domestic, foreign }
}

export function parseDomesticSummary(v: unknown): DomesticSummary | null {
  if (!isObj(v) || v.v !== 1) return null
  const material = parsePart(v.material)
  if (!material) return null
  const steel = v.steel == null ? null : parsePart(v.steel)
  if (v.steel != null && !steel) return null
  return { v: 1, planId: str(v.planId, 60), planName: str(v.planName), project: str(v.project), material, steel }
}
