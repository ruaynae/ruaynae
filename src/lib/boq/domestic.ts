/**
 * แผนการใช้พัสดุ/เหล็กที่ผลิตภายในประเทศ (R22 · คำขอเจ้าของ 23 ต.ค. 2569) — ส่วนคำนวณล้วน ไม่ผูก exceljs
 *
 * ที่มา = ส่วนรายละเอียดของแบบ ปร.4 ในไฟล์ BOQ (ชีตเดียวกับที่ `parseBoq` เลือกใช้ — ชีต "เทียบราคา"
 * ที่ค้างในไฟล์จึงไม่ถูกนับ) · เอาเฉพาะ **ราคาค่าวัสดุ** (ราคา/หน่วย × จำนวน) ตามตัวอย่างของเจ้าของ
 * · หมวด/หัวข้อที่ไม่มีค่าวัสดุเลย (งานรื้อถอน) ไม่อยู่ในตาราง · รายการค่าแรงล้วนไม่อยู่ในตาราง
 * · ทุกรายการเริ่มเป็น "พัสดุในประเทศ" — เจ้าของติ๊กรายการที่นำเข้าเองบนเว็บ
 * · เหล็ก (`isSteel`) แยกเป็นตารางของตัวเอง — กฎหมายบังคับเหล็กในประเทศ ≥ 90% แยกจากพัสดุทั่วไป ≥ 60%
 *
 * 🔴 ไฟล์นี้ import ได้เฉพาะ type (unit test รันด้วย node ตรง ๆ)
 */

import type { Grid } from './core'

export type DomItem = {
  kind: 'item'
  /** `<ชีต>#<แถว>` — คงที่ต่อไฟล์ ใช้จำการติ๊กบนเว็บ */
  id: string
  code: string
  name: string
  qty: number
  unit: string
  /** ราคาค่าวัสดุต่อหน่วย (ตาม BOQ) */
  price: number
  steel: boolean
  foreign: boolean
}
export type DomRow =
  | { kind: 'head'; code: string; name: string }
  | DomItem
  /**
   * บรรทัดคำอธิบายต่อ/รายการย่อยใต้รายการ — ราคาที่ BOQ ใส่ไว้แสดงเฉย ๆ ไม่นับรวม
   * · `sub` = หัวข้อย่อยที่ไม่มีเลขลำดับ ("งานหน้าต่าง" · "Built In ตู้…") — BOQ พิมพ์ชิดซ้าย ส่วนคำอธิบายต่อย่อหน้าเข้าไป
   */
  | { kind: 'text'; name: string; price: number | null; sub?: boolean }
  /** รวมย่อยของรายการตั้งแต่หัวข้อ/รวมก่อนหน้า */
  | { kind: 'sum'; name: string }

export type DomSheet = { sheet: string; rows: DomRow[] }
export type DomModel = { project: string; sheets: DomSheet[] }

/** เกณฑ์ขั้นต่ำตามกฎกระทรวงฯ การจัดซื้อจัดจ้างพัสดุที่ผลิตภายในประเทศ */
export const DOMESTIC_MIN = 0.6
export const STEEL_MIN = 0.9

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const isCode = (s: string) => /^\d+(\.\d+)*$/.test(s)
const level = (code: string) => code.split('.').length

/**
 * รายการเหล็ก — เหล็กเส้น/ข้ออ้อย/กลม/รูปพรรณ/ไวร์เมช ฯลฯ
 * · ไม่นับ "โครงคร่าวเหล็กชุบสังกะสี" (ฝ้า/ผนังเบา) และ "ทาสีเหล็ก" ซึ่งไม่ใช่เหล็กโครงสร้าง — เจ้าของติ๊กเพิ่ม/เอาออกบนเว็บได้
 */
export const isSteel = (name: string) =>
  (/เหล็ก\s*(เส้น|ข้ออ้อย|กลม|เสริม|รูปพรรณ|ฉาก|กล่อง|กลวง|แผ่น|ตัว\s*[cChHiIuU]|รางน้ำ|ไวร์|แบน|ท่อ|สี่เหลี่ยม|โครงสร้าง|ตะแกรง|เพลท|plate)|ท่อเหล็ก|ไวร์เมช|wire\s*mesh|\b(SD|SR)\s*-?\s*\d{2}|\b(DB|RB)\s*\d{1,2}\b/i.test(name) ||
    // มาตรฐานเหล็ก: มอก.20 เหล็กกลม · 24 ข้ออ้อย · 107 ท่อเหล็กโครงสร้าง · 1227 รูปพรรณรีดร้อน · 1228 รูปพรรณขึ้นรูปเย็น
    /มอก\.?\s*(20|24|107|1227|1228)\b/.test(name)) &&
  !/ชุบสังกะสี|^\s*-?\s*ทาสี/.test(name)

/** แถวหัวตาราง (มี "รายการ" และ "ราคาค่าวัสดุ") → คอลัมน์ราคาค่าวัสดุต่อหน่วย */
function header(g: Grid): { row: number; price: number } | null {
  for (let r = 0; r < Math.min(g.rows, 25); r += 1) {
    let hasList = false
    let price = -1
    for (let c = 0; c < Math.min(g.cols, 14); c += 1) {
      const t = g.w(r, c)
      if (t === 'รายการ') hasList = true
      if (price < 0 && /^(ราคา)?ค่าวัสดุ/.test(t)) price = c
    }
    if (hasList && price > 0) return { row: r, price }
  }
  return null
}

/** ชื่อรายการ — คอลัมน์ B · แบบเก่าบางไฟล์ลำดับที่อยู่คอลัมน์ A และชื่ออยู่ B เหมือนกัน */
const nameOf = (g: Grid, r: number) => g.w(r, 1) || g.w(r, 2)

/**
 * ส่วนรายละเอียดเริ่มที่ไหน — ชีตแบบใหม่มี "ก้อนสรุปหัวชีต" (รายการระดับงาน หน่วย "งาน") แล้วตามด้วย "รวมหมวด…"
 * ก่อนส่วนรายละเอียด · ไม่มีก้อนสรุป = เริ่มต่อจากหัวตาราง
 */
function detailStart(g: Grid, from: number): number {
  for (let r = from; r < g.rows; r += 1) {
    const name = nameOf(g, r)
    if (/^รวม/.test(name)) return r + 1
    const qty = num(g.v(r, 2))
    if (qty != null && g.w(r, 3) !== 'งาน') return from
  }
  return from
}

function sheetRows(g: Grid): DomRow[] {
  const h = header(g)
  if (!h) return []
  const raw: DomRow[] = []
  let dropping = false
  for (let r = detailStart(g, h.row + 1); r < g.rows; r += 1) {
    const code = g.w(r, 0)
    const name = nameOf(g, r).replace(/\s+/g, ' ').trim()
    if (!name && !code) continue
    if (!name) continue
    const qty = num(g.v(r, 2))
    const price = num(g.v(r, h.price))
    if (/^รวม/.test(name)) {
      dropping = false
      raw.push({ kind: 'sum', name })
      continue
    }
    if (qty != null) {
      // รายการค่าแรงล้วน (ไม่มีค่าวัสดุ) ไม่ใช่พัสดุ — บรรทัดคำอธิบายต่อท้ายมันก็ไม่เอาด้วย
      dropping = !(price != null && price > 0)
      if (dropping) continue
      raw.push({
        kind: 'item', id: `${g.name}#${r + 1}`, code: isCode(code) ? code : '', name: g.v(r, 1) != null ? String(g.v(r, 1)) : name,
        qty, unit: g.w(r, 3), price: price as number, steel: isSteel(name), foreign: false,
      })
      continue
    }
    if (isCode(code)) {
      dropping = false
      raw.push({ kind: 'head', code, name })
      continue
    }
    // แถวรวมย่อยที่ไม่ขึ้นต้นด้วย "รวม" (BOQ บางไฟล์ใส่แค่ชื่องานกับยอดในช่องรวม) — ไม่มีจำนวน แต่มียอดค่าวัสดุรวม
    const subtotal = num(g.v(r, h.price + 1))
    if (subtotal != null && subtotal > 0 && !/^\s*[-–•]/.test(String(g.v(r, 1) ?? ''))) {
      dropping = false
      raw.push({ kind: 'sum', name: `รวม${name}` })
      continue
    }
    const text = String(g.v(r, 1) ?? g.v(r, 2) ?? name)
    const sub = /^[^\s\-–•*(]/.test(text)
    // หัวข้อย่อยชิดซ้ายเริ่มกลุ่มใหม่ ไม่ใช่คำอธิบายต่อของรายการค่าแรงที่ตัดไป
    if (sub) dropping = false
    if (dropping) continue
    raw.push({ kind: 'text', name: g.v(r, 1) != null ? text : name, price: price != null && price > 0 ? price : null, ...(sub ? { sub } : {}) })
  }
  return prune(raw)
}

/**
 * ตัดหัวข้อที่ไม่มีรายการค่าวัสดุอยู่ใต้มัน (เช่น "1.1 หมวดงานรื้อถอน") พร้อมบรรทัดของมัน
 * และรวมย่อยที่ไม่มีรายการให้รวม (รวมทั้งหมวดท้ายชีต — ซ้ำกับรวมย่อยด้านบน)
 * · หัวข้อย่อยไม่มีเลข (`sub`) ที่มีแต่ค่าแรงอยู่ใต้มัน ก็ตัด (คำขอเจ้าของ 23 ต.ค. 2569)
 */
function prune(rows: DomRow[]): DomRow[] {
  const keep = rows.map(() => true)
  rows.forEach((row, i) => {
    if (row.kind !== 'text' || !row.sub) return
    // ตามด้วยหัวข้อมีเลขทันที = ป้ายกลุ่มงานเหนือหมวด ("กลุ่มงานระบบไฟฟ้า") — ปล่อยให้หัวข้อตัดสินเอง
    if (rows[i + 1]?.kind === 'head') return
    let has = false
    for (let j = i + 1; j < rows.length; j += 1) {
      const x = rows[j]
      if (x.kind === 'head' || x.kind === 'sum' || (x.kind === 'text' && x.sub)) break
      if (x.kind === 'item') { has = true; break }
    }
    if (!has) keep[i] = false
  })
  rows.forEach((row, i) => {
    if (row.kind !== 'head') return
    let has = false
    for (let j = i + 1; j < rows.length; j += 1) {
      const x = rows[j]
      if (x.kind === 'head' && level(x.code) <= level(row.code)) break
      if (x.kind === 'item') { has = true; break }
    }
    if (has) return
    keep[i] = false
    // บรรทัดข้อความ/รวมของหัวข้อที่ถูกตัด จนถึงหัวข้อถัดไป
    for (let j = i + 1; j < rows.length && rows[j].kind !== 'head'; j += 1) keep[j] = false
  })
  let items = 0
  const out: DomRow[] = []
  rows.forEach((row, i) => {
    if (!keep[i]) return
    if (row.kind === 'head') items = 0
    if (row.kind === 'item') items += 1
    if (row.kind === 'sum') {
      if (!items) return
      items = 0
    }
    out.push(row)
  })
  // บรรทัดข้อความก่อนหัวข้อแรก (หัวกระดาษที่หลุดมา) และหลังแถวสุดท้ายที่มีตัวเลข (หมายเหตุท้ายชีต) ไม่เอา
  const first = Math.max(0, out.findIndex((r) => r.kind !== 'text'))
  let last = out.length - 1
  while (last >= first && (out[last].kind === 'text' || out[last].kind === 'head')) last -= 1
  return out.slice(first, last + 1)
}

/**
 * ตารางพัสดุจากชีตรายละเอียดที่ `parseBoq` ใช้ (`sources` = `BoqCategory.source` ตามลำดับ)
 * · ชีตเดียวถูกอ้างหลายหมวดได้ — อ่านครั้งเดียว
 */
export function extractDomestic(grids: Grid[], sources: string[], project: string): DomModel {
  const seen = new Set<string>()
  const sheets: DomSheet[] = []
  for (const src of sources) {
    // `BoqCategory.source` = "ปร.5(ก) → 1 งานสถาปัตยกรรม" — ชื่อชีตรายละเอียดคือส่วนหลังลูกศร
    const s = src.split('→').pop()!.trim()
    if (seen.has(s)) continue
    seen.add(s)
    const g = grids.find((x) => x.name === s)
    if (!g) continue
    const rows = sheetRows(g)
    if (rows.some((r) => r.kind === 'item')) sheets.push({ sheet: s, rows })
  }
  return { project, sheets }
}

export const itemsOf = (m: DomModel) => m.sheets.flatMap((s) => s.rows.filter((r): r is DomItem => r.kind === 'item'))
export const itemTotal = (it: DomItem) => it.qty * it.price

export type DomTotals = { count: number; total: number; domestic: number; foreign: number }
export function totals(items: DomItem[]): DomTotals {
  let domestic = 0
  let foreign = 0
  for (const it of items) {
    if (it.foreign) foreign += itemTotal(it)
    else domestic += itemTotal(it)
  }
  return { count: items.length, total: domestic + foreign, domestic, foreign }
}

/** ใส่ค่าที่เจ้าของติ๊กบนเว็บ (เหล็ก/นำเข้า) กลับลงโมเดล — ไม่แก้ของเดิม */
export function applyMarks(m: DomModel, marks: Record<string, { steel?: boolean; foreign?: boolean }>): DomModel {
  return {
    ...m,
    sheets: m.sheets.map((s) => ({
      ...s,
      rows: s.rows.map((r) => (r.kind === 'item' && marks[r.id] ? { ...r, ...marks[r.id] } : r)),
    })),
  }
}
