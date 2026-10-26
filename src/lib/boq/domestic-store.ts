import type { DomItem, DomModel, DomRow, DomSheet } from './domestic'

/**
 * แผนการใช้พัสดุในประเทศที่บันทึกไว้ (R22b · ตาราง `domestic_plans`) — รูปร่างข้อมูล + ตัวตรวจ
 * ใช้ทั้งฝั่ง API (ตรวจก่อนเขียน) และหน้าจอ · ไฟล์นี้ import ได้เฉพาะ type (unit test รันด้วย node ตรง ๆ)
 * · ธงเหล็ก/นำเข้าที่เจ้าของติ๊กอยู่บนแถวรายการของ `model` เลย — ไม่มีก้อน marks แยก
 */

export type SavedDomestic = {
  id: string
  name: string
  siteId: string | null
  sourceFile: string
  model: DomModel
  updatedAt: string
}

export const DOMESTIC_COLUMNS = 'id, name, site_id, source_file, model, updated_at'

type Result<T> = { ok: true; value: T } | { ok: false; error: string }
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, max = 1000) => (typeof v === 'string' ? v.slice(0, max) : '')
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function parseRow(v: unknown): DomRow | null {
  if (!isObj(v)) return null
  const name = str(v.name)
  if (v.kind === 'head') return { kind: 'head', code: str(v.code, 40), name }
  if (v.kind === 'sum') return { kind: 'sum', name }
  if (v.kind === 'text') {
    const price = v.price == null ? null : finite(v.price) && v.price >= 0 ? v.price : NaN
    if (Number.isNaN(price)) return null
    return { kind: 'text', name, price, ...(v.sub === true ? { sub: true } : {}) } as DomRow
  }
  if (v.kind === 'item') {
    if (!finite(v.qty) || v.qty < 0 || !finite(v.price) || v.price < 0) return null
    const id = str(v.id, 400)
    if (!id) return null
    const it: DomItem = {
      kind: 'item', id, code: str(v.code, 40), name, qty: v.qty, unit: str(v.unit, 40), price: v.price,
      steel: v.steel === true, foreign: v.foreign === true,
    }
    return it
  }
  return null
}

/** ตรวจ `DomModel` จากหน้าจอ — ต้องมีรายการพัสดุอย่างน้อยหนึ่งรายการ · id ของรายการห้ามซ้ำ */
export function parseDomModel(v: unknown): Result<DomModel> {
  if (!isObj(v) || !Array.isArray(v.sheets) || v.sheets.length > 200) return fail('DOMESTIC_MODEL_INVALID')
  const ids = new Set<string>()
  const sheets: DomSheet[] = []
  for (const s of v.sheets) {
    if (!isObj(s) || !Array.isArray(s.rows) || s.rows.length > 5000) return fail('DOMESTIC_MODEL_INVALID')
    const rows: DomRow[] = []
    for (const r of s.rows) {
      const row = parseRow(r)
      if (!row) return fail('DOMESTIC_MODEL_INVALID')
      if (row.kind === 'item') {
        if (ids.has(row.id)) return fail('DOMESTIC_MODEL_INVALID')
        ids.add(row.id)
      }
      rows.push(row)
    }
    sheets.push({ sheet: str(s.sheet, 200), rows })
  }
  if (!ids.size) return fail('DOMESTIC_MODEL_EMPTY')
  return { ok: true, value: { project: str(v.project), sheets } }
}

export function parseDomName(v: unknown): Result<string> {
  const name = str(v, 300).trim()
  return name ? { ok: true, value: name } : fail('DOMESTIC_NAME_REQUIRED')
}

/** แถวจากตาราง → รูปที่หน้าจอใช้ · รูปร่างเพี้ยน = null */
export function domesticFromRow(r: Record<string, unknown>): SavedDomestic | null {
  const m = parseDomModel(r.model)
  if (!m.ok || typeof r.id !== 'string' || typeof r.updated_at !== 'string') return null
  return {
    id: r.id,
    name: str(r.name, 300),
    siteId: typeof r.site_id === 'string' ? r.site_id : null,
    sourceFile: str(r.source_file, 300),
    model: m.value,
    updatedAt: r.updated_at,
  }
}

export const DOMESTIC_MESSAGES: Record<string, string> = {
  BAD_REQUEST: 'ข้อมูลไม่ถูกต้อง ลองใหม่อีกครั้ง',
  DOMESTIC_MODEL_INVALID: 'ข้อมูลตารางพัสดุไม่ถูกต้อง — อัปโหลด BOQ ใหม่แล้วลองอีกครั้ง',
  DOMESTIC_MODEL_EMPTY: 'ไม่มีรายการค่าวัสดุให้บันทึก',
  DOMESTIC_NAME_REQUIRED: 'ต้องมีชื่อแผน',
  DOMESTIC_NOT_FOUND: 'ไม่พบแผนนี้ — อาจถูกลบไปแล้ว',
  DOMESTIC_CHANGED: 'แผนนี้ถูกแก้จากอีกเครื่องระหว่างที่คุณแก้อยู่ — โหลดหน้าใหม่แล้วติ๊กอีกครั้ง',
  SITE_NOT_FOUND: 'ไม่พบโครงการที่เลือก',
  DOMESTIC_TABLE_MISSING: 'ยังไม่ได้ติดตั้งตารางแผนการใช้วัสดุในฐานข้อมูล — รัน migration 20261027090000_domestic_plans.sql ก่อน',
}
export const domesticMessage = (code: string, fallback = 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง') => DOMESTIC_MESSAGES[code] ?? fallback
