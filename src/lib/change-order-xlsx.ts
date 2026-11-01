import type { CellValue, Worksheet } from 'exceljs'
import { loadExcel } from './boq/workbook'
import {
  CO_TITLE, blockTotals, coTotals, itemTotals, type ChangeOrder, type CoBlock,
} from './change-order'

/**
 * ไฟล์ Excel "แบบแสดงรายการ ปริมาณงาน และราคา งานเพิ่ม-ลด" (R25) — ผังเดียวกับแผ่นพิมพ์ `change-order-paper.tsx`
 * · ตัวเลขทุกช่องเป็นสูตร (แก้ในไฟล์แล้วยอดตาม) + ค่าที่คำนวณไว้แล้ว (โปรแกรมที่ไม่คำนวณสูตรยังเห็นตัวเลข)
 * · 🔴 สูตรต้องให้ผลเท่า `change-order.ts` ทุกสตางค์: ROUND ทีละช่อง · Factor F = ROUND(รวม × (F − 1), 2)
 * · ทำในเบราว์เซอร์ (exceljs โหลดตอนกด) — ไม่มีไบต์ผ่านเซิร์ฟเวอร์
 */

const FONT = 'TH Sarabun New'
const MONEY = '#,##0.00;-#,##0.00;"-"'
const QTY = '#,##0.00##;-#,##0.00##;"-"'
const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const
const THIN = { style: 'thin' as const }
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN }
const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })
const BAND = { cut: 'FFDBEAFE', add: 'FFFDE2E2' } as const
const f = (formula: string, result: number | string) => ({ formula, result }) as CellValue

type BlockRefs = { total: number }

function styleRow(ws: Worksheet, r: number, opts: { bold?: boolean; band?: string } = {}) {
  for (const c of COLS) {
    const cell = ws.getCell(`${c}${r}`)
    cell.font = { name: FONT, size: 14, bold: opts.bold ?? Boolean(cell.font?.bold) }
    cell.border = BOX
    cell.alignment = { vertical: 'top', wrapText: true, ...(cell.alignment ?? {}) }
    if (opts.band) cell.fill = fill(opts.band)
  }
}

function block(ws: Worksheet, start: number, b: CoBlock, side: 'cut' | 'add', factor: number): { next: number; refs: BlockRefs } {
  const label = b.title || (side === 'cut' ? 'งานลด' : 'งานเพิ่ม')
  let r = start
  ws.getCell(`B${r}`).value = label
  styleRow(ws, r, { bold: true, band: BAND[side] })
  r += 1
  const first = r
  for (const row of b.rows) {
    const at = (c: string) => ws.getCell(`${c}${r}`)
    if (row.t === 'group') {
      at('A').value = row.no
      at('B').value = row.text
      at('A').alignment = { horizontal: 'center' }
      styleRow(ws, r, { bold: true })
    } else if (row.t === 'head') {
      at('B').value = row.text
      styleRow(ws, r, { bold: true })
    } else {
      const t = itemTotals(row)
      at('B').value = row.text
      at('C').value = row.qty ?? 0
      at('D').value = row.unit
      at('E').value = row.mat ?? 0
      at('F').value = f(`ROUND(C${r}*E${r},2)`, t.mat)
      at('G').value = row.lab ?? 0
      at('H').value = f(`ROUND(C${r}*G${r},2)`, t.lab)
      at('I').value = f(`F${r}+H${r}`, t.total)
      at('J').value = row.note
      at('C').numFmt = QTY
      for (const c of ['E', 'F', 'G', 'H', 'I']) at(c).numFmt = MONEY
      at('D').alignment = { horizontal: 'center' }
      at('J').alignment = { horizontal: 'center' }
      styleRow(ws, r)
    }
    r += 1
  }
  const last = Math.max(first, r - 1)
  const t = blockTotals(b, factor)
  const sum = r
  const word = label.split(' ')[0]
  const totalRow = (row: number, text: string, cells: [string, CellValue][], band?: string) => {
    ws.mergeCells(`B${row}:D${row}`)
    ws.getCell(`B${row}`).value = text
    ws.getCell(`B${row}`).alignment = { horizontal: 'center' }
    for (const [c, v] of cells) {
      ws.getCell(`${c}${row}`).value = v
      if (c !== 'E') ws.getCell(`${c}${row}`).numFmt = MONEY
    }
    styleRow(ws, row, { bold: true, band })
  }
  totalRow(sum, `รวม${word}`, [
    ['F', f(`SUM(F${first}:F${last})`, t.mat)],
    ['H', f(`SUM(H${first}:H${last})`, t.lab)],
    ['I', f(`SUM(I${first}:I${last})`, t.sum)],
  ], BAND[side])
  const fr = sum + 1
  totalRow(fr, 'Factor F', [
    ['E', factor],
    ['F', f(`ROUND(F${sum}*($E${fr}-1),2)`, t.fMat)],
    ['H', f(`ROUND(H${sum}*($E${fr}-1),2)`, t.fLab)],
    ['I', f(`ROUND(I${sum}*($E${fr}-1),2)`, t.fSum)],
  ])
  ws.getCell(`E${fr}`).numFmt = '0.0000'
  ws.getCell(`E${fr}`).alignment = { horizontal: 'center' }
  const tr = fr + 1
  totalRow(tr, `รวมยอดทั้งหมด (${label})`, [
    ['F', f(`F${sum}+F${fr}`, t.totalMat)],
    ['H', f(`H${sum}+H${fr}`, t.totalLab)],
    ['I', f(`I${sum}+I${fr}`, t.total)],
  ])
  ws.getCell(`I${tr}`).fill = fill('FFF3EAD7')
  return { next: tr + 2, refs: { total: tr } }
}

export async function buildChangeOrderXlsx(co: ChangeOrder): Promise<ArrayBuffer> {
  const ExcelJS = await loadExcel()
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('งานเพิ่ม-ลด')
  ws.columns = [7, 46, 9, 7, 13, 15, 11, 12, 16, 11].map((width) => ({ width }))

  ws.mergeCells('A1:J1')
  ws.getCell('A1').value = CO_TITLE
  ws.getCell('A1').font = { name: FONT, size: 18, bold: true }
  ws.getCell('A1').alignment = { horizontal: 'center' }
  const head: [string, string][] = [
    ['กลุ่มงาน/งาน', co.work],
    ['ชื่อโครงการ/งานก่อสร้าง', co.project],
    ['สถานที่ก่อสร้าง', co.location],
    ['หน่วยงานเจ้าของโครงการ/งานก่อสร้าง', co.owner],
  ]
  head.forEach(([k, v], i) => {
    const r = i + 2
    ws.mergeCells(`A${r}:B${r}`)
    ws.mergeCells(`C${r}:H${r}`)
    ws.getCell(`A${r}`).value = k
    ws.getCell(`C${r}`).value = v
    ws.getCell(`A${r}`).font = { name: FONT, size: 14, bold: true }
    ws.getCell(`C${r}`).font = { name: FONT, size: 14 }
    ws.getCell(`C${r}`).alignment = { wrapText: true, vertical: 'top' }
  })
  if (co.drawingNo) {
    ws.getCell('I2').value = 'แบบเลขที่'
    ws.getCell('J2').value = co.drawingNo
    ws.getCell('I2').font = { name: FONT, size: 14, bold: true }
    ws.getCell('J2').font = { name: FONT, size: 14 }
  }
  ws.getCell('J6').value = 'หน่วย : บาท'
  ws.getCell('J6').font = { name: FONT, size: 13 }
  ws.getCell('J6').alignment = { horizontal: 'right' }

  // หัวตาราง 2 แถว (7–8) — พิมพ์ซ้ำทุกหน้า
  const labels: [string, string][] = [
    ['A7', 'ลำดับที่'], ['B7', 'รายการ'], ['C7', 'จำนวน'], ['D7', 'หน่วย'], ['E7', 'ราคาค่าวัสดุ'],
    ['G7', 'ราคาค่าแรง'], ['I7', 'รวมค่าวัสดุและแรงงาน'], ['J7', 'หมายเหตุ'],
    ['E8', 'ราคา/หน่วย'], ['F8', 'รวม'], ['G8', 'ราคา/หน่วย'], ['H8', 'รวม'],
  ]
  for (const m of ['A7:A8', 'B7:B8', 'C7:C8', 'D7:D8', 'E7:F7', 'G7:H7', 'I7:I8', 'J7:J8']) ws.mergeCells(m)
  for (const [a, t] of labels) ws.getCell(a).value = t
  for (const r of [7, 8]) {
    for (const c of COLS) {
      const cell = ws.getCell(`${c}${r}`)
      cell.font = { name: FONT, size: 14, bold: true }
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      cell.border = BOX
      cell.fill = fill('FFE5E7EB')
    }
  }

  const t = coTotals(co)
  let r = 9
  let cutTotal: string | null = null
  let addTotal: string | null = null
  if (co.cut.rows.length) {
    const b = block(ws, r, co.cut, 'cut', co.factor)
    cutTotal = `I${b.refs.total}`
    r = b.next
  }
  if (co.add.rows.length) {
    const b = block(ws, r, co.add, 'add', co.factor)
    addTotal = `I${b.refs.total}`
    r = b.next
  }
  const diff = `${addTotal ?? 0}-${cutTotal ?? 0}`
  ws.mergeCells(`B${r}:H${r}`)
  ws.getCell(`B${r}`).value = f(`IF(${diff}>=0,"ส่วนต่าง งานเพิ่ม","ส่วนต่าง งานลด")`, `ส่วนต่าง ${t.kind ?? ''}`.trim())
  ws.getCell(`B${r}`).alignment = { horizontal: 'center' }
  ws.getCell(`I${r}`).value = f(`ABS(${diff})`, t.amount)
  ws.getCell(`I${r}`).numFmt = MONEY
  styleRow(ws, r, { bold: true })
  ws.getCell(`I${r}`).fill = fill('FFDBEAFE')

  ws.views = [{ state: 'frozen', ySplit: 8 }]
  ws.pageSetup = {
    paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
    printTitlesRow: '7:8', margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
  }
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>
}

export const changeOrderFileName = (co: ChangeOrder) =>
  `งานเพิ่ม-ลด_${(co.project || 'โครงการ').slice(0, 60).replace(/[\\/:*?"<>|]/g, '')}.xlsx`
