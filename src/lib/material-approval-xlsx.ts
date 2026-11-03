import { loadExcel } from './boq/workbook'
import { MA_TITLE, maCell, maItems, type MaterialApproval } from './material-approval'

/**
 * ไฟล์ Excel "ตารางรายการขออนุมัติใช้วัสดุ" (R26) — ผังเดียวกับแผ่นพิมพ์ `material-approval-paper.tsx`
 * · A4 แนวนอน · หัวตารางพิมพ์ซ้ำทุกหน้า · ทำในเบราว์เซอร์ (exceljs โหลดตอนกด)
 */

const FONT = 'TH Sarabun New'
const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const
const THIN = { style: 'thin' as const }
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN }

export async function buildMaterialApprovalXlsx(
  ma: MaterialApproval,
  head: { contract: string; subject: string; contractor: string },
): Promise<ArrayBuffer> {
  const ExcelJS = await loadExcel()
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('ขออนุมัติใช้วัสดุ')
  ws.columns = [7, 20, 22, 26, 26, 30, 18].map((width) => ({ width }))

  ws.mergeCells('A1:G1')
  ws.getCell('A1').value = MA_TITLE
  ws.getCell('A1').font = { name: FONT, size: 18, bold: true }
  ws.getCell('A1').alignment = { horizontal: 'center' }

  const headRow = (r: number, k1: string, v1: string, k2: string, v2: string) => {
    ws.getCell(`A${r}`).value = k1
    ws.mergeCells(`B${r}:D${r}`)
    ws.getCell(`B${r}`).value = v1
    ws.getCell(`E${r}`).value = k2
    ws.mergeCells(`F${r}:G${r}`)
    ws.getCell(`F${r}`).value = v2
    for (const c of COLS) {
      ws.getCell(`${c}${r}`).font = { name: FONT, size: 14, bold: c === 'A' || c === 'E' }
      ws.getCell(`${c}${r}`).alignment = { vertical: 'top', wrapText: true }
    }
    ws.getCell(`E${r}`).alignment = { horizontal: 'right', vertical: 'top' }
  }
  headRow(3, 'โครงการ:', ma.project, 'สัญญาจ้าง:', head.contract)
  headRow(4, 'ผู้รับจ้าง:', head.contractor, 'เรื่อง:', head.subject)

  const H = 6
  const titles = ['เลขที่', 'รายการวัสดุ', 'รูปแบบรายการ', 'แบบแสดงปริมาณราคา', 'รายการประกอบแบบ', 'รายละเอียดขออนุมัติใช้', 'หมายเหตุ']
  titles.forEach((t, i) => {
    const cell = ws.getCell(`${COLS[i]}${H}`)
    cell.value = t
    cell.font = { name: FONT, size: 14, bold: true }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = BOX
  })

  maItems(ma).forEach((it, i) => {
    const r = H + 1 + i
    const vals = [i + 1, it.name.trim(), maCell(it.drawing), maCell(it.boq), maCell(it.spec), maCell(it.detail), it.note.trim()]
    vals.forEach((v, k) => {
      const cell = ws.getCell(`${COLS[k]}${r}`)
      cell.value = v
      cell.font = { name: FONT, size: 14 }
      cell.border = BOX
      cell.alignment = { vertical: 'top', wrapText: true, horizontal: k === 0 || k === 6 ? 'center' : 'left' }
    })
  })

  ws.views = [{ state: 'frozen', ySplit: H }]
  ws.pageSetup = {
    paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
    printTitlesRow: `${H}:${H}`, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
  }
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>
}

export const materialApprovalFileName = (subject: string) =>
  `${(subject || 'ขออนุมัติใช้วัสดุ').slice(0, 60).replace(/[\\/:*?"<>|]/g, '')}.xlsx`
