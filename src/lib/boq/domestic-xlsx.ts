import type { Workbook, Worksheet } from 'exceljs'
import { loadExcel } from './workbook'
import { DOMESTIC_MIN, STEEL_MIN, itemsOf, type DomItem, type DomModel, type DomRow } from './domestic'

/**
 * ไฟล์ Excel "แผนการใช้พัสดุที่ผลิตในประเทศ" (R22) — ผังตามไฟล์ตัวอย่างของเจ้าของ
 * · ชีต "สรุปมูลค่า" + ชีตละหนึ่งชีตรายละเอียดของ BOQ (ชื่อเดียวกัน) + ชีต "เหล็กในประเทศ" เมื่อมีรายการเหล็ก
 * · คอลัมน์ A–H: ลำดับที่ · รายการ · จำนวน · หน่วย · ราคาค่าวัสดุ (ราคา/หน่วย · รวม) · พัสดุในประเทศ · พัสดุต่างประเทศ
 * · ตัวเลขทุกช่องเป็นสูตร (รวม = จำนวน × ราคา · รวมย่อย = SUM) — เจ้าของแก้ในไฟล์แล้วยอดตามเอง
 * · คอลัมน์ I ซ่อน = ธงแถวรายการ (1) ให้แถว "รวมทั้งสิ้น" กับชีตสรุปนับ/รวมเฉพาะรายการ
 */

const FONT = 'TH Sarabun New'
const MONEY = '_-* #,##0.00_-;\\-* #,##0.00_-;_-* "-"??_-;_-@'
const GREY = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFF2F2F2' } }
const THIN = { style: 'thin' as const }
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN }
const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const
const FIRST = 6

/** ชื่อชีตของ Excel: ≤ 31 ตัว ห้าม : \ / ? * [ ] และห้ามซ้ำ */
function sheetName(raw: string, used: Set<string>) {
  const base = raw.replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || 'ชีต'
  let n = base
  for (let i = 2; used.has(n); i += 1) n = `${base.slice(0, 28)} ${i}`
  used.add(n)
  return n
}
const ref = (sheet: string, cell: string) => `'${sheet.replace(/'/g, "''")}'!${cell}`

function font(ws: Worksheet, from: number, to: number) {
  for (let r = from; r <= to; r += 1) {
    for (const c of COLS) {
      const cell = ws.getCell(`${c}${r}`)
      cell.font = { name: FONT, size: 14, ...(cell.font?.bold ? { bold: true } : {}) }
    }
  }
}

/** หัวตาราง (แถว 1–5) แบบเดียวกันทุกชีตรายละเอียด */
function head(ws: Worksheet, title: string, project: string) {
  ws.columns = [8.3, 58, 9.8, 7.5, 14.7, 17, 17, 15, 4].map((width) => ({ width }))
  ws.getColumn('I').hidden = true
  ws.mergeCells('A1:H1')
  ws.mergeCells('A2:H2')
  ws.getCell('A1').value = title
  ws.getCell('A1').font = { name: FONT, size: 18, bold: true }
  ws.getCell('A2').value = project
  ws.getCell('A2').font = { name: FONT, size: 16, bold: true }
  for (const a of ['A1', 'A2']) ws.getCell(a).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  const labels: [string, string][] = [
    ['A4', 'ลำดับที่'], ['B4', 'รายการ'], ['C4', 'จำนวน'], ['D4', 'หน่วย'], ['E4', 'ราคาค่าวัสดุ'],
    ['G4', 'พัสดุในประเทศ'], ['H4', 'พัสดุต่างประเทศ'], ['E5', 'ราคา/หน่วย'], ['F5', 'รวม'],
  ]
  for (const m of ['A4:A5', 'B4:B5', 'C4:C5', 'D4:D5', 'E4:F4', 'G4:G5', 'H4:H5']) ws.mergeCells(m)
  for (const [a, t] of labels) ws.getCell(a).value = t
  for (const r of [4, 5]) {
    for (const c of COLS) {
      const cell = ws.getCell(`${c}${r}`)
      cell.font = { name: FONT, size: 14, bold: true }
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      cell.border = BOX
      cell.fill = GREY
    }
  }
  ws.views = [{ state: 'frozen', ySplit: 5 }]
  ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true, printTitlesRow: '4:5', margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } }
}

/** เขียนแถวรายละเอียด · คืนแถวสุดท้ายที่เขียน */
function body(ws: Worksheet, rows: DomRow[], pick: (it: DomItem) => boolean = () => true): number {
  let r = FIRST
  let groupStart = FIRST
  for (const row of rows) {
    if (row.kind === 'item' && !pick(row)) continue
    const at = (c: string) => ws.getCell(`${c}${r}`)
    if (row.kind === 'head') {
      at('A').value = /^\d+$/.test(row.code) ? Number(row.code) : row.code
      at('B').value = row.name
      at('A').font = at('B').font = { bold: true }
      at('A').alignment = { horizontal: 'center' }
      groupStart = r + 1
    } else if (row.kind === 'item') {
      if (row.code) at('A').value = row.code
      at('A').alignment = { horizontal: 'center' }
      at('B').value = row.name
      at('C').value = row.qty
      at('D').value = row.unit
      at('D').alignment = { horizontal: 'center' }
      at('E').value = row.price
      at('F').value = { formula: `C${r}*E${r}` }
      at('G').value = row.foreign ? 0 : { formula: `F${r}` }
      at('H').value = row.foreign ? { formula: `F${r}` } : 0
      at('I').value = 1
    } else if (row.kind === 'text') {
      at('B').value = row.name
      if (row.price != null) at('E').value = row.price
    } else {
      at('B').value = row.name
      for (const c of ['F', 'G', 'H']) at(c).value = { formula: `SUM(${c}${groupStart}:${c}${r - 1})` }
      for (const c of COLS) {
        at(c).fill = GREY
        at(c).font = { bold: true }
      }
      at('B').alignment = { horizontal: 'center' }
      groupStart = r + 1
    }
    at('B').alignment = { ...(at('B').alignment ?? {}), wrapText: true, vertical: 'top' }
    for (const c of ['C', 'E', 'F', 'G', 'H']) at(c).numFmt = c === 'C' ? '#,##0.##' : MONEY
    r += 1
  }
  return r - 1
}

/** แถว "รวมทั้งสิ้น" (เฉพาะแถวรายการ ผ่านธงคอลัมน์ I) + เส้นตาราง + ฟอนต์ · คืนเลขแถวรวม */
function finish(ws: Worksheet, last: number, label: string): number {
  const t = last + 1
  ws.getCell(`B${t}`).value = label
  for (const c of ['F', 'G', 'H']) ws.getCell(`${c}${t}`).value = { formula: `SUMIF($I$${FIRST}:$I$${Math.max(last, FIRST)},1,${c}${FIRST}:${c}${Math.max(last, FIRST)})` }
  ws.getCell(`I${t}`).value = { formula: `SUM(I${FIRST}:I${Math.max(last, FIRST)})` }
  for (const c of COLS) {
    const cell = ws.getCell(`${c}${t}`)
    cell.fill = GREY
    cell.font = { bold: true }
    if (c !== 'A' && c !== 'B' && c !== 'C' && c !== 'D') cell.numFmt = MONEY
  }
  ws.getCell(`B${t}`).alignment = { horizontal: 'center' }
  for (let r = FIRST; r <= t; r += 1) for (const c of COLS) ws.getCell(`${c}${r}`).border = BOX
  font(ws, FIRST, t)
  return t
}

type Part = { sheet: string; total: number }

function summary(ws: Worksheet, project: string, parts: Part[], steel: Part | null) {
  ws.columns = [40.8, 20.8, 20.8, 16].map((width) => ({ width }))
  ws.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true }
  const sum = (col: string) => (parts.length ? parts.map((p) => ref(p.sheet, `${col}${p.total}`)).join('+') : '0')
  const put = (a: string, v: unknown, o: { bold?: boolean; size?: number; center?: boolean; fmt?: string; box?: boolean } = {}) => {
    const c = ws.getCell(a)
    c.value = v as never
    c.font = { name: FONT, size: o.size ?? 14, bold: o.bold }
    if (o.center) c.alignment = { horizontal: 'center', vertical: 'middle' }
    if (o.fmt) c.numFmt = o.fmt
    if (o.box) c.border = BOX
  }
  ws.mergeCells('A1:D1')
  ws.mergeCells('A2:D2')
  put('A1', project, { bold: true, size: 16, center: true })
  put('A2', 'ตารางรายงานผลการใช้พัสดุที่ผลิตภายในประเทศ', { bold: true, size: 18, center: true })

  const block = (top: number, what: string, cols: { count: string; dom: string; foreign: string }, min: number) => {
    put(`A${top}`, `การใช้${what}ทั้งโครงการ`, { bold: true })
    put(`A${top + 1}`, { formula: `"รายการใช้${what}ทั้งโครงการ     "&TEXT(${cols.count},"#,##0")&"     รายการ"` }, { bold: true })
    put(`A${top + 2}`, { formula: `"มูลค่า${what}ทั้งโครงการ     "&TEXT(${cols.dom}+${cols.foreign},"#,##0.00")&"     บาท"` }, { bold: true })
    put(`A${top + 4}`, `มูลค่าการใช้${what}ที่ผลิตภายในประเทศ`, { bold: true })
    const h = top + 6
    ;[['A', 'รายการ'], ['B', 'หน่วย (บาท)'], ['C', 'จำนวนเงิน'], ['D', 'อัตรา (ร้อยละ)']].forEach(([c, t]) => put(`${c}${h}`, t, { bold: true, center: true, box: true }))
    const rows: [string, string][] = [[`มูลค่า${what}ที่ผลิตภายในประเทศ`, cols.dom], [`มูลค่า${what}ที่ผลิตจากต่างประเทศ`, cols.foreign]]
    rows.forEach(([label, f], i) => {
      const r = h + 1 + i
      put(`A${r}`, label, { box: true })
      put(`B${r}`, { formula: f }, { fmt: MONEY, box: true })
      put(`C${r}`, { formula: `B${r}` }, { fmt: MONEY, box: true })
      put(`D${r}`, { formula: `IF(($C$${h + 1}+$C$${h + 2})=0,0,C${r}/($C$${h + 1}+$C$${h + 2}))` }, { fmt: '0.00%', box: true, center: true })
    })
    const t = h + 3
    put(`A${t}`, 'รวม', { bold: true, box: true, center: true })
    put(`B${t}`, { formula: `B${h + 1}+B${h + 2}` }, { bold: true, fmt: MONEY, box: true })
    put(`C${t}`, { formula: `C${h + 1}+C${h + 2}` }, { bold: true, fmt: MONEY, box: true })
    put(`D${t}`, { formula: `D${h + 1}+D${h + 2}` }, { bold: true, fmt: '0.00%', box: true, center: true })
    put(`A${t + 1}`, { formula: `"เกณฑ์ขั้นต่ำ ร้อยละ ${Math.round(min * 100)} · "&IF(D${h + 1}>=${min},"ผ่านเกณฑ์","ต่ำกว่าเกณฑ์")` })
    return t + 3
  }

  const next = block(4, 'พัสดุ', { count: sum('I'), dom: sum('G'), foreign: sum('H') }, DOMESTIC_MIN)
  if (steel) {
    block(next, 'เหล็ก', { count: ref(steel.sheet, `I${steel.total}`), dom: ref(steel.sheet, `G${steel.total}`), foreign: ref(steel.sheet, `H${steel.total}`) }, STEEL_MIN)
  } else {
    put(`A${next}`, 'เหล็ก: โครงการนี้ไม่มีรายการเหล็ก (ไม่ต้องทำแผนการใช้เหล็กที่ผลิตในประเทศ)', { bold: true })
  }
}

/** ไฟล์ทั้งเล่ม → ArrayBuffer */
export async function buildDomesticXlsx(model: DomModel): Promise<ArrayBuffer> {
  const ExcelJS = await loadExcel()
  const wb: Workbook = new ExcelJS.Workbook()
  wb.creator = 'RUAYNAE'
  const used = new Set<string>(['สรุปมูลค่า', 'เหล็กในประเทศ'])
  const sum = wb.addWorksheet('สรุปมูลค่า')

  const parts: Part[] = []
  for (const s of model.sheets) {
    const name = sheetName(s.sheet, used)
    const ws = wb.addWorksheet(name)
    head(ws, 'ตารางจัดทำแผนการใช้วัสดุที่ผลิตในประเทศ', model.project)
    parts.push({ sheet: name, total: finish(ws, body(ws, s.rows), 'รวมทั้งสิ้น') })
  }

  let steel: Part | null = null
  if (itemsOf(model).some((it) => it.steel)) {
    const ws = wb.addWorksheet('เหล็กในประเทศ')
    head(ws, 'ตารางจัดทำแผนการใช้เหล็กที่ผลิตในประเทศ', model.project)
    // ชีตเหล็ก: หัวข้อ = ชื่อชีตรายละเอียด · รายการ = เฉพาะที่ติ๊กเป็นเหล็ก · ไม่มีรวมย่อย
    const rows: DomRow[] = model.sheets.flatMap((s) => {
      const items = s.rows.filter((r): r is DomItem => r.kind === 'item' && r.steel)
      return items.length ? [{ kind: 'head' as const, code: '', name: s.sheet }, ...items] : []
    })
    steel = { sheet: 'เหล็กในประเทศ', total: finish(ws, body(ws, rows), 'รวมเหล็กทั้งสิ้น') }
  }

  summary(sum, model.project, parts, steel)
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>
}
