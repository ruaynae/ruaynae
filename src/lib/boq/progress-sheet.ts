import type { CellValue, PaperSize, Workbook, Worksheet } from 'exceljs'
import { bahtText } from '@/lib/baht-text'
import type { BoqCategory, Distribution } from './core'
import { C, SHEET, addDays, col, f, kit, ref, type Style } from './xlsx-kit'
import { W124, W124_LABEL, w124Offset } from './w124'

/**
 * ชุดชีต "ปริมาณงานที่แล้วเสร็จ" ตามแบบฟอร์มที่ห้างใช้ยื่นจริง (คำสั่งเจ้าของ 21 ต.ค. 2569)
 *
 *   รายละเอียด          ข้อมูลโครงการและสัญญา
 *   สรุปผลเบิกจ่าย       ระยะเวลา · มูลค่าตามสัญญาเทียบที่ได้จริงรายกลุ่ม ปร.5 · ผลงานรายงวดเทียบแผน · งบประมาณรายปี
 *   N <หมวด>            "แบบแสดงรายการ ปริมาณงาน และราคา ที่แล้วเสร็จ" — A–K ตามแบบเดิมทุกคอลัมน์
 *                       (มูลค่างาน · % ที่แล้วเสร็จ · มูลค่าที่แล้วเสร็จ · Factor F/VAT · รวมเป็นมูลค่า · คิดเป็น % ของค่าก่อสร้าง)
 *
 * 🔴 ช่องกรอกจริงคือคอลัมน์ "งวดที่ k" ทางขวาของแต่ละชีตหมวด (% สะสม ณ วันส่งงวด) — คอลัมน์ F "% ที่แล้วเสร็จ"
 *    ของแบบเดิมดึงงวดล่าสุดมาเอง · เก็บแยกรายงวดเพื่อให้ประวัติไม่ถูกเขียนทับ และกราฟจริงมีจุดของทุกงวด
 * · ช่องรายการที่เว้นว่าง = เท่างวดก่อน (ชีตซ่อน "คำนวณ" ยกค่าต่อให้)
 * · เทียบแผนด้วยน้ำหนักค่างานต้นทุน (ฐานเดียวกับชีตแผนงาน) · แผน ณ วันส่งงวดคิดรายวันจากวันเริ่ม/เสร็จของงาน
 */

/** ชีตคำนวณ: A1 = สัปดาห์ของงวดล่าสุด (0 = ยังไม่มี) · B1 = งวดล่าสุดที่กรอก · แถว 5 = สัปดาห์ของแต่ละงวด */
export const LW = ref(SHEET.calc, '$A$1')
export const LP = ref(SHEET.calc, '$B$1')
const CALC_WEEK_ROW = 5
const K0 = 7 // คอลัมน์งวดแรกในชีตคำนวณ (G)
const P0 = 13 // คอลัมน์งวดแรกในชีตหมวด (M) — A–K ตามแบบเดิม · L เว้นว่าง
const CI0 = 20 // แถวรายการแรกในชีตคำนวณ
const CONTRACT = ref(SHEET.detail, '$E$18')

export type CatLayout = {
  sheet: string
  cat: BoqCategory
  no: number
  /** แถวงานในตารางสรุปหัวชีต */
  top: number[]
  total: number
  detailCat: number
  heads: number[]
  items: number[][]
  subs: number[]
  last: number
}
export type ProgressLayout = {
  periods: number
  cats: CatLayout[]
  /** ต่องานที่ติ๊กอยู่ (เรียงเหมือนชีตแผนงาน): ชีตและแถวในตารางสรุปหัวชีต */
  tasks: { sheet: string; top: number }[]
  groups: { label: string; cats: CatLayout[] }[]
  summary: {
    groupRow0: number; groupTotal: number; periodHead: number; period0: number; status: number
    /** ตารางประเมินตาม ว.124: หัวตาราง · แถวแรกของเกณฑ์ (เรียงตาม `W124`) */
    w124Head: number; w124Row0: number
    fyHead: number; fy0: number; fyTotal: number
  }
  itemCount: number
  /** ปีงบประมาณ (พ.ศ.) ที่สัญญาคร่อม */
  fiscalYears: number[]
}

const sheetName = (no: number, name: string) =>
  `${no} ${name.replace(/^หมวด/, '')}`.replace(/[\\/*?:[\]]/g, ' ').slice(0, 31).trim()
/** ปีงบประมาณไทย: 1 ต.ค. – 30 ก.ย. · ปี พ.ศ. */
const fiscalYear = (d: Date) => d.getUTCFullYear() + 543 + (d.getUTCMonth() >= 9 ? 1 : 0)

/** ตำแหน่งของทุกแถว — คิดก่อนเขียนชีตแผนงาน เพราะแถว Actual ต้องอ้างถึง */
export function progressLayout(categories: BoqCategory[], periods: number, start: Date, days: number): ProgressLayout {
  const cats: CatLayout[] = []
  const tasks: ProgressLayout['tasks'] = []
  let itemCount = 0
  categories.forEach((cat) => {
    const on = cat.tasks.filter((t) => t.on)
    if (!on.length) return
    const no = cats.length + 1
    const sheet = sheetName(no, cat.name)
    const top = on.map((_, i) => 11 + i)
    const total = 11 + on.length + 1
    const detailCat = total + 2
    let r = detailCat
    const heads: number[] = []
    const items: number[][] = []
    const subs: number[] = []
    for (const t of on) {
      r += 1
      heads.push(r)
      items.push(t.items.map((_, i) => r + 1 + i))
      r += t.items.length + 1
      subs.push(r)
      itemCount += t.items.length
    }
    top.forEach((row) => tasks.push({ sheet, top: row }))
    cats.push({ sheet, cat, no, top, total, detailCat, heads, items, subs, last: r })
  })
  const groups: ProgressLayout['groups'] = []
  for (const c of cats) {
    const g = groups.find((x) => x.label === c.cat.group)
    if (g) g.cats.push(c)
    else groups.push({ label: c.cat.group, cats: [c] })
  }
  const fy0 = fiscalYear(start)
  const fy1 = fiscalYear(addDays(start, days - 1))
  const fiscalYears = Array.from({ length: fy1 - fy0 + 1 }, (_, i) => fy0 + i)
  const groupRow0 = 10
  const groupTotal = groupRow0 + groups.length
  const periodHead = groupTotal + 3
  const period0 = periodHead + 1
  const status = period0 + periods + 1
  const w124Head = status + 3
  const w124Row0 = w124Head + 1
  const fyHead = w124Row0 + W124.length + 3
  return {
    periods, cats, tasks, groups, itemCount, fiscalYears,
    summary: { groupRow0, groupTotal, periodHead, period0, status, w124Head, w124Row0, fyHead, fy0: fyHead + 2, fyTotal: fyHead + 2 + fiscalYears.length },
  }
}

export type ProgressArgs = {
  layout: ProgressLayout
  dist: Distribution
  start: Date
  days: number
  project: {
    name: string; owner: string; loc1: string; loc2: string; total: number | null
    contractor: string; contractNo: string; contractDate: string; contractorRep: string
  }
  /** ชีตแผนงาน: แถว Plan ของแต่ละงาน · ช่องค่างานต้นทุนรวม */
  planRows: number[]
  planTotal: string
}

/**
 * เขียนชีต รายละเอียด · สรุปผลเบิกจ่าย · ชีตหมวด — คืนค่าช่องของชีตคำนวณ (สร้างทีหลังให้อยู่ท้ายไฟล์)
 * และสเปกกราฟแท่งงบประมาณ
 */
export function addProgressSheets(wb: Workbook, a: ProgressArgs) {
  const { layout: L, dist } = a
  const nP = L.periods
  const calc = new Map<string, CellValue>()
  const K = (addr: string) => ref(SHEET.calc, addr)
  const kc = (k: number) => col(K0 + k)
  const pc = (k: number) => col(P0 + k)
  const flag = (k: number) => col(K0 + nP + 2 + k)
  const CT0 = CI0 + L.itemCount + 3 // แถวงานแรกในชีตคำนวณ (สัดส่วนแผน ณ วันส่งงวด)
  const S = L.summary
  const dateCell = (k: number) => ref(SHEET.summary, `$C$${S.period0 + k}`)
  const P = a.project
  const contractTotal = P.total ?? dist.total

  addDetailSheet(wb, a, nP)
  const i0 = CI0
  const i1 = CI0 + L.itemCount - 1
  const chart = addSummarySheet(wb, a, contractTotal, {
    plan: (k) => `IF(${dateCell(k)}="","",SUMPRODUCT(${K(`$E$${CT0}:$E$${CT0 + L.tasks.length - 1}`)},${K(`${kc(k)}${CT0}:${kc(k)}${CT0 + L.tasks.length - 1}`)})/${a.planTotal})`,
    actual: (k) => `SUMPRODUCT(${K(`$E$${i0}:$E$${i1}`)},${K(`${kc(k)}${i0}:${kc(k)}${i1}`)})/${a.planTotal}`,
    value: (k) => `SUMPRODUCT(${K(`$E$${i0}:$E$${i1}`)},${K(`$D$${i0}:$D$${i1}`)},${K(`${kc(k)}${i0}:${kc(k)}${i1}`)})`,
  })

  // ---- ชีตหมวด
  let item = 0
  let ti = 0
  const itemRange: { r0: number; r1: number }[] = [] // แถวรายการในชีตคำนวณ ต่องาน
  for (const c of L.cats) {
    const ws = wb.addWorksheet(c.sheet, {
      views: [{ state: 'frozen', xSplit: 2, ySplit: 9, showGridLines: false }],
      pageSetup: { orientation: 'portrait', paperSize: 9 as PaperSize /* A4 */, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '8:9' },
    })
    const { put, merge } = kit(ws)
    ;[7, 56, 8, 7, 14, 10, 14, 8, 14, 10, 12, 2].forEach((w, i) => { ws.getColumn(i + 1).width = w })
    for (let k = 0; k < nP; k += 1) ws.getColumn(P0 + k).width = 10
    const cPlan = P0 + nP + 1
    ;[9, 9, 12].forEach((w, i) => { ws.getColumn(cPlan + i).width = w })
    const plain: Style = { border: false }
    merge(1, 1, 1, 11)
    put('A1', 'แบบแสดงรายการ ปริมาณงาน และราคา ที่แล้วเสร็จ', { font: { size: 14, bold: true }, border: false, align: { horizontal: 'center' } })
    ;[['กลุ่มงาน/งาน', c.cat.name.replace(/^หมวด/, '')], ['ชื่อโครงการ/งานก่อสร้าง', P.name], ['สถานที่ก่อสร้าง', P.loc1], ['', P.loc2], ['หน่วยงานเจ้าของโครงการ/งานก่อสร้าง', P.owner]]
      .forEach(([l, v], i) => {
        merge(2 + i, 1, 2 + i, 2)
        put(`A${2 + i}`, l, { ...plain, font: { bold: true } })
        merge(2 + i, 3, 2 + i, 11)
        put(`C${2 + i}`, v, plain)
      })
    put('K7', 'หน่วย : บาท', { ...plain, align: { horizontal: 'right' } })
    merge(7, P0, 7, P0 + nP - 1)
    put(`${pc(0)}7`, 'กรอก % แล้วเสร็จสะสม ณ วันส่งงวด (พิมพ์ 40 = 40%) · ว่าง = เท่างวดก่อน', { ...plain, font: { size: 8, color: { argb: C.muted } } })
    const head: Style = { fill: C.head, font: { bold: true }, align: { horizontal: 'center' } }
    ;(['ลำดับที่', 'รายการ', 'จำนวน', 'หน่วย', 'มูลค่างาน', 'เปอร์เซ็นที่แล้วเสร็จ', 'มูลค่างานที่แล้วเสร็จ',
      c.cat.mult > 1.2 ? 'Factor F' : 'VAT', 'รวมเป็นมูลค่า', 'คิดเป็นเปอร์เซ็น', 'หมายเหตุ'] as const)
      .forEach((t, i) => { merge(8, i + 1, 9, i + 1); put(`${col(i + 1)}8`, t, head) })
    for (let k = 0; k < nP; k += 1) {
      put(`${pc(k)}8`, `งวดที่ ${k + 1}`, head)
      put(`${pc(k)}9`, f(`IF(${dateCell(k)}="","",${dateCell(k)})`, ''), { ...head, fmt: '[$-1070000]d mmm yy', font: { size: 8 } })
    }
    ;(['แผน (%)', 'ผลต่าง', 'สถานะ'] as const).forEach((t, i) => { merge(8, cPlan + i, 9, cPlan + i); put(`${col(cPlan + i)}8`, `${t}\nงวดล่าสุด`, head) })

    const catStyle: Style = { font: { bold: true } }
    put(`A10`, c.no, { ...catStyle, align: { horizontal: 'center' } })
    put(`B10`, c.cat.name, catStyle)
    const on = c.cat.tasks.filter((t) => t.on)
    // ---- รายละเอียดต่องาน (ล่าง) — เขียนก่อนเพื่อรู้แถวในชีตคำนวณ
    put(`A${c.detailCat}`, c.no, { ...catStyle, align: { horizontal: 'center' } })
    put(`B${c.detailCat}`, c.cat.name, catStyle)
    on.forEach((t, j) => {
      const hr = c.heads[j]
      const sr = c.subs[j]
      const rows = c.items[j]
      const r0 = CI0 + item
      put(`A${hr}`, `${c.no}.${j + 1}`, { ...catStyle, align: { horizontal: 'center' } })
      put(`B${hr}`, t.name, catStyle)
      t.items.forEach((it, n) => {
        const ir = rows[n]
        const cr = CI0 + item
        put(`A${ir}`, it.code || null, { font: { size: 8, color: { argb: C.muted } }, align: { horizontal: 'center' } })
        put(`B${ir}`, ` - ${it.name}`, {})
        put(`C${ir}`, it.qty, { fmt: '#,##0.##', align: { horizontal: 'right' } })
        put(`D${ir}`, it.unit, { align: { horizontal: 'center' } })
        put(`E${ir}`, it.amount, { fmt: '#,##0.00' })
        put(`F${ir}`, f(`IF(${LP}=0,0,INDEX(${K(`$${kc(0)}$${cr}:$${kc(nP - 1)}$${cr}`)},${LP}))`, 0), { fmt: '0.00%', align: { horizontal: 'center' } })
        put(`G${ir}`, f(`E${ir}*F${ir}`, 0), { fmt: '#,##0.00' })
        put(`H${ir}`, c.cat.mult, { fmt: '0.0000', align: { horizontal: 'center' } })
        put(`I${ir}`, f(`G${ir}*H${ir}`, 0), { fmt: '#,##0.00' })
        put(`J${ir}`, f(`IFERROR(I${ir}/${CONTRACT},0)`, 0), { fmt: '0.0000%', align: { horizontal: 'center' } })
        put(`K${ir}`, null)
        calc.set(`D${cr}`, c.cat.mult)
        calc.set(`E${cr}`, it.amount)
        for (let k = 0; k < nP; k += 1) {
          const x = pc(k)
          put(`${x}${ir}`, null, { fill: C.input, fmt: '0%;;;@', font: { size: 8 }, align: { horizontal: 'center' } })
          ws.getCell(`${x}${ir}`).dataValidation = {
            type: 'decimal', operator: 'between', allowBlank: true, formulae: [0, 1],
            showErrorMessage: true, errorTitle: 'ค่าไม่ถูกต้อง', error: 'กรอก % แล้วเสร็จสะสม 0–100',
          }
          const cell = ref(c.sheet, `${x}${ir}`)
          const prev = k === 0 ? '0' : `${kc(k - 1)}${cr}`
          calc.set(`${flag(k)}${cr}`, f(`IF(${cell}="",0,1)`, 0))
          calc.set(`${kc(k)}${cr}`, f(`IF(${cell}="",${prev},MIN(1,MAX(0,${cell})))`, 0))
        }
        item += 1
      })
      const r1 = CI0 + item - 1
      itemRange.push({ r0, r1 })
      const sub: Style = { fill: C.cat, font: { bold: true } }
      put(`A${sr}`, null, sub)
      put(`B${sr}`, `รวม${t.name}`, sub)
      put(`C${sr}`, null, sub)
      put(`D${sr}`, null, sub)
      put(`E${sr}`, f(`SUM(E${rows[0]}:E${rows[rows.length - 1]})`, t.amount), { ...sub, fmt: '#,##0.00' })
      put(`F${sr}`, f(`IFERROR(G${sr}/E${sr},0)`, 0), { ...sub, fmt: '0.00%', align: { horizontal: 'center' } })
      put(`G${sr}`, f(`SUM(G${rows[0]}:G${rows[rows.length - 1]})`, 0), { ...sub, fmt: '#,##0.00' })
      put(`H${sr}`, null, sub)
      put(`I${sr}`, f(`SUM(I${rows[0]}:I${rows[rows.length - 1]})`, 0), { ...sub, fmt: '#,##0.00' })
      put(`J${sr}`, f(`SUM(J${rows[0]}:J${rows[rows.length - 1]})`, 0), { ...sub, fmt: '0.0000%', align: { horizontal: 'center' } })
      put(`K${sr}`, null, sub)

      // ---- แถวงานในตารางสรุปหัวชีต
      const tr = c.top[j]
      const pr = a.planRows[ti]
      const ct = CT0 + ti
      put(`A${tr}`, `${c.no}.${j + 1}`, { align: { horizontal: 'center' } })
      put(`B${tr}`, t.name, {})
      put(`C${tr}`, 1, { align: { horizontal: 'center' } })
      put(`D${tr}`, 'งาน', { align: { horizontal: 'center' } })
      put(`E${tr}`, f(`E${sr}`, t.amount), { fmt: '#,##0.00' })
      put(`F${tr}`, f(`F${sr}`, 0), { fmt: '0.00%', align: { horizontal: 'center' } })
      put(`G${tr}`, f(`G${sr}`, 0), { fmt: '#,##0.00' })
      put(`H${tr}`, c.cat.mult, { fmt: '0.0000', align: { horizontal: 'center' } })
      put(`I${tr}`, f(`I${sr}`, 0), { fmt: '#,##0.00' })
      put(`J${tr}`, f(`J${sr}`, 0), { fmt: '0.0000%', align: { horizontal: 'center' } })
      put(`K${tr}`, null)
      calc.set(`E${ct}`, t.amount)
      for (let k = 0; k < nP; k += 1) {
        put(`${pc(k)}${tr}`, f(`IF(${k + 1}>${LP},"",SUMPRODUCT(${K(`$E$${r0}:$E$${r1}`)},${K(`${kc(k)}${r0}:${kc(k)}${r1}`)})/E${tr})`, ''),
          { fill: C.sum, fmt: '0%', font: { bold: true, size: 8 }, align: { horizontal: 'center' } })
        // แผนของงาน ณ วันส่งงวด: เสร็จแล้ว 1 · กำลังทำ = วันที่ผ่านไป ÷ ระยะเวลา · ยังไม่เริ่ม 0
        const dd = dateCell(k)
        const PL = (x: string) => ref(SHEET.plan, x)
        calc.set(`${kc(k)}${ct}`, f(`IF(${dd}="","",IF(${dd}>=${PL(`$E$${pr}`)},1,IF(${dd}>=${PL(`$D$${pr}`)},(${dd}-${PL(`$D$${pr}`)}+1)/${PL(`$C$${pr}`)},0)))`, ''))
      }
      put(`${col(cPlan)}${tr}`, f(`IF(${LP}=0,0,N(INDEX(${K(`$${kc(0)}$${ct}:$${kc(nP - 1)}$${ct}`)},${LP})))`, 0), { fmt: '0%', align: { horizontal: 'center' } })
      put(`${col(cPlan + 1)}${tr}`, f(`F${tr}-${col(cPlan)}${tr}`, 0), { fmt: '+0%;-0%;0%', align: { horizontal: 'center' } })
      put(`${col(cPlan + 2)}${tr}`, f(`IF(${LP}=0,"-",IF(${col(cPlan + 1)}${tr}>=0.01,"เร็วกว่าแผน",IF(${col(cPlan + 1)}${tr}<=-0.01,"ช้ากว่าแผน","ตามแผน")))`, '-'), { align: { horizontal: 'center' } })
      ti += 1
    })
    const tot: Style = { fill: C.head, font: { bold: true } }
    const t0 = c.top[0]
    const t1 = c.top[c.top.length - 1]
    put(`A${c.total}`, null, tot)
    put(`B${c.total}`, `รวม${c.cat.name}`, tot)
    put(`C${c.total}`, null, tot)
    put(`D${c.total}`, null, tot)
    put(`E${c.total}`, f(`SUM(E${t0}:E${t1})`, on.reduce((q, t) => q + t.amount, 0)), { ...tot, fmt: '#,##0.00' })
    put(`F${c.total}`, f(`IFERROR(G${c.total}/E${c.total},0)`, 0), { ...tot, fmt: '0.00%', align: { horizontal: 'center' } })
    put(`G${c.total}`, f(`SUM(G${t0}:G${t1})`, 0), { ...tot, fmt: '#,##0.00' })
    put(`H${c.total}`, null, tot)
    put(`I${c.total}`, f(`SUM(I${t0}:I${t1})`, 0), { ...tot, fmt: '#,##0.00' })
    put(`J${c.total}`, f(`SUM(J${t0}:J${t1})`, 0), { ...tot, fmt: '0.0000%', align: { horizontal: 'center' } })
    put(`K${c.total}`, null, tot)
    ws.pageSetup.printArea = `A1:K${c.last}`
    statusColors(ws, `${col(cPlan + 2)}${t0}:${col(cPlan + 2)}${t1}`, `${col(cPlan + 1)}${t0}:${col(cPlan + 1)}${t1}`)
  }

  // ---- ชีตคำนวณ: ธงงวดที่กรอก · งวดล่าสุด · สัปดาห์ของแต่ละงวด
  for (let k = 0; k < nP; k += 1) {
    calc.set(`${kc(k)}2`, f(`IF(SUM(${flag(k)}${i0}:${flag(k)}${i1})>0,${k + 1},0)`, 0))
    calc.set(`${kc(k)}${CALC_WEEK_ROW}`, f(`IF(OR(${k + 1}>B1,${dateCell(k)}=""),"",INT((${dateCell(k)}-${ref(SHEET.plan, '$C$2')})/7)+1)`, ''))
  }
  // 🔴 นับงวดที่กรอกจากธงของแถวรายการเท่านั้น — นับทั้งคอลัมน์ของชีตหมวดจะรวมแถวงานที่อ่าน B1 กลับมา = อ้างอิงวน
  calc.set('B1', f(`MAX(${kc(0)}2:${kc(nP - 1)}2)`, 0))
  calc.set('A1', f(`IF(B1=0,0,N(INDEX(${kc(0)}${CALC_WEEK_ROW}:${kc(nP - 1)}${CALC_WEEK_ROW},B1)))`, 0))

  w124CalcCells(a.layout).forEach((v, k) => calc.set(k, v))
  return { calc, chart }
}

function statusColors(ws: Worksheet, textRange: string, numRange: string, prio0 = 10) {
  let prio = prio0
  const red = { font: { color: { argb: C.bad }, bold: true } }
  const green = { font: { color: { argb: C.good }, bold: true } }
  ws.addConditionalFormatting({ ref: textRange, rules: [
    { type: 'containsText', operator: 'containsText', text: 'ช้า', priority: prio++, style: red },
    { type: 'containsText', operator: 'containsText', text: 'เร็ว', priority: prio++, style: green },
  ] })
  const top = numRange.split(':')[0]
  ws.addConditionalFormatting({ ref: numRange, rules: [
    { type: 'expression', formulae: [`AND(ISNUMBER(${top}),${top}<0)`], priority: prio++, style: red },
    { type: 'expression', formulae: [`AND(ISNUMBER(${top}),${top}>0)`], priority: prio++, style: green },
  ] })
}

/** ชีต "รายละเอียด" — ผังเดียวกับแบบของห้าง · ราคาค่าก่อสร้างอยู่ E18 (ชีตหมวดหาร % จากช่องนี้) */
function addDetailSheet(wb: Workbook, a: ProgressArgs, nP: number) {
  const ws = wb.addWorksheet(SHEET.detail, { views: [{ showGridLines: false }], pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } })
  const { put, merge } = kit(ws)
  ;[3, 6, 6, 14, 12, 6, 8, 10, 10, 6, 6, 6, 6, 6, 6].forEach((w, i) => { ws.getColumn(i + 1).width = w })
  const P = a.project
  const plain: Style = { border: false, align: { wrapText: false } }
  const total = P.total ?? 0
  merge(2, 6, 2, 11)
  put('F2', 'รายละเอียดโครงการ', { ...plain, font: { size: 16, bold: true }, align: { horizontal: 'center' } })
  merge(4, 1, 4, 15)
  put('A4', P.name, { ...plain, font: { size: 13, bold: true }, align: { horizontal: 'center' } })
  merge(6, 1, 6, 15)
  put('A6', `สถานที่ก่อสร้าง ${P.loc1}`, { ...plain, align: { horizontal: 'center' } })
  const line = (r: number, label: string, value: CellValue, s: Style = {}) => {
    merge(r, 2, r, 4)
    put(`B${r}`, label, { ...plain, font: { bold: true } })
    merge(r, 5, r, 15)
    put(`E${r}`, value, { ...plain, ...s })
  }
  line(8, 'ชื่อโครงการ', P.name)
  line(11, 'ผู้ว่าจ้าง', P.owner)
  line(12, 'สถานที่ก่อสร้าง', [P.loc1, P.loc2].filter(Boolean).join(' '))
  merge(13, 2, 13, 4); put('B13', 'สัญญาเลขที่', { ...plain, font: { bold: true } })
  merge(13, 5, 13, 7); put('E13', P.contractNo || '…………', plain)
  put('H13', 'ลงวันที่', { ...plain, font: { bold: true } })
  merge(13, 9, 13, 15); put('I13', P.contractDate || '…………………', plain)
  line(14, 'วันเริ่มต้นสัญญา', f(ref(SHEET.plan, '$C$2'), a.start), { fmt: '[$-1070000]d mmmm yyyy', align: { horizontal: 'left' } })
  line(15, 'วันสิ้นสุดสัญญา', f(ref(SHEET.plan, '$C$4'), addDays(a.start, a.days - 1)), { fmt: '[$-1070000]d mmmm yyyy', align: { horizontal: 'left' } })
  merge(16, 2, 16, 4); put('B16', 'ระยะเวลาก่อสร้าง', { ...plain, font: { bold: true } })
  put('E16', f(ref(SHEET.plan, '$D$5'), a.days), { ...plain, align: { horizontal: 'left' } })
  put('F16', 'วัน', plain)
  merge(16, 7, 16, 8); put('G16', 'งวดงานทั้งหมด', { ...plain, font: { bold: true } })
  put('I16', nP, { ...plain, align: { horizontal: 'left' } })
  put('J16', 'งวดงาน', plain)
  line(17, 'แก้ไขเพิ่มเติม', null)
  merge(18, 2, 18, 4); put('B18', 'ราคาค่าก่อสร้าง', { ...plain, font: { bold: true } })
  merge(18, 5, 18, 7); put('E18', total, { ...plain, fill: C.input, fmt: '#,##0.00', align: { horizontal: 'left' } })
  put('H18', 'บาท', plain)
  merge(18, 9, 18, 15); put('I18', f('" ("&BAHTTEXT(E18)&") "', ` (${bahtText(total)}) `), plain)
  line(19, 'ผู้รับจ้าง', P.contractor || '…………………………')
  line(20, 'ตัวแทนผู้รับจ้าง', P.contractorRep || '…………………………')
}

/** ชีต "สรุปผลเบิกจ่าย" — สรุปความก้าวหน้าของโครงการ */
function addSummarySheet(
  wb: Workbook,
  a: ProgressArgs,
  contractTotal: number,
  fx: { plan: (k: number) => string; actual: (k: number) => string; value: (k: number) => string },
) {
  const L = a.layout
  const S = L.summary
  const nP = L.periods
  const ws = wb.addWorksheet(SHEET.summary, { views: [{ showGridLines: false }], pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } })
  const { put, merge } = kit(ws)
  ;[6, 6, 8, 6, 11, 4, 8, 11, 4, 8, 11, 4, 8].forEach((w, i) => { ws.getColumn(i + 1).width = w })
  const head: Style = { fill: 'FFFFCCFF', font: { bold: true }, align: { horizontal: 'center' } }
  const cell: Style = { align: { horizontal: 'center' } }
  merge(2, 1, 2, 13)
  put('A2', 'สรุปความก้าวหน้าของโครงการ', { border: false, font: { size: 16, bold: true }, align: { horizontal: 'center' } })
  merge(3, 1, 3, 13)
  put('A3', a.project.name, { border: false, font: { bold: true }, align: { horizontal: 'center' } })

  // ---- ระยะเวลา (ณ วันที่ — ว่าง = วันส่งงวดล่าสุด หรือวันนี้)
  const lastDate = `IF(${LP}=0,"",INDEX($C$${S.period0}:$C$${S.period0 + nP - 1},${LP}))`
  merge(4, 1, 4, 4); put('A4', 'ข้อมูล ณ วันที่ (กรอก)', { border: false, font: { bold: true }, align: { horizontal: 'right' } })
  merge(4, 5, 4, 7); put('E4', null, { fill: C.input, fmt: '[$-1070000]d mmm yyyy', align: { horizontal: 'center' } })
  merge(4, 8, 4, 13); put('H4', 'ว่างไว้ = ใช้วันส่งงวดล่าสุด (ถ้ายังไม่ส่ง ใช้วันนี้)', { border: false, font: { size: 8, color: { argb: C.muted } } })
  const asOf = `IF($E$4<>"",$E$4,IF(N(${lastDate})>0,${lastDate},TODAY()))`
  const start = ref(SHEET.plan, '$C$2')
  const days = ref(SHEET.plan, '$D$5')
  merge(5, 1, 5, 4); put('A5', 'สรุประยะเวลาก่อสร้าง', head)
  merge(5, 5, 5, 7); put('E5', 'ใช้ไปแล้ว (วัน/%)', head)
  merge(5, 8, 5, 10); put('H5', 'คงเหลือ (วัน/%)', head)
  merge(5, 11, 5, 13); put('K5', 'กำหนดแล้วเสร็จ', head)
  merge(6, 1, 6, 4); put('A6', f(`"เวลาก่อสร้างรวม "&${days}&" วัน"`, `เวลาก่อสร้างรวม ${a.days} วัน`), cell)
  merge(6, 5, 6, 6); put('E6', f(`MAX(0,MIN(${days},${asOf}-${start}+1))`, 0), cell)
  put('G6', f(`E6/${days}`, 0), { ...cell, fmt: '0.00%' })
  merge(6, 8, 6, 9); put('H6', f(`${days}-E6`, a.days), cell)
  put('J6', f(`H6/${days}`, 1), { ...cell, fmt: '0.00%' })
  merge(6, 11, 6, 13); put('K6', f(ref(SHEET.plan, '$C$4'), addDays(a.start, a.days - 1)), { ...cell, fmt: '[$-1070000]d mmmm yyyy' })

  // ---- มูลค่าตามสัญญาเทียบที่ได้จริง รายกลุ่ม ปร.5
  merge(8, 1, 9, 4); put('A8', 'หมวดงาน', head)
  merge(8, 5, 8, 7); put('E8', 'มูลค่างานตามสัญญา', head)
  merge(8, 8, 8, 10); put('H8', 'มูลค่างานที่ได้จริง', head)
  merge(8, 11, 9, 13); put('K8', 'คงค้าง %', head)
  merge(9, 5, 9, 6); put('E9', 'บาท', head); put('G9', '%', head)
  merge(9, 8, 9, 9); put('H9', 'บาท', head); put('J9', '%', head)
  const T = S.groupTotal
  L.groups.forEach((g, i) => {
    const r = S.groupRow0 + i
    const label = g.label.replace(/^แบบสรุป/, '') || g.label
    const valueContract = g.cats.map((c) => `${ref(c.sheet, `$E$${c.total}`)}*${c.cat.mult}`).join('+')
    const valueDone = g.cats.map((c) => ref(c.sheet, `$I$${c.total}`)).join('+')
    const contract = g.cats.reduce((q, c) => q + c.cat.tasks.filter((t) => t.on).reduce((s, t) => s + t.amount, 0) * c.cat.mult, 0)
    merge(r, 1, r, 4); put(`A${r}`, label, {})
    merge(r, 5, r, 6); put(`E${r}`, f(valueContract, contract), { fmt: '#,##0.00' })
    put(`G${r}`, f(`IFERROR(E${r}/$E$${T},0)`, 0), { ...cell, fmt: '0.00%' })
    merge(r, 8, r, 9); put(`H${r}`, f(valueDone, 0), { fmt: '#,##0.00' })
    put(`J${r}`, f(`IFERROR(H${r}/$E$${T},0)`, 0), { ...cell, fmt: '0.00%' })
    merge(r, 11, r, 13); put(`K${r}`, f(`G${r}-J${r}`, 0), { ...cell, fmt: '0.00%' })
  })
  const g0 = S.groupRow0
  const g1 = T - 1
  const tot: Style = { font: { bold: true }, fill: C.sum }
  merge(T, 1, T, 4); put(`A${T}`, 'รวม', { ...tot, align: { horizontal: 'center' } })
  merge(T, 5, T, 6); put(`E${T}`, f(`SUM(E${g0}:E${g1})`, contractTotal), { ...tot, fmt: '#,##0.00' })
  put(`G${T}`, f(`SUM(G${g0}:G${g1})`, 1), { ...tot, ...cell, fmt: '0.00%' })
  merge(T, 8, T, 9); put(`H${T}`, f(`SUM(H${g0}:H${g1})`, 0), { ...tot, fmt: '#,##0.00' })
  put(`J${T}`, f(`SUM(J${g0}:J${g1})`, 0), { ...tot, ...cell, fmt: '0.00%' })
  merge(T, 11, T, 13); put(`K${T}`, f(`SUM(K${g0}:K${g1})`, 1), { ...tot, ...cell, fmt: '0.00%' })

  // ---- ผลงานรายงวดเทียบแผน
  const ph = S.periodHead
  merge(ph - 1, 1, ph - 1, 13)
  put(`A${ph - 1}`, 'ผลงานรายงวด เทียบแผนงาน (กรอกวันที่ส่งงวดในช่องสีเหลือง · % แล้วเสร็จกรอกที่ชีตหมวด คอลัมน์ "งวดที่")', { border: false, font: { bold: true } })
  ;([['งวด', 1, 2], ['วันที่ส่งงวด', 3, 4], ['สัปดาห์', 5, 5], ['แผนสะสม', 6, 7], ['จริงสะสม', 8, 9], ['ผลต่าง', 10, 10], ['สถานะ', 11, 11], ['มูลค่าที่ได้ (บาท)', 12, 13]] as const)
    .forEach(([t, c0, c1]) => { merge(ph, c0, ph, c1); put(`${col(c0)}${ph}`, t, head) })
  for (let k = 0; k < nP; k += 1) {
    const r = S.period0 + k
    const after = `${k + 1}>${LP}`
    merge(r, 1, r, 2); put(`A${r}`, `งวดที่ ${k + 1}`, { ...cell, font: { bold: true } })
    merge(r, 3, r, 4); put(`C${r}`, null, { fill: C.input, fmt: '[$-1070000]d mmm yy', align: { horizontal: 'center' } })
    ws.getCell(`C${r}`).dataValidation = { type: 'date', operator: 'greaterThan', allowBlank: true, formulae: [new Date(Date.UTC(2000, 0, 1))],
      showErrorMessage: true, errorTitle: 'วันที่ไม่ถูกต้อง', error: 'กรอกเป็นวันที่ เช่น 15/8/2026' }
    const wk = ref(SHEET.calc, `${col(K0 + k)}$${CALC_WEEK_ROW}`)
    put(`E${r}`, f(`IF(${wk}="","","W"&${wk})`, ''), cell)
    merge(r, 6, r, 7); put(`F${r}`, f(fx.plan(k), ''), { ...cell, fmt: '0.00%' })
    merge(r, 8, r, 9); put(`H${r}`, f(`IF(${after},"",${fx.actual(k)})`, ''), { ...cell, fmt: '0.00%', font: { bold: true } })
    put(`J${r}`, f(`IF(OR(F${r}="",H${r}=""),"",H${r}-F${r})`, ''), { ...cell, fmt: '+0.00%;-0.00%;0.00%' })
    put(`K${r}`, f(`IF(J${r}="","",IF(J${r}>=0.005,"เร็วกว่าแผน",IF(J${r}<=-0.005,"ช้ากว่าแผน","ตามแผน")))`, ''), cell)
    merge(r, 12, r, 13); put(`L${r}`, f(`IF(${after},"",${fx.value(k)})`, ''), { fmt: '#,##0.00' })
  }
  const p0 = S.period0
  const p1 = S.period0 + nP - 1
  const st = S.status
  const at = (c: string) => `INDEX($${c}$${p0}:$${c}$${p1},${LP})`
  merge(st, 1, st, 4); put(`A${st}`, 'สถานะ ณ งวดล่าสุด', { ...tot })
  merge(st, 5, st, 13)
  put(`E${st}`, f(`IF(${LP}=0,"ยังไม่กรอกผลงาน",IF(${at('C')}="","งวดที่ "&${LP}&" ยังไม่ใส่วันที่ส่งงวด","งวดที่ "&${LP}&" · แผน "&TEXT(${at('F')},"0.00%")&" · จริง "&TEXT(${at('H')},"0.00%")&" · "&${at('K')}))`, 'ยังไม่กรอกผลงาน'),
    { font: { bold: true, size: 11 } })
  statusColors(ws, `K${p0}:K${p1}`, `J${p0}:J${p1}`)
  ws.addConditionalFormatting({ ref: `E${st}`, rules: [
    { type: 'containsText', operator: 'containsText', text: 'ช้ากว่าแผน', priority: 30, style: { font: { color: { argb: C.bad }, bold: true } } },
    { type: 'containsText', operator: 'containsText', text: 'เร็วกว่าแผน', priority: 31, style: { font: { color: { argb: C.good }, bold: true } } },
  ] })

  addW124Table(ws, a, { asOf, start, days, p0, p1 })

  // ---- งบประมาณรายปี
  const fh = S.fyHead
  merge(fh, 1, fh + 1, 4); put(`A${fh}`, 'สรุปการใช้จ่ายตามปีงบประมาณ', head)
  merge(fh, 5, fh, 7); put(`E${fh}`, 'เงินงบประมาณ', head)
  merge(fh, 8, fh, 10); put(`H${fh}`, 'เบิกจ่ายแล้ว', head)
  merge(fh, 11, fh, 13); put(`K${fh}`, 'คงเหลือ', head)
  merge(fh + 1, 5, fh + 1, 6); put(`E${fh + 1}`, 'บาท', head); put(`G${fh + 1}`, '%', head)
  merge(fh + 1, 8, fh + 1, 9); put(`H${fh + 1}`, 'บาท', head); put(`J${fh + 1}`, '%', head)
  put(`K${fh + 1}`, 'บาท', head); merge(fh + 1, 11, fh + 1, 12); put(`M${fh + 1}`, '%', head)
  const FT = S.fyTotal
  L.fiscalYears.forEach((y, i) => {
    const r = S.fy0 + i
    merge(r, 1, r, 4); put(`A${r}`, `พ.ศ. ${y}`, cell)
    merge(r, 5, r, 6); put(`E${r}`, i === 0 ? contractTotal : 0, { fill: C.input, fmt: '#,##0.00' })
    put(`G${r}`, f(`IFERROR(E${r}/$E$${FT},0)`, i === 0 ? 1 : 0), { ...cell, fmt: '0.00%' })
    merge(r, 8, r, 9); put(`H${r}`, 0, { fill: C.input, fmt: '#,##0.00' })
    put(`J${r}`, f(`IFERROR(H${r}/$E$${FT},0)`, 0), { ...cell, fmt: '0.00%' })
    merge(r, 11, r, 12); put(`K${r}`, f(`E${r}-H${r}`, i === 0 ? contractTotal : 0), { fmt: '#,##0.00' })
    put(`M${r}`, f(`G${r}-J${r}`, i === 0 ? 1 : 0), { ...cell, fmt: '0.00%' })
  })
  const f0 = S.fy0
  const f1 = FT - 1
  merge(FT, 1, FT, 4); put(`A${FT}`, 'รวม', { ...tot, align: { horizontal: 'center' } })
  merge(FT, 5, FT, 6); put(`E${FT}`, f(`SUM(E${f0}:E${f1})`, contractTotal), { ...tot, fmt: '#,##0.00' })
  put(`G${FT}`, f(`SUM(G${f0}:G${f1})`, 1), { ...tot, ...cell, fmt: '0.00%' })
  merge(FT, 8, FT, 9); put(`H${FT}`, f(`SUM(H${f0}:H${f1})`, 0), { ...tot, fmt: '#,##0.00' })
  put(`J${FT}`, f(`SUM(J${f0}:J${f1})`, 0), { ...tot, ...cell, fmt: '0.00%' })
  merge(FT, 11, FT, 12); put(`K${FT}`, f(`SUM(K${f0}:K${f1})`, contractTotal), { ...tot, fmt: '#,##0.00' })
  put(`M${FT}`, f(`SUM(M${f0}:M${f1})`, 1), { ...tot, ...cell, fmt: '0.00%' })
  merge(FT + 2, 1, FT + 2, 13)
  put(`A${FT + 2}`, 'กราฟแท่งเปรียบเทียบการเบิกจ่ายเงินงบประมาณ', { border: false, font: { bold: true, size: 12 }, align: { horizontal: 'center' } })
  return {
    /** เลขไฟล์ sheetN.xml ที่ exceljs เขียน = ลำดับที่สร้าง */
    sheetIndex: ws.id,
    cats: ref(SHEET.summary, `$A$${f0}:$A$${f1}`),
    series: [
      { name: 'เงินงบประมาณ', y: ref(SHEET.summary, `$E$${f0}:$E$${f1}`), color: '2F5F94' },
      { name: 'เบิกจ่ายแล้ว', y: ref(SHEET.summary, `$H$${f0}:$H$${f1}`), color: 'E08A1E' },
    ],
    from: { col: 0, row: FT + 2 },
    to: { col: 13, row: FT + 20 },
  }
}

/**
 * ตารางประเมินตาม ว.124 ข้อ 2.2 — วันที่ตรวจคิดจากวันเริ่ม/ระยะเวลาในชีตแผนงาน (แก้แล้วตามเอง)
 * ผลงาน ณ วันตรวจ = งวดล่าสุดที่วันส่งงวดไม่เกินวันตรวจ (ลำดับงวดอยู่ในชีตคำนวณ แถว 18)
 */
function addW124Table(ws: Worksheet, a: ProgressArgs, x: { asOf: string; start: string; days: string; p0: number; p1: number }) {
  const { put, merge } = kit(ws)
  const S = a.layout.summary
  const head: Style = { fill: 'FFFFCCFF', font: { bold: true }, align: { horizontal: 'center' } }
  const cell: Style = { align: { horizontal: 'center' } }
  const h = S.w124Head
  merge(h - 1, 1, h - 1, 13)
  put(`A${h - 1}`, 'ประเมินผลการทำงานตามหนังสือกรมบัญชีกลาง ที่ กค (กวจ) 0405.2/ว 124 ลงวันที่ 1 มี.ค. 2566 ข้อ 2.2', { border: false, font: { bold: true } })
  ;([['ข้อ', 1, 2], ['เงื่อนไข', 3, 5], ['วันที่ตรวจ', 6, 7], ['เกณฑ์', 8, 8], ['ผลงาน ณ วันตรวจ', 9, 10], ['ผลประเมิน', 11, 13]] as const)
    .forEach(([t, c0, c1]) => { merge(h, c0, h, c1); put(`${col(c0)}${h}`, t, head) })
  W124.forEach((rule, i) => {
    const r = S.w124Row0 + i
    const date = rule.frac >= 1 ? ref(SHEET.plan, '$C$4') : `${x.start}+INT(${x.days}*${rule.frac})`
    const idx = ref(SHEET.calc, `$${col(1 + i)}$18`)
    ws.getRow(r).height = 30
    merge(r, 1, r, 2); put(`A${r}`, `ว.124 ข้อ ${rule.clause}`, { ...cell, font: { bold: true } })
    merge(r, 3, r, 5); put(`C${r}`, `${rule.when} · ${rule.rule}`, { font: { size: 8 } })
    merge(r, 6, r, 7); put(`F${r}`, f(date, addDays(a.start, w124Offset(a.days, rule.frac))), { ...cell, fmt: '[$-1070000]d mmm yy' })
    put(`H${r}`, rule.min, { ...cell, fmt: '0%' })
    merge(r, 9, r, 10); put(`I${r}`, f(`IF(${idx}=0,0,N(INDEX($H$${x.p0}:$H$${x.p1},${idx})))`, 0), { ...cell, fmt: '0.00%', font: { bold: true } })
    const ok = rule.halfPlan
      ? `OR(I${r}>=H${r},AND(${idx}>0,I${r}>=N(INDEX($F$${x.p0}:$F$${x.p1},MAX(1,${idx})))/2))`
      : `I${r}>=H${r}`
    merge(r, 11, r, 13)
    put(`K${r}`, f(`IF(${ok},"${W124_LABEL.pass}",IF(${x.asOf}>=F${r},"${W124_LABEL.fail}","${W124_LABEL.pending}"))`, W124_LABEL.pending), { ...cell, font: { bold: true } })
  })
  const r0 = S.w124Row0
  const r1 = r0 + W124.length - 1
  ws.addConditionalFormatting({ ref: `K${r0}:K${r1}`, rules: [
    { type: 'containsText', operator: 'containsText', text: W124_LABEL.fail, priority: 40, style: { font: { color: { argb: C.bad }, bold: true }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFDE8E7' } } } },
    { type: 'containsText', operator: 'containsText', text: W124_LABEL.pass, priority: 41, style: { font: { color: { argb: C.good }, bold: true } } },
  ] })
  merge(r1 + 1, 1, r1 + 1, 13)
  put(`A${r1 + 1}`,
    '* ต่ำกว่าเกณฑ์ และความล่าช้าเป็นความผิดของผู้รับจ้าง = หน่วยงานใช้ดุลพินิจบอกเลิกสัญญาได้ (ม.103 วรรคหนึ่ง (2)) · ข้อ 2.2.2 เทียบผลงานสะสมกับครึ่งหนึ่งของแผน ณ วันส่งงวด แทนผลงานรายเดือน · ไม่ใช้กับงานก่อสร้างบำรุงทาง',
    { border: false, font: { size: 8, color: { argb: C.muted } } })
  ws.getRow(r1 + 1).height = 24
}

/** ลำดับงวดล่าสุดที่วันส่งงวดไม่เกินวันตรวจของเกณฑ์ข้อ i (0 = ไม่มี) — ชีตคำนวณแถว 18 */
export function w124CalcCells(layout: ProgressLayout): Map<string, CellValue> {
  const out = new Map<string, CellValue>()
  const S = layout.summary
  const p0 = S.period0
  const p1 = p0 + layout.periods - 1
  const C_ = ref(SHEET.summary, `$C$${p0}:$C$${p1}`)
  W124.forEach((_, i) => {
    const d = ref(SHEET.summary, `$F$${S.w124Row0 + i}`)
    out.set(`${col(1 + i)}18`, f(`SUMPRODUCT(MAX(ISNUMBER(${C_})*(${C_}<=${d})*(ROW(${C_})-${p0 - 1}<=${LP})*(ROW(${C_})-${p0 - 1})))`, 0))
  })
  return out
}

/** ช่วงคอลัมน์งวดของแถวงานในชีตหมวด เช่น `'1 งานสถาปัตยกรรม'!$M$11:$Q$11` */
export const taskPeriodRange = (sheet: string, row: number, periods: number) =>
  ref(sheet, `$${col(P0)}$${row}:$${col(P0 + periods - 1)}$${row}`)
/** สัปดาห์ของแต่ละงวด (ชีตคำนวณ แถว 5) */
export const periodWeeksRange = (periods: number) => ref(SHEET.calc, `$${col(K0)}$${CALC_WEEK_ROW}:$${col(K0 + periods - 1)}$${CALC_WEEK_ROW}`)
/** ช่องของงวด k ในตารางผลงานรายงวดของชีตสรุป */
export const summaryPeriodCell = (layout: ProgressLayout, column: 'C' | 'H' | 'J', k: number) =>
  ref(SHEET.summary, `$${column}$${layout.summary.period0 + k}`)
export const summaryPeriodRange = (layout: ProgressLayout, column: 'C' | 'H' | 'J') =>
  ref(SHEET.summary, `$${column}$${layout.summary.period0}:$${column}$${layout.summary.period0 + layout.periods - 1}`)
