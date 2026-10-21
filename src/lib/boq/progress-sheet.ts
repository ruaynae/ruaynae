import type { Workbook } from 'exceljs'
import type { BoqCategory, Distribution } from './core'
import { C, SHEET, col, f, kit, ref, type Style } from './xlsx-kit'

/**
 * ชีต "ปริมาณงานที่แล้วเสร็จ" — แบบฟอร์มกรอกผลงานตอน **ส่งงวดงาน** (ไม่ใช่รายสัปดาห์ · คำสั่งเจ้าของ 21 ต.ค. 2569)
 *
 * ส่งงวดเมื่อไหร่ กรอกครั้งเดียวในคอลัมน์ "งวดที่ k": วันที่ส่งงวด + % แล้วเสร็จ **สะสม** ของแต่ละรายการ
 * · ช่องรายการที่เว้นว่าง = เท่างวดก่อน — ชีต "คำนวณ" (ซ่อน) ยกค่าต่อให้
 * · แผน ณ วันส่งงวด คิดรายวันจากวันเริ่ม/เสร็จของแต่ละงานในชีตแผนงาน (ไม่ปัดเป็นสัปดาห์)
 * · ผูกกลับเข้าชีตแผนงาน: แถว Actual ขึ้นที่สัปดาห์ของวันส่งงวด · กราฟเส้นจริงลากผ่านจุดของแต่ละงวด
 */

/** แถวหัวตารางรายการ — ข้อมูลเริ่มแถวถัดไป */
export const PROGRESS_FIRST = 19
/** ชีตคำนวณ: A1 = สัปดาห์ของงวดล่าสุด (0 = ยังไม่มี) · B1 = งวดล่าสุดที่กรอก · แถว 5 = สัปดาห์ของแต่ละงวด */
export const LW = ref(SHEET.calc, '$A$1')
export const LP = ref(SHEET.calc, '$B$1')
export const ROW = { date: 13, week: 14, plan: 15, actual: 16, diff: 17, status: 18, calcWeek: 5 } as const
const W0 = 7

export type ProgressLayout = { catRows: number[]; taskRows: number[]; itemRows: number[][]; last: number }

/** แถวของงานและรายการย่อยในแบบฟอร์ม — คิดก่อนเขียนชีตแผนงาน เพราะแถว Actual ต้องอ้างถึง */
export function progressLayout(categories: BoqCategory[]): ProgressLayout {
  let r = PROGRESS_FIRST // แถวสุดท้ายที่ใช้ไปแล้ว
  const catRows: number[] = []
  const taskRows: number[] = []
  const itemRows: number[][] = []
  for (const c of categories) {
    const tasks = c.tasks.filter((t) => t.on)
    if (!tasks.length) continue
    r += 1
    catRows.push(r)
    for (const t of tasks) {
      r += 1
      const tr = r
      taskRows.push(tr)
      itemRows.push(t.items.map((_, i) => tr + 1 + i))
      r += t.items.length
    }
  }
  return { catRows, taskRows, itemRows, last: r }
}

/** ช่วงคอลัมน์งวดของแถวหนึ่งในแบบฟอร์ม เช่น `$G$16:$K$16` */
export const periodRange = (row: number, periods: number) => `$${col(W0)}$${row}:$${col(W0 + periods - 1)}$${row}`

export function addProgressSheet(
  wb: Workbook,
  a: {
    categories: BoqCategory[]
    dist: Distribution
    periods: number
    projectName: string
    layout: ProgressLayout
    /** ชีตแผนงาน: แถว Plan ของแต่ละงาน · ช่องยอดรวม */
    planRows: number[]
    planTotal: string
  },
) {
  const { dist, layout, periods: nP } = a
  const pl = (k: number) => col(W0 + k)
  const lastP = pl(nP - 1)
  const cLast = W0 + nP
  const cPlan = cLast + 1
  const cDiff = cLast + 2
  const cStat = cLast + 3
  const cQty = cLast + 4
  const cVal = cLast + 5
  const P = (addr: string) => ref(SHEET.progress, addr)
  const K = (addr: string) => ref(SHEET.calc, addr)
  const PL = (addr: string) => ref(SHEET.plan, addr)
  const first = PROGRESS_FIRST + 1
  const last = layout.last
  // ชีตคำนวณ: คอลัมน์งวด = % สะสมที่ยกค่าต่อแล้ว · ชุดที่ 2 = ธงว่าช่องถูกกรอก · ชุดที่ 3 = สัดส่วนแผนของงาน ณ วันส่งงวด
  const flag = (k: number) => col(W0 + nP + 2 + k)
  const pfrac = (k: number) => col(W0 + 2 * nP + 4 + k)

  const ws = wb.addWorksheet(SHEET.progress, {
    views: [{ state: 'frozen', xSplit: 2, ySplit: PROGRESS_FIRST, showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  const calc = wb.addWorksheet(SHEET.calc, { state: 'hidden' })
  const { put, merge } = kit(ws)
  ;[6, 50, 9, 7, 14, 8].forEach((w, i) => { ws.getColumn(i + 1).width = w })
  for (let k = 0; k < nP; k += 1) ws.getColumn(W0 + k).width = 12
  ;[9, 9, 9, 12, 11, 14].forEach((w, i) => { ws.getColumn(cLast + i).width = w })

  // ---- หัวแบบฟอร์ม + กล่องสถานะ (แถว 5–10)
  const lab: Style = { font: { bold: true, color: { argb: C.muted } }, border: false }
  merge(1, 1, 1, cVal)
  put('A1', 'ปริมาณงานที่แล้วเสร็จ (ผลงานจริงเทียบแผน · รายงวดงาน)', { font: { size: 15, bold: true }, border: false, align: { wrapText: false } })
  merge(2, 1, 2, cVal)
  put('A2', a.projectName, { font: { size: 11, bold: true }, border: false, align: { wrapText: false } })
  merge(3, 1, 3, cVal)
  put('A3', 'ส่งงวดเมื่อไหร่ กรอกในคอลัมน์ของงวดนั้น: วันที่ส่งงวด (แถว 13) + % แล้วเสร็จ "สะสม" ของแต่ละรายการ (พิมพ์ 40 = 40%) · ช่องที่เว้นว่างถือว่าเท่างวดก่อน',
    { border: false, font: { size: 8, color: { argb: C.muted } }, align: { wrapText: false } })
  const at = (row: number) => `INDEX(${periodRange(row, nP)},${LP})`
  const box: [string, string, number | string, string?][] = [
    ['งวดล่าสุดที่กรอก', `IF(${LP}=0,"ยังไม่กรอก","งวดที่ "&${LP})`, 'ยังไม่กรอก'],
    ['วันที่ส่งงวด', `IF(${LP}=0,"",IF(${at(ROW.date)}="","ยังไม่ใส่วันที่",${at(ROW.date)}))`, '', '[$-1070000]d mmmm yyyy'],
    ['แผนงานสะสม ณ วันส่งงวด', `IF(${LP}=0,0,N(${at(ROW.plan)}))`, 0, '0.00%'],
    ['ผลงานจริงสะสม', `IF(${LP}=0,0,N(${at(ROW.actual)}))`, 0, '0.00%'],
    ['เร็ว (+) / ช้า (−) กว่าแผน', 'D8-D7', 0, '+0.00%;-0.00%;0.00%'],
    ['สถานะโครงการ', `IF(${LP}=0,"-",IF(${at(ROW.date)}="","ใส่วันที่ส่งงวดก่อน",IF(D9>=0.005,"เร็วกว่าแผน",IF(D9<=-0.005,"ช้ากว่าแผน","ตามแผน"))))`, '-'],
  ]
  box.forEach(([t, formula, result, fmt], i) => {
    const r = 5 + i
    merge(r, 1, r, 3)
    put(`A${r}`, t, { ...lab, border: true, fill: C.sum })
    merge(r, 4, r, 6)
    put(`D${r}`, f(formula, result), { font: { bold: true, size: i === 5 ? 11 : 9 }, fmt, align: { horizontal: 'center' } })
  })

  // ---- สรุปรายงวด (แถว 12–18)
  const head: Style = { fill: C.head, font: { bold: true }, align: { horizontal: 'center' } }
  merge(12, 1, 12, 6)
  put('A12', 'งวดงาน', head)
  const sumRows: [number, string][] = [
    [ROW.date, 'วันที่ส่งงวด (กรอก)'], [ROW.week, 'ตรงกับสัปดาห์ของแผน'], [ROW.plan, 'แผนงานสะสม ณ วันส่งงวด (%)'],
    [ROW.actual, 'ผลงานจริงสะสม (%)'], [ROW.diff, 'เร็ว (+) / ช้า (−) (%)'], [ROW.status, 'สถานะ'],
  ]
  sumRows.forEach(([r, t]) => { merge(r, 1, r, 6); put(`A${r}`, t, { fill: C.sum, font: { bold: true } }) })
  const start = PL('$C$2')
  const small: Style = { font: { size: 8 }, align: { horizontal: 'center', wrapText: false } }
  for (let k = 0; k < nP; k += 1) {
    const x = pl(k)
    const after = `${k + 1}>${LP}`
    put(`${x}12`, `งวดที่ ${k + 1}`, head)
    const d = ws.getCell(`${x}${ROW.date}`)
    put(`${x}${ROW.date}`, null, { fill: C.input, fmt: '[$-1070000]d mmm yy', align: { horizontal: 'center' } })
    d.dataValidation = { type: 'date', operator: 'greaterThan', allowBlank: true, formulae: [new Date(Date.UTC(2000, 0, 1))],
      showErrorMessage: true, errorTitle: 'วันที่ไม่ถูกต้อง', error: 'กรอกเป็นวันที่ เช่น 15/8/2026' }
    calc.getCell(`${x}${ROW.calcWeek}`).value =
      f(`IF(OR(${after},${P(`${x}${ROW.date}`)}=""),"",INT((${P(`${x}${ROW.date}`)}-${start})/7)+1)`, '')
    put(`${x}${ROW.week}`, f(`IF(${K(`${x}${ROW.calcWeek}`)}="","","W"&${K(`${x}${ROW.calcWeek}`)})`, ''), small)
    put(`${x}${ROW.plan}`, f(`IF(${x}${ROW.date}="","",SUMPRODUCT($F$${first}:$F$${last},${K(`${pfrac(k)}${first}:${pfrac(k)}${last}`)}))`, ''), { ...small, fmt: '0.00%' })
    put(`${x}${ROW.actual}`, f(`IF(${after},"",SUMPRODUCT($E$${first}:$E$${last},${K(`${x}${first}:${x}${last}`)})/${a.planTotal})`, ''), { ...small, fmt: '0.00%', font: { size: 8, bold: true } })
    put(`${x}${ROW.diff}`, f(`IF(OR(${x}${ROW.plan}="",${x}${ROW.actual}=""),"",${x}${ROW.actual}-${x}${ROW.plan})`, ''), { ...small, fmt: '+0.00%;-0.00%;0.00%' })
    put(`${x}${ROW.status}`, f(`IF(${x}${ROW.diff}="","",IF(${x}${ROW.diff}>=0.005,"เร็วกว่าแผน",IF(${x}${ROW.diff}<=-0.005,"ช้ากว่าแผน","ตามแผน")))`, ''), small)
    calc.getCell(`${x}2`).value = f(`IF(SUM(${flag(k)}${first}:${flag(k)}${last})>0,${k + 1},0)`, 0)
  }
  // 🔴 นับงวดที่กรอกจากธงของแถวรายการเท่านั้น — นับทั้งคอลัมน์ของแบบฟอร์มจะรวมแถวงานที่อ่าน B1 กลับมา = อ้างอิงวน
  calc.getCell('B1').value = f(`MAX(${pl(0)}2:${lastP}2)`, 0)
  calc.getCell('A1').value = f(`IF(B1=0,0,N(INDEX(${pl(0)}${ROW.calcWeek}:${lastP}${ROW.calcWeek},B1)))`, 0)

  // ---- หัวตารางรายการ
  ;([['No.', 1], ['รายการ', 2], ['ปริมาณ', 3], ['หน่วย', 4], ['มูลค่า (บาท)', 5], ['น้ำหนัก', 6],
    ['ล่าสุด (%)', cLast], ['แผน (%)', cPlan], ['ผลต่าง', cDiff], ['สถานะ', cStat], ['ปริมาณที่เสร็จ', cQty], ['มูลค่าที่เสร็จ (บาท)', cVal]] as const)
    .forEach(([t, c]) => put(`${col(c)}${PROGRESS_FIRST}`, t, head))
  for (let k = 0; k < nP; k += 1) put(`${pl(k)}${PROGRESS_FIRST}`, `งวดที่ ${k + 1}`, head)

  // ---- รายการงาน
  const input: Style = { fill: C.input, fmt: '0%;;;@', font: { size: 8 }, align: { horizontal: 'center', wrapText: false } }
  let ti = 0
  let ci = 0
  for (const cat of a.categories) {
    const on = cat.tasks.filter((t) => t.on)
    if (!on.length) continue
    const r = layout.catRows[ci]
    ci += 1
    put(`A${r}`, ci, { fill: C.cat, font: { bold: true }, align: { horizontal: 'center' } })
    merge(r, 2, r, cVal)
    put(`B${r}`, cat.name, { fill: C.cat, font: { bold: true } })
    on.forEach((t, j) => {
      const tr = layout.taskRows[ti]
      const rows = layout.itemRows[ti]
      const i0 = rows[0]
      const i1 = rows[rows.length - 1]
      const pr = a.planRows[ti]
      const bold: Style = { font: { bold: true }, fill: C.sum }
      put(`A${tr}`, `${ci}.${j + 1}`, { ...bold, align: { horizontal: 'center' } })
      put(`B${tr}`, t.name, bold)
      put(`C${tr}`, null, bold)
      put(`D${tr}`, null, bold)
      put(`E${tr}`, f(`SUM(E${i0}:E${i1})`, t.amount), { ...bold, fmt: '#,##0.00' })
      put(`F${tr}`, f(`IFERROR(E${tr}/${a.planTotal},0)`, dist.weights[ti]), { ...bold, fmt: '0.00%', align: { horizontal: 'center' } })
      for (let k = 0; k < nP; k += 1) {
        const x = pl(k)
        put(`${x}${tr}`, f(`IF(${k + 1}>${LP},"",SUMPRODUCT($E$${i0}:$E$${i1},${K(`${x}${i0}:${x}${i1}`)})/$E$${tr})`, ''),
          { ...bold, fmt: '0%', font: { bold: true, size: 8 }, align: { horizontal: 'center', wrapText: false } })
        // แผนของงานนี้ ณ วันส่งงวด: เสร็จแล้ว = 1 · กำลังทำ = วันที่ผ่านไป ÷ ระยะเวลา · ยังไม่เริ่ม = 0
        const dd = P(`${x}$${ROW.date}`)
        calc.getCell(`${pfrac(k)}${tr}`).value = f(
          `IF(${dd}="","",IF(${dd}>=${PL(`$E$${pr}`)},1,IF(${dd}>=${PL(`$D$${pr}`)},(${dd}-${PL(`$D$${pr}`)}+1)/${PL(`$C$${pr}`)},0)))`, '')
      }
      put(`${col(cLast)}${tr}`, f(`IF(${LP}=0,0,INDEX($${pl(0)}${tr}:$${lastP}${tr},${LP}))`, 0), { ...bold, fmt: '0%', align: { horizontal: 'center' } })
      put(`${col(cPlan)}${tr}`, f(`IF(${LP}=0,0,N(INDEX(${K(`$${pfrac(0)}${tr}:$${pfrac(nP - 1)}${tr}`)},${LP})))`, 0), { ...bold, fmt: '0%', align: { horizontal: 'center' } })
      put(`${col(cDiff)}${tr}`, f(`${col(cLast)}${tr}-${col(cPlan)}${tr}`, 0), { ...bold, fmt: '+0%;-0%;0%', align: { horizontal: 'center' } })
      put(`${col(cStat)}${tr}`, f(`IF(${LP}=0,"-",IF(${col(cDiff)}${tr}>=0.01,"เร็วกว่าแผน",IF(${col(cDiff)}${tr}<=-0.01,"ช้ากว่าแผน","ตามแผน")))`, '-'),
        { ...bold, align: { horizontal: 'center' } })
      put(`${col(cQty)}${tr}`, null, bold)
      put(`${col(cVal)}${tr}`, f(`SUM(${col(cVal)}${i0}:${col(cVal)}${i1})`, 0), { ...bold, fmt: '#,##0.00' })

      t.items.forEach((it, n) => {
        const ir = rows[n]
        put(`A${ir}`, it.code || null, { font: { size: 8, color: { argb: C.muted } }, align: { horizontal: 'center' } })
        put(`B${ir}`, it.name, { align: { indent: 1 } })
        put(`C${ir}`, it.qty, { fmt: '#,##0.##', align: { horizontal: 'right' } })
        put(`D${ir}`, it.unit, { align: { horizontal: 'center' } })
        put(`E${ir}`, it.amount, { fmt: '#,##0.00' })
        put(`F${ir}`, f(`IFERROR(E${ir}/${a.planTotal},0)`, dist.total ? it.amount / dist.total : 0), { fmt: '0.00%', font: { size: 8 }, align: { horizontal: 'center' } })
        for (let k = 0; k < nP; k += 1) {
          const x = pl(k)
          put(`${x}${ir}`, null, input)
          ws.getCell(`${x}${ir}`).dataValidation = {
            type: 'decimal', operator: 'between', allowBlank: true, formulae: [0, 1],
            showErrorMessage: true, errorTitle: 'ค่าไม่ถูกต้อง', error: 'กรอก % แล้วเสร็จสะสม 0–100',
          }
          const prev = k === 0 ? '0' : K(`${pl(k - 1)}${ir}`)
          calc.getCell(`${flag(k)}${ir}`).value = f(`IF(${P(`${x}${ir}`)}="",0,1)`, 0)
          calc.getCell(`${x}${ir}`).value = f(`IF(${P(`${x}${ir}`)}="",${prev},MIN(1,MAX(0,${P(`${x}${ir}`)})))`, 0)
        }
        put(`${col(cLast)}${ir}`, f(`IF(${LP}=0,0,INDEX(${K(`$${pl(0)}${ir}:$${lastP}${ir}`)},${LP}))`, 0), { fmt: '0%', align: { horizontal: 'center' } })
        ;[cPlan, cDiff, cStat].forEach((c) => put(`${col(c)}${ir}`, null))
        put(`${col(cQty)}${ir}`, f(`IF(C${ir}="","",C${ir}*${col(cLast)}${ir})`, 0), { fmt: '#,##0.##', align: { horizontal: 'right' } })
        put(`${col(cVal)}${ir}`, f(`E${ir}*${col(cLast)}${ir}`, 0), { fmt: '#,##0.00' })
      })
      ti += 1
    })
  }
  const tot = last + 1
  merge(tot, 1, tot, 4)
  put(`A${tot}`, 'รวมทั้งโครงการ', { ...head })
  put(`E${tot}`, f(`SUMPRODUCT(($C$${first}:$C$${last}<>"")*$E$${first}:$E$${last})`, dist.total), { ...head, fmt: '#,##0.00', align: {} })
  put(`F${tot}`, f(`E${tot}/${a.planTotal}`, 1), { ...head, fmt: '0.00%' })
  for (let k = 0; k < nP; k += 1) put(`${pl(k)}${tot}`, null, { fill: C.head })
  put(`${col(cLast)}${tot}`, f('D8', 0), { ...head, fmt: '0.00%' })
  put(`${col(cPlan)}${tot}`, f('D7', 0), { ...head, fmt: '0.00%' })
  put(`${col(cDiff)}${tot}`, f('D9', 0), { ...head, fmt: '+0.00%;-0.00%;0.00%' })
  put(`${col(cStat)}${tot}`, f('D10', '-'), head)
  put(`${col(cQty)}${tot}`, null, { fill: C.head })
  put(`${col(cVal)}${tot}`, f(`SUMPRODUCT(($C$${first}:$C$${last}<>"")*${col(cVal)}${first}:${col(cVal)}${last})`, 0), { ...head, fmt: '#,##0.00', align: {} })

  // สถานะเป็นสี: ช้า = แดง · เร็ว = เขียว (ทั้งข้อความและตัวเลขผลต่าง)
  let prio = 10
  const red = { font: { color: { argb: C.bad }, bold: true } }
  const green = { font: { color: { argb: C.good }, bold: true } }
  for (const rg of ['D10', `${pl(0)}${ROW.status}:${lastP}${ROW.status}`, `${col(cStat)}${first}:${col(cStat)}${tot}`]) {
    ws.addConditionalFormatting({ ref: rg, rules: [
      { type: 'containsText', operator: 'containsText', text: 'ช้า', priority: prio++, style: red },
      { type: 'containsText', operator: 'containsText', text: 'เร็ว', priority: prio++, style: green },
    ] })
  }
  for (const rg of ['D9', `${pl(0)}${ROW.diff}:${lastP}${ROW.diff}`, `${col(cDiff)}${first}:${col(cDiff)}${tot}`]) {
    const top = rg.split(':')[0]
    ws.addConditionalFormatting({ ref: rg, rules: [
      { type: 'expression', formulae: [`AND(ISNUMBER(${top}),${top}<0)`], priority: prio++, style: red },
      { type: 'expression', formulae: [`AND(ISNUMBER(${top}),${top}>0)`], priority: prio++, style: green },
    ] })
  }
  ws.pageSetup.printTitlesRow = `${PROGRESS_FIRST}:${PROGRESS_FIRST}`
}
