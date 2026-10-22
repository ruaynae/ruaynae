import type { Cell, CellValue, Font, PaperSize, Workbook, Worksheet } from 'exceljs'
import {
  activeTasks,
  distribute,
  norm,
  parseBoq,
  type BoqCategory,
  type BoqProject,
  type Grid,
} from './core'
import { addLineCharts } from './chart-xml'
import { isXls, readXlsGrids } from './xls'
import { readProgress } from './progress-core'
import {
  LP, LW, addProgressSheets, periodWeeksRange, progressLayout, summaryPeriodCell, summaryPeriodRange, taskPeriodRange,
} from './progress-sheet'
import {
  BOX, C, DATE_FMT, FONT, PCT, SHEET, addDays, baht, col, f, isoToDate, kit, monthBands, monthLabel, ref, thDateShort, type Style,
} from './xlsx-kit'
import { W124, w124Offset, withW124 } from './w124'

export { isoToDate }

/**
 * อ่าน BOQ และเขียนไฟล์แผนงานด้วย exceljs — ทำในเบราว์เซอร์ทั้งหมด ไฟล์ไม่ออกจากเครื่อง
 * · exceljs โหลดตอนกดเท่านั้น (`import()`) หน้าอื่นไม่ต้องแบกไลบรารีราว 1 MB
 * · ผังไฟล์ตามแผนงานที่ห้างใช้ยื่นหน่วยงานอยู่เดิม: หัวโครงการ · แท่งราย W · แถว Plan/Actual
 *   · สรุปความคืบหน้าและค่าใช้จ่ายรายเดือน (S-Curve)
 */

export const loadExcel = async () => (await import('exceljs')).default

/** ค่าของช่องจาก exceljs → ค่าดิบ · ช่องลูกของช่องที่ผสาน = ว่าง (ไม่งั้นป้ายซ้ำไปทั้งแถว) */
function rawValue(cell: Cell): unknown {
  if (cell.isMerged && cell.master.address !== cell.address) return null
  const v = cell.value as CellValue | { result?: unknown } | null
  if (v == null) return null
  if (typeof v === 'number' || typeof v === 'string') return v
  if (v instanceof Date) return v
  if (typeof v === 'object') {
    if ('result' in v) {
      const r = (v as { result?: unknown }).result
      return typeof r === 'number' || typeof r === 'string' || r instanceof Date ? r : null
    }
    if ('richText' in v) return v.richText.map((t) => t.text).join('')
    if ('text' in v && typeof v.text === 'string') return v.text
  }
  return null
}

export function toGrid(ws: Worksheet): Grid {
  const rows = Math.min(ws.rowCount, 3000)
  const cols = Math.min(ws.columnCount, 40)
  const data: unknown[][] = []
  for (let r = 0; r < rows; r += 1) {
    const row = ws.getRow(r + 1)
    const line: unknown[] = []
    for (let c = 0; c < cols; c += 1) line.push(rawValue(row.getCell(c + 1)))
    data.push(line)
  }
  const v = (r: number, c: number) => data[r]?.[c] ?? null
  return { name: ws.name, rows, cols, v, w: (r, c) => norm(v(r, c)) }
}

/** BOQ .xlsx หรือ .xls (ดูจากไบต์แรกของไฟล์ ไม่ใช่นามสกุล) */
export async function readBoqFile(buf: ArrayBuffer) {
  if (isXls(buf)) return parseBoq(await readXlsGrids(buf))
  const ExcelJS = await loadExcel()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  return parseBoq(wb.worksheets.map(toGrid))
}

/** ไฟล์แผนงานที่สร้างจากระบบนี้ + กรอก % แล้วเสร็จแล้ว → รายงานแผนเทียบจริง */
export async function readPlanFile(buf: ArrayBuffer) {
  const ExcelJS = await loadExcel()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const plan = wb.getWorksheet(SHEET.plan)
  const summary = wb.getWorksheet(SHEET.summary)
  if (!plan || !summary) throw new Error('NOT_PLAN_FILE')
  // ชีตหมวด = ชีตที่หัวตารางมี "เปอร์เซ็นที่แล้วเสร็จ" และคอลัมน์ "งวดที่"
  const cats = wb.worksheets.filter((w) => w.getCell('F8').text.includes('เปอร์เซ็นที่แล้วเสร็จ') && /^งวดที่/.test(w.getCell('M8').text))
  return withW124(readProgress(toGrid(summary), cats.map(toGrid), toGrid(plan)))
}

// ---------------------------------------------------------------------------

export type PlanInput = {
  project: BoqProject & { contractor: string; contractNo: string; contractDate: string; contractorRep: string }
  factor: number | null
  vat: number | null
  categories: BoqCategory[]
  days: number
  /** `YYYY-MM-DD` (ค.ศ.) */
  start: string
  /** จำนวนงวดงานในแบบฟอร์มปริมาณงานที่แล้วเสร็จ */
  periods: number
  /** ใส่การประเมินตาม ว.124 (ตารางในชีตสรุป + เส้นแดง/เส้นเทาในกราฟ) — เจ้าของเลือกต่องาน */
  w124: boolean
}

export async function buildPlanXlsx(p: PlanInput): Promise<ArrayBuffer> {
  const ExcelJS = await loadExcel()
  const dist = distribute(p.categories, p.days)
  const start = isoToDate(p.start)
  const nW = dist.weeks
  const W0 = 7
  /** คอลัมน์ป้ายแกน % ของ S-Curve ที่วางทับตาราง (ต่อจากสัปดาห์สุดท้าย) */
  const cPct = W0 + nW
  const cBud = cPct + 1
  const cW = cBud + 1
  const cProg = cBud + 2
  const cResp = cBud + 3
  const wl = (k: number) => col(W0 + k)
  /** สัปดาห์ของแต่ละงวดที่ส่งแล้ว (ชีตคำนวณ แถว 5) — ว่าง = ยังไม่ส่ง/ไม่มีวันที่ */
  const periodWeeks = periodWeeksRange(p.periods)

  const wb: Workbook = new ExcelJS.Workbook()
  wb.creator = 'RUAYNAE'
  const ws = wb.addWorksheet(SHEET.plan, {
    views: [{ state: 'frozen', xSplit: 6, ySplit: 9, showGridLines: false }],
    pageSetup: { orientation: 'landscape', paperSize: 8 as PaperSize /* A3 */, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  const { put, merge } = kit(ws)
  const layout = progressLayout(p.categories, p.periods, start, p.days, p.w124)
  const planRows: number[] = []

  ;[6, 40, 8, 11, 11, 7.5].forEach((w, i) => { ws.getColumn(i + 1).width = w })
  for (let k = 0; k < nW; k += 1) ws.getColumn(W0 + k).width = 6.2
  ws.getColumn(cPct).width = 5.5
  ws.getColumn(cBud).width = 15
  ws.getColumn(cW).width = 9
  ws.getColumn(cProg).width = 9
  ws.getColumn(cResp).width = 16

  // ---- หัวโครงการ (แถว 1–5)
  const P = p.project
  const lab: Style = { font: { bold: true, color: { argb: C.muted } }, border: false }
  const val: Style = { border: false }
  const longDate = '[$-1070000]d mmmm yyyy'
  ;[['เจ้าของ :', lab], [P.owner, val], ['ที่อยู่หน้างาน :', lab], [P.loc1, val], [P.loc2, val]].forEach(([t, s], i) => {
    merge(i + 1, 1, i + 1, 2)
    put(`A${i + 1}`, t as string, s as Style)
  })
  merge(1, 3, 1, 4); put('C1', 'วันที่เริ่ม :', lab)
  merge(2, 3, 2, 4); put('C2', start, { fmt: longDate, fill: C.input, font: { bold: true }, align: { horizontal: 'center' } })
  merge(3, 3, 3, 4); put('C3', 'วันที่แล้วเสร็จ :', lab)
  merge(4, 3, 4, 4)
  put('C4', f('C2+D5-1', addDays(start, p.days - 1)), { fmt: longDate, font: { bold: true }, align: { horizontal: 'center' } })
  put('C5', 'ระยะเวลา (วัน)', { ...lab, align: { horizontal: 'right' } })
  put('D5', p.days, { fill: C.input, font: { bold: true }, align: { horizontal: 'center' } })
  put('E1', 'สัญลักษณ์ :', lab)
  put('E2', null, { fill: C.plan }); put('F2', 'แผนงาน', val)
  put('E3', null, { fill: C.act }); put('F3', 'ผลงานจริง', val)
  put('E4', null, { fill: C.input }); put('F4', 'ช่องกรอก', val)
  const blank = (s: string) => s.trim() || '………………'
  const title: [string, Partial<Font>][] = [
    ['แผนงานก่อสร้าง', { size: 16, bold: true }],
    [P.name, { size: 12, bold: true }],
    [`เจ้าของ : ${P.owner}`, {}],
    [`ผู้รับจ้าง : ${blank(P.contractor)}   สัญญาจ้างก่อสร้าง เลขที่ ${blank(P.contractNo)}   ลงวันที่ ${blank(P.contractDate)}`, {}],
    [`รวมค่าก่อสร้างทั้งโครงการ/งานก่อสร้าง : ${P.total ? baht(P.total) : '-'} บาท`, { bold: true }],
  ]
  title.forEach(([t, font], i) => {
    merge(i + 1, W0, i + 1, cResp)
    put(`${col(W0)}${i + 1}`, t, { font, border: false, align: { horizontal: 'center', wrapText: false } })
  })
  ws.getRow(1).height = 24

  // ---- หัวตาราง (แถว 7–9)
  const H: Style = { fill: C.head, font: { bold: true }, align: { horizontal: 'center' } }
  ;([['No.', 1], ['รายละเอียดงาน', 2], ['ระยะเวลา\n(วัน)', 3], ['เริ่ม\n(วันที่)', 4], ['เสร็จ\n(วันที่)', 5],
    ['แผนงาน\n/ผลงาน', 6], ['%', cPct], ['งบประมาณ\n(บาท)', cBud], ['น้ำหนัก\n(%)', cW], ['คืบหน้า\n(%)', cProg], ['ผู้รับผิดชอบ', cResp]] as const)
    .forEach(([t, c]) => { merge(7, c, 9, c); put(`${col(c)}7`, t, H) })
  const weekStart = (k: number) => addDays(start, 7 * k)
  const months = monthBands(start, nW)
  for (const m of months) {
    merge(7, W0 + m.from, 7, W0 + m.to)
    put(`${wl(m.from)}7`, monthLabel(m.d), H)
  }
  for (let k = 0; k < nW; k += 1) {
    put(`${wl(k)}8`, `W${k + 1}`, H)
    put(`${wl(k)}9`, f(k === 0 ? '$C$2' : `${wl(k - 1)}9+7`, weekStart(k)),
      { ...H, fmt: '[$-1070000]d/m', font: { size: 7, color: { argb: C.muted } } })
  }

  // ---- แถวงาน (เริ่มแถว 10) · หมวด 1 แถว · งานละ 2 แถว (Plan / Actual)
  const first = 10
  const T = first + p.categories.reduce((s, c) => {
    const n = c.tasks.filter((t) => t.on).length
    return s + (n ? 1 + n * 2 : 0)
  }, 0)
  let r = first
  let ti = 0
  let ci = 0
  for (const cat of p.categories) {
    const tasks = cat.tasks.filter((t) => t.on)
    if (!tasks.length) continue
    ci += 1
    const cr = r
    const catFill: Style = { fill: C.cat }
    put(`A${cr}`, ci, { ...catFill, font: { bold: true }, align: { horizontal: 'center' } })
    merge(cr, 2, cr, 6)
    put(`B${cr}`, cat.name, { ...catFill, font: { bold: true } })
    for (let k = 0; k < nW; k += 1) put(`${wl(k)}${cr}`, null, catFill)
    put(`${col(cPct)}${cr}`, null, catFill)
    const amt = tasks.reduce((s, t) => s + t.amount, 0)
    put(`${col(cBud)}${cr}`, f(`SUM(${col(cBud)}${cr + 1}:${col(cBud)}${cr + tasks.length * 2})`, amt), { ...catFill, fmt: '#,##0.00' })
    put(`${col(cW)}${cr}`, f(`SUM(${col(cW)}${cr + 1}:${col(cW)}${cr + tasks.length * 2})`, dist.total ? amt / dist.total : 0),
      { ...catFill, fmt: '0.00%', align: { horizontal: 'center' } })
    put(`${col(cProg)}${cr}`, null, catFill)
    put(`${col(cResp)}${cr}`, null, catFill)
    r += 1
    tasks.forEach((t, j) => {
      const a = r
      const b = r + 1
      planRows.push(a)
      const lt = layout.tasks[ti]
      ;[1, 2, 3, 4, 5, cPct, cBud, cW, cProg, cResp].forEach((c) => merge(a, c, b, c))
      put(`${col(cPct)}${a}`, null)
      put(`A${a}`, `${ci}.${j + 1}`, { align: { horizontal: 'center' } })
      put(`B${a}`, t.name, { align: { indent: 1 } })
      put(`C${a}`, t.dur, { fill: C.input, align: { horizontal: 'center' } })
      put(`D${a}`, f(`$C$2+${t.offset}`, addDays(start, t.offset)), { fill: C.input, fmt: DATE_FMT, align: { horizontal: 'center' } })
      put(`E${a}`, f(`D${a}+C${a}-1`, addDays(start, t.offset + t.dur - 1)), { fmt: DATE_FMT, align: { horizontal: 'center' } })
      put(`F${a}`, 'Plan', { align: { horizontal: 'center' }, font: { size: 8, color: { argb: 'FF2D5A8A' } } })
      put(`F${b}`, 'Actual', { align: { horizontal: 'center' }, font: { size: 8, color: { argb: 'FF9A6215' } } })
      const cell: Style = { fmt: PCT, font: { size: 7 }, align: { horizontal: 'center', wrapText: false } }
      for (let k = 0; k < nW; k += 1) {
        const x = wl(k)
        // 🔴 สูตรเดียวกับ distribute() ใน core.ts — วันที่ตกในสัปดาห์ ÷ ระยะเวลา × น้ำหนัก
        put(`${x}${a}`, f(`IF($C${a}>0,MAX(0,MIN($E${a},${x}$9+6)-MAX($D${a},${x}$9)+1)/$C${a}*$${col(cW)}${a},0)`, dist.plan[ti][k]), cell)
        // ผลงานจริงของสัปดาห์ = น้ำหนักงาน × (% สะสมสัปดาห์นี้ − สัปดาห์ก่อน) จากชีตปริมาณงานที่แล้วเสร็จ
        // ผลงานจริงขึ้นที่สัปดาห์ของวันส่งงวด = น้ำหนักงาน × (% งวดนี้ − % งวดก่อน)
        const m = `MATCH(${k + 1},${periodWeeks},0)`
        const taskRow = taskPeriodRange(lt.sheet, lt.top, p.periods)
        put(`${x}${b}`, f(`IFERROR($${col(cW)}${a}*(INDEX(${taskRow},${m})-IF(${m}=1,0,INDEX(${taskRow},${m}-1))),"")`, ''), cell)
      }
      put(`${col(cBud)}${a}`, t.amount, { fmt: '#,##0.00' })
      put(`${col(cW)}${a}`, f(`IFERROR(${col(cBud)}${a}/$${col(cBud)}$${T},0)`, dist.weights[ti]), { fmt: '0.00%', align: { horizontal: 'center' } })
      put(`${col(cProg)}${a}`, f(`IFERROR(SUM(${wl(0)}${b}:${wl(nW - 1)}${b})/${col(cW)}${a},0)`, 0), { fmt: '0%', align: { horizontal: 'center' } })
      put(`${col(cResp)}${a}`, null, { fill: C.input })
      r += 2
      ti += 1
    })
  }
  const lastRow = T - 1
  const rngF = `$F$${first}:$F$${lastRow}`
  merge(T, 1, T, 6)
  put(`A${T}`, 'รวม', { ...H })
  // ป้ายงวดใต้สัปดาห์ที่ส่งงวด (คู่กับเส้นประแนวตั้งของกราฟ)
  for (let k = 0; k < nW; k += 1) {
    put(`${wl(k)}${T}`, f(`IFERROR("งวด "&MATCH(${k + 1},${periodWeeks},0),"")`, ''),
      { fill: C.head, font: { size: 7, bold: true, color: { argb: 'FF1F7A4D' } }, align: { horizontal: 'center', wrapText: false } })
  }
  put(`${col(cPct)}${T}`, null, { fill: C.head })
  put(`${col(cBud)}${T}`, f(`SUMIF(${rngF},"Plan",${col(cBud)}${first}:${col(cBud)}${lastRow})`, dist.total), { ...H, fmt: '#,##0.00', align: {} })
  put(`${col(cW)}${T}`, f(`SUMIF(${rngF},"Plan",${col(cW)}${first}:${col(cW)}${lastRow})`, 1), { ...H, fmt: '0.00%' })
  put(`${col(cResp)}${T}`, null, { fill: C.head })

  // ---- สรุป S-Curve: แผนตามสัญญา · ผลงานจริง · เปรียบเทียบ
  let s = T + 2
  const cumRow: Record<'Plan' | 'Actual', number> = { Plan: 0, Actual: 0 }
  const group = (titleText: string, kind: 'Plan' | 'Actual', color: string) => {
    const w = s
    const c = s + 1
    const m = s + 2
    const mc = s + 3
    merge(w, 1, mc, 2)
    put(`A${w}`, titleText, { fill: C.sum, font: { bold: true, color: { argb: color } }, align: { horizontal: 'center' } })
    ;([[w, 'ความคืบหน้า / สัปดาห์ (%)'], [c, 'ความคืบหน้าสะสม / สัปดาห์ (%)'], [m, 'ค่าใช้จ่าย / เดือน (บาท)'], [mc, 'ค่าใช้จ่ายสะสม / เดือน (บาท)']] as const)
      .forEach(([rr, t]) => { merge(rr, 3, rr, 6); put(`C${rr}`, t, { fill: C.sum }) })
    const pv = kind === 'Plan' ? dist.perWeek : dist.perWeek.map(() => 0)
    let acc = 0
    const cv = pv.map((x) => (acc += x))
    const small: Style = { fmt: '0.00%', font: { size: 7 }, align: { horizontal: 'center', wrapText: false } }
    for (let k = 0; k < nW; k += 1) {
      const x = wl(k)
      const weekly = `SUMIF(${rngF},"${kind}",${x}$${first}:${x}$${lastRow})`
      put(`${x}${w}`, kind === 'Plan' ? f(weekly, pv[k]) : f(`IF(${k + 1}>${LW},"",${weekly})`, ''), small)
      const cum = k === 0 ? `${x}${w}` : `${wl(k - 1)}${c}+${x}${w}`
      // ผลงานจริงหยุดวาดหลังสัปดาห์ล่าสุดที่กรอก — ไม่งั้นเส้นจริงลากแบนไปจนจบสัญญา
      put(`${x}${c}`, kind === 'Plan' ? f(cum, cv[k]) : f(`IF(${k + 1}>${LW},"",${cum})`, ''), { ...small, font: { size: 7, bold: true } })
    }
    for (const mo of months) {
      const a = wl(mo.from)
      const b = wl(mo.to)
      merge(m, W0 + mo.from, m, W0 + mo.to)
      merge(mc, W0 + mo.from, mc, W0 + mo.to)
      const sum = pv.slice(mo.from, mo.to + 1).reduce((q, y) => q + y, 0)
      const money: Style = { fmt: '#,##0', font: { size: 8 }, align: { horizontal: 'center' } }
      const monthly = `SUM(${a}${w}:${b}${w})*$${col(cBud)}$${T}`
      put(`${a}${m}`, kind === 'Plan' ? f(monthly, sum * dist.total) : f(`IF(${mo.from + 1}>${LW},"",${monthly})`, ''), money)
      // ผลงานจริงของเดือนที่ยังไม่จบ = ยอดสะสม ณ สัปดาห์ล่าสุดที่กรอก
      const cumAt = kind === 'Plan'
        ? `${b}${c}*$${col(cBud)}$${T}`
        : `IF(${mo.from + 1}>${LW},"",INDEX(${a}${c}:${b}${c},MIN(${LW},${mo.to + 1})-${mo.from})*$${col(cBud)}$${T})`
      put(`${a}${mc}`, f(cumAt, kind === 'Plan' ? cv[mo.to] * dist.total : ''), { ...money, font: { size: 8, bold: true } })
    }
    cumRow[kind] = c
    s += 4
  }
  group('แผนงานตามสัญญา', 'Plan', 'FF2D5A8A')
  group('ผลงานจริง', 'Actual', 'FF9A6215')
  put(`${col(cProg)}${T}`, f(`IF(${LP}=0,0,N(INDEX(${summaryPeriodRange(layout, 'H')},${LP})))`, 0), { ...H, fmt: '0.00%' })
  merge(s, 1, s, 2)
  put(`A${s}`, 'เปรียบเทียบ', { fill: C.sum, font: { bold: true }, align: { horizontal: 'center' } })
  merge(s, 3, s, 6)
  put(`C${s}`, 'เร็ว (+) / ช้า (−) กว่าแผน สะสม (%)', { fill: C.sum })
  for (let k = 0; k < nW; k += 1) {
    const x = wl(k)
    put(`${x}${s}`, f(`IFERROR(INDEX(${summaryPeriodRange(layout, 'J')},MATCH(${k + 1},${periodWeeks},0)),"")`, ''),
      { fmt: '+0.00%;-0.00%;0.00%', font: { size: 7 }, align: { horizontal: 'center', wrapText: false } })
  }
  ws.addConditionalFormatting({
    ref: `${wl(0)}${s}:${wl(nW - 1)}${s}`,
    rules: [{ type: 'cellIs', operator: 'lessThan', formulae: ['0'], priority: 3, style: { font: { color: { argb: 'FFB42318' }, bold: true } } }],
  })
  s += 2
  const notes = [
    `* หมายเหตุ มูลค่างานเป็นค่างานต้นทุน ไม่รวม Factor F${p.factor ? ` ${p.factor}` : ''} และภาษีมูลค่าเพิ่ม ${p.vat ? Math.round(p.vat * 100) : 7}%`,
    '* แก้ "ระยะเวลา" และ "เริ่ม" (ช่องสีเหลือง) แล้วแท่งแผนงานกับ S-Curve คำนวณใหม่เอง',
    '* S-Curve บนตาราง: เส้นน้ำเงิน = แผนงานสะสม · เส้นส้ม = ผลงานจริงสะสม (จุดตรงวันส่งงวด) · เส้นประเขียว = วันส่งงวด · แกน % อยู่คอลัมน์ "%"',
    ...(p.w124 ? [`* เส้นประแดง = วันตรวจตามหนังสือกรมบัญชีกลาง ว.124 ข้อ 2.2 (เวลาเกิน 1/2 ผลงาน ≥ 25% · เกิน 3/4 ≥ 65% · ครบสัญญา ≥ 85%) · เส้นประเทา = แผนงาน ÷ 2 (ข้อ 2.2.2) · ผลประเมินอยู่ที่ชีต "${SHEET.summary}"`] : []),
    `* แถว Actual และแถวเปรียบเทียบดึงจากผลงานรายงวด — ส่งงวดเมื่อไหร่กรอกวันที่ที่ชีต "${SHEET.summary}" และ % แล้วเสร็จที่ชีตหมวด ผลจะขึ้นที่สัปดาห์ของวันส่งงวด`,
    '* เปลี่ยนวันที่เริ่มสัญญา ให้สร้างไฟล์ใหม่จากระบบ เพื่อให้หัวเดือนตรงกับวันที่',
  ]
  notes.forEach((t, i) => {
    merge(s + i, 1, s + i, cResp)
    put(`A${s + i}`, t, { border: false, font: { size: 8, color: { argb: C.muted } } })
  })
  s += notes.length + 1

  // แท่งแผนงาน/ผลงานด้วย conditional formatting — ย้ายวันในช่องเหลืองแล้วแท่งย้ายตาม
  ws.addConditionalFormatting({
    ref: `${wl(0)}${first}:${wl(nW - 1)}${lastRow}`,
    rules: [
      { type: 'expression', priority: 1, formulae: [`AND($F${first}="Plan",N(${wl(0)}${first})>0)`],
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: C.plan } }, font: { color: { argb: 'FFFFFFFF' } } } },
      { type: 'expression', priority: 2, formulae: [`AND($F${first}="Actual",N(${wl(0)}${first})>0)`],
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: C.act } } } },
    ],
  })
  ws.pageSetup.printArea = `A1:${col(cResp)}${s}`
  ws.pageSetup.printTitlesRow = '7:9'

  const progress = addProgressSheets(wb, {
    layout, dist, start, days: p.days, project: P, planRows,
    planTotal: ref(SHEET.plan, `$${col(cBud)}$${T}`),
  })

  // ---- ชีตที่มาของทุกยอดในไฟล์ BOQ
  const ws2 = wb.addWorksheet('ที่มาจาก BOQ', { views: [{ showGridLines: false }] })
  ws2.columns = [{ width: 7 }, { width: 52 }, { width: 17 }, { width: 10 }, { width: 34 }]
  const styleRow = (cells: CellValue[], fill?: string, bold = false) => {
    const row = ws2.addRow(cells)
    row.eachCell({ includeEmpty: true }, (c) => {
      c.font = { name: FONT, size: 9, bold }
      c.border = BOX
      if (fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
    })
  }
  styleRow(['No.', 'รายการ', 'ค่างานต้นทุน (บาท)', 'น้ำหนัก', 'แหล่งข้อมูลในไฟล์ BOQ'], C.head, true)
  const on = activeTasks(p.categories)
  let n = 0
  p.categories.forEach((cat) => {
    const tasks = cat.tasks.filter((t) => t.on)
    if (!tasks.length) return
    n += 1
    styleRow([n, cat.name, tasks.reduce((q, t) => q + t.amount, 0), null, cat.source], C.cat, true)
    tasks.forEach((t, j) => styleRow([`${n}.${j + 1}`, t.name, t.amount, dist.weights[on.indexOf(t)], t.source]))
  })
  styleRow(['', 'รวมค่างานต้นทุน', dist.total, 1, P.total ? `ค่าก่อสร้างทั้งโครงการ (ปร.6) ${baht(P.total)} บาท` : ''], undefined, true)
  ws2.getColumn(3).numFmt = '#,##0.00'
  ws2.getColumn(4).numFmt = '0.00%'

  // ข้อมูลกราฟในชีตคำนวณ (คอลัมน์ F = จุดเริ่มสัญญา 0,0):
  //  แถว 6/7 = แผน (x = สิ้นสัปดาห์ที่ w · y = แผนสะสม) · แถว 8/9 = ผลงานจริงของแต่ละงวด (x = วันส่งงวดเป็นสัปดาห์ทศนิยม)
  //  งวดที่ยังไม่ส่ง = #N/A — กราฟข้ามจุดนั้น (ช่องข้อความว่าง "" ถูกวาดเป็น 0)
  const calc = wb.addWorksheet(SHEET.calc, { state: 'hidden' })
  progress.calc.forEach((v, addr) => { calc.getCell(addr).value = v })
  const startCell = ref(SHEET.plan, '$C$2')
  for (const r of [6, 7, 8, 9]) calc.getCell(`F${r}`).value = 0
  for (let k = 0; k < nW; k += 1) {
    calc.getCell(`${wl(k)}6`).value = k + 1
    calc.getCell(`${wl(k)}7`).value = f(ref(SHEET.plan, `${wl(k)}${cumRow.Plan}`), dist.cum[k])
  }
  for (let k = 0; k < p.periods; k += 1) {
    const x = wl(k)
    const dd = summaryPeriodCell(layout, 'C', k)
    const sent = `${ref(SHEET.calc, `${x}$5`)}=""`
    calc.getCell(`${x}8`).value = f(`IF(${sent},NA(),(${dd}-${startCell}+1)/7)`, '')
    calc.getCell(`${x}9`).value = f(`IF(${sent},NA(),${summaryPeriodCell(layout, 'H', k)})`, '')
  }
  const lastP = wl(p.periods - 1)
  // เส้นประแนวตั้งที่วันส่งงวด: งวดละหนึ่งชุด x = (วันส่ง, วันส่ง) · y = (0, 1) — แถว 10–13
  for (let k = 0; k < p.periods; k += 1) {
    const x = wl(k)
    calc.getCell(`${x}10`).value = f(`${x}8`, '')
    calc.getCell(`${x}11`).value = f(`${x}8`, '')
    // งวดที่ยังไม่ส่ง: ทั้ง x และ y เป็น #N/A ไม่งั้นบางโปรแกรมวาดจุดที่ x = 0 เป็นเส้นเฉียงลอย ๆ
    calc.getCell(`${x}12`).value = f(`IF(ISNA(${x}8),NA(),0)`, '')
    calc.getCell(`${x}13`).value = f(`IF(ISNA(${x}8),NA(),1)`, '')
  }

  // เส้นแนบ ว.124: แถว 16 = แผนสะสม ÷ 2 (x ใช้แถว 6) · แถว 14/15 = เส้นแดงแนวตั้งที่วันตรวจ
  //   จุดของเส้น = 0 · เกณฑ์ของทุกข้อที่ตรวจวันเดียวกัน · 100% — หมุดและป้ายวางที่จุดเกณฑ์
  if (p.w124) {
    calc.getCell('F16').value = 0
    for (let k = 0; k < nW; k += 1) calc.getCell(`${wl(k)}16`).value = f(`${wl(k)}7/2`, dist.cum[k] / 2)
  }
  const checks = !p.w124 ? [] : [...new Set(W124.map((r) => r.frac))].map((frac) => ({ frac, rules: W124.filter((r) => r.frac === frac) }))
  let c0 = 1
  const redLines = checks.map(({ frac, rules }) => {
    const i = W124.indexOf(rules[0])
    const xCell = `(${ref(SHEET.summary, `$F$${layout.summary.w124Row0 + i}`)}-${startCell}+1)/7`
    const ys = [0, ...rules.map((r) => r.min), 1]
    const x0 = (w124Offset(p.days, frac) + 1) / 7
    ys.forEach((y, j) => {
      calc.getCell(`${col(c0 + j)}14`).value = f(xCell, x0)
      calc.getCell(`${col(c0 + j)}15`).value = y
    })
    const date = thDateShort(addDays(start, w124Offset(p.days, frac)))
    const spec = {
      name: `ว.124 ${rules[0].when}`,
      x: ref(SHEET.calc, `$${col(c0)}$14:$${col(c0 + ys.length - 1)}$14`),
      y: ref(SHEET.calc, `$${col(c0)}$15:$${col(c0 + ys.length - 1)}$15`),
      color: 'C0261C', dash: true, marker: false, width: 15875,
      points: rules.map((r, j) => ({
        idx: j + 1,
        lines: [`ว.124 ข้อ ${r.clause} · ผลงาน ≥ ${Math.round(r.min * 100)}%${r.halfPlan ? ' หรือครึ่งของแผน' : ''}`, `${r.when} · ${date}`],
      })),
    }
    c0 += ys.length
    return spec
  })

  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer
  const bar = progress.chart
  // 🔴 กราฟวางทับช่องสัปดาห์ของตาราง: กรอบวาดเริ่มขอบซ้าย W1 · แถวแรกของงาน → ขอบล่างแถวสุดท้าย
  //    และกินคอลัมน์ % ไว้เป็นที่ของป้ายแกน · พื้นที่วาด = nW/(nW+1) ของความกว้าง (คอลัมน์สัปดาห์กว้างเท่ากันหมด
  //    แต่คอลัมน์ % แคบกว่า จึงคิดจากความกว้างจริงของคอลัมน์)
  const weekW = 6.2
  const pctW = 5.5
  return addLineCharts(buf, [{
    kind: 'scatter',
    sheet: 1,
    title: 'S-Curve',
    xTitle: '',
    xMax: nW,
    overlay: { plotW: (weekW * nW) / (weekW * nW + pctW) },
    series: [
      { name: 'แผนงานสะสม', x: ref(SHEET.calc, `$F$6:$${wl(nW - 1)}$6`), y: ref(SHEET.calc, `$F$7:$${wl(nW - 1)}$7`), color: '2F5F94', width: 22225 },
      ...(p.w124 ? [{ name: 'แผนงาน ÷ 2 (ว.124 ข้อ 2.2.2)', x: ref(SHEET.calc, `$F$6:$${wl(nW - 1)}$6`), y: ref(SHEET.calc, `$F$16:$${wl(nW - 1)}$16`), color: '8A939C', dash: true, marker: false, width: 15875 }] : []),
      ...redLines,
      { name: 'ผลงานจริงสะสม', x: ref(SHEET.calc, `$F$8:$${lastP}$8`), y: ref(SHEET.calc, `$F$9:$${lastP}$9`), color: 'E08A1E', width: 22225 },
      ...Array.from({ length: p.periods }, (_, k) => ({
        name: `งวดที่ ${k + 1}`,
        x: ref(SHEET.calc, `$${wl(k)}$10:$${wl(k)}$11`),
        y: ref(SHEET.calc, `$${wl(k)}$12:$${wl(k)}$13`),
        color: '2E9E5B', dash: true, marker: false, width: 15875,
      })),
    ],
    from: { col: W0 - 1, row: first - 1 },
    to: { col: cPct, row: T - 1 },
  }, {
    kind: 'bar',
    sheet: bar.sheetIndex,
    title: 'เงินงบประมาณ เทียบ เบิกจ่ายแล้ว (บาท)',
    cats: bar.cats,
    series: bar.series,
    from: bar.from,
    to: bar.to,
  }])
}
