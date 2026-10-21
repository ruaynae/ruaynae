import type { Workbook } from 'exceljs'
import type { BoqCategory, Distribution } from './core'
import { C, SHEET, col, f, kit, monthBands, monthLabel, ref, type Style } from './xlsx-kit'

/**
 * ชีต "ปริมาณงานที่แล้วเสร็จ" — แบบฟอร์มกรอก % แล้วเสร็จสะสมของทุกรายการใน ปร.4 รายสัปดาห์
 * แล้วผูกกลับเข้าแถว Actual ของชีตแผนงาน → S-Curve ผลงานจริงและผลต่างกับแผนขึ้นเอง
 *
 * กติกาการกรอก: ช่องสัปดาห์ = % แล้วเสร็จ **สะสม** ของรายการนั้น ณ สิ้นสัปดาห์
 * · เว้นว่าง = เท่าสัปดาห์ก่อน (ไม่ต้องกรอกซ้ำทุกแถวทุกสัปดาห์) — ชีต "คำนวณ" (ซ่อน) ยกค่าต่อให้
 * · "สัปดาห์ล่าสุด" = สัปดาห์สุดท้ายที่มีการกรอกอย่างน้อยหนึ่งช่อง · หลังจากนั้นไม่วาดผลงานจริง
 */

export const PROGRESS_FIRST = 16
/** สัปดาห์ล่าสุดที่กรอก (0 = ยังไม่กรอก) */
export const LW = ref(SHEET.calc, '$A$1')
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

export function addProgressSheet(
  wb: Workbook,
  a: {
    categories: BoqCategory[]
    dist: Distribution
    start: Date
    projectName: string
    layout: ProgressLayout
    /** ชีตแผนงาน: แถว Plan ของแต่ละงาน · ช่องน้ำหนัก · แถวแผนสะสม · ช่องยอดรวม */
    planRows: number[]
    planWeightCol: string
    planCumRow: number
    planTotal: string
  },
) {
  const { dist, start, layout } = a
  const nW = dist.weeks
  const wl = (k: number) => col(W0 + k)
  const lastW = wl(nW - 1)
  const cLast = W0 + nW
  const cPlan = cLast + 1
  const cDiff = cLast + 2
  const cStat = cLast + 3
  const cQty = cLast + 4
  const cVal = cLast + 5
  const P = (addr: string) => ref(SHEET.progress, addr)
  const K = (addr: string) => ref(SHEET.calc, addr)
  const first = PROGRESS_FIRST + 1
  const last = layout.last

  const ws = wb.addWorksheet(SHEET.progress, {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 15, showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  const calc = wb.addWorksheet(SHEET.calc, { state: 'hidden' })
  const { put, merge } = kit(ws)
  ;[6, 46, 9, 7, 14, 8].forEach((w, i) => { ws.getColumn(i + 1).width = w })
  for (let k = 0; k < nW; k += 1) ws.getColumn(W0 + k).width = 6.4
  ;[9, 9, 9, 12, 11, 14].forEach((w, i) => { ws.getColumn(cLast + i).width = w })

  // ---- หัวแบบฟอร์ม + กล่องสถานะ
  const lab: Style = { font: { bold: true, color: { argb: C.muted } }, border: false }
  merge(1, 1, 1, cVal)
  put('A1', 'ปริมาณงานที่แล้วเสร็จ (ผลงานจริงเทียบแผน)', { font: { size: 15, bold: true }, border: false, align: { wrapText: false } })
  merge(2, 1, 2, cVal)
  put('A2', a.projectName, { font: { size: 11, bold: true }, border: false, align: { wrapText: false } })
  merge(3, 1, 3, cVal)
  put('A3', 'กรอก % แล้วเสร็จ "สะสม" ของแต่ละรายการในช่องสีเหลืองของสัปดาห์ที่รายงาน (พิมพ์ 40 = 40%) · ช่องที่เว้นว่างถือว่าเท่าสัปดาห์ก่อน · แถวงาน (ตัวหนา) และแผนงานคำนวณให้เอง',
    { border: false, font: { size: 8, color: { argb: C.muted } }, align: { wrapText: false } })
  const box: [string, string, number | string, string?][] = [
    ['สัปดาห์ล่าสุดที่กรอก', `IF(${LW}=0,"ยังไม่กรอก","W"&${LW})`, 'ยังไม่กรอก'],
    ['แผนงานสะสม ณ สัปดาห์นั้น', `IF(${LW}=0,0,INDEX(${ref(SHEET.plan, `$G$${a.planCumRow}:$${lastW}$${a.planCumRow}`)},${LW}))`, 0, '0.00%'],
    ['ผลงานจริงสะสม', `IF(${LW}=0,0,INDEX($G$12:$${lastW}$12,${LW}))`, 0, '0.00%'],
    ['เร็ว (+) / ช้า (−) กว่าแผน', 'D7-D6', 0, '+0.00%;-0.00%;0.00%'],
    ['สถานะโครงการ', `IF(${LW}=0,"-",IF(D8>=0.005,"เร็วกว่าแผน",IF(D8<=-0.005,"ช้ากว่าแผน","ตามแผน")))`, '-'],
  ]
  box.forEach(([t, formula, result, fmt], i) => {
    const r = 5 + i
    merge(r, 1, r, 3)
    put(`A${r}`, t, { ...lab, border: true, fill: C.sum })
    merge(r, 4, r, 6)
    put(`D${r}`, f(formula, result), { font: { bold: true, size: i === 4 ? 11 : 9 }, fmt, align: { horizontal: 'center' } })
  })

  // ---- สรุปรายสัปดาห์ (แถว 11–14) อยู่ใต้หัวสัปดาห์ของแถว 15
  const weekHead = 15
  ;([['No.', 1], ['รายการ', 2], ['ปริมาณ', 3], ['หน่วย', 4], ['มูลค่า (บาท)', 5], ['น้ำหนัก', 6],
    ['ล่าสุด (%)', cLast], ['แผน (%)', cPlan], ['ผลต่าง', cDiff], ['สถานะ', cStat], ['ปริมาณที่เสร็จ', cQty], ['มูลค่าที่เสร็จ (บาท)', cVal]] as const)
    .forEach(([t, c]) => put(`${col(c)}${weekHead}`, t, { fill: C.head, font: { bold: true }, align: { horizontal: 'center' } }))
  for (const m of monthBands(start, nW)) {
    merge(10, W0 + m.from, 10, W0 + m.to)
    put(`${wl(m.from)}10`, monthLabel(m.d), { fill: C.head, font: { bold: true }, align: { horizontal: 'center' } })
  }
  for (let k = 0; k < nW; k += 1) {
    put(`${wl(k)}${weekHead}`, f(`"W${k + 1} "&TEXT(${ref(SHEET.plan, `${wl(k)}$9`)},"d/m")`, `W${k + 1}`),
      { fill: C.head, font: { bold: true, size: 8 }, align: { horizontal: 'center' } })
  }
  const sumRows: [number, string][] = [[11, 'แผนงานสะสม (%)'], [12, 'ผลงานจริงสะสม (%)'], [13, 'เร็ว (+) / ช้า (−) (%)'], [14, 'สถานะ']]
  sumRows.forEach(([r, t]) => { merge(r, 1, r, 6); put(`A${r}`, t, { fill: C.sum, font: { bold: true } }) })
  merge(10, 1, 10, 6)
  put('A10', 'สรุปรายสัปดาห์', { fill: C.head, font: { bold: true } })
  const small: Style = { font: { size: 7 }, align: { horizontal: 'center', wrapText: false } }
  for (let k = 0; k < nW; k += 1) {
    const x = wl(k)
    const after = `${k + 1}>${LW}`
    put(`${x}11`, f(ref(SHEET.plan, `${x}${a.planCumRow}`), dist.cum[k]), { ...small, fmt: '0.00%' })
    put(`${x}12`, f(`IF(${after},"",SUMPRODUCT($E$${first}:$E$${last},${K(`${x}${first}:${x}${last}`)})/${a.planTotal})`, ''), { ...small, fmt: '0.00%', font: { size: 7, bold: true } })
    put(`${x}13`, f(`IF(${after},"",${x}12-${x}11)`, ''), { ...small, fmt: '+0.00%;-0.00%;0.00%' })
    put(`${x}14`, f(`IF(${after},"",IF(${x}13>=0.005,"เร็ว",IF(${x}13<=-0.005,"ช้า","ตาม")))`, ''), small)
  }

  // ---- ชีตคำนวณ (ซ่อน): A1 = สัปดาห์ล่าสุด · แถว 2 = ธงสัปดาห์ที่มีการกรอก
  //      คอลัมน์สัปดาห์ = % สะสมที่ยกค่าต่อแล้ว · คอลัมน์ชุดที่สอง (เลื่อนไป nW+2) = ธงว่าช่องนั้นถูกกรอก
  // 🔴 นับการกรอกจากธงของแถวรายการเท่านั้น — นับทั้งคอลัมน์ของแบบฟอร์มจะรวมแถวงานที่อ่าน A1 กลับมา = อ้างอิงวน
  const flag = (k: number) => col(W0 + nW + 2 + k)
  for (let k = 0; k < nW; k += 1) {
    const x = wl(k)
    calc.getCell(`${x}2`).value = f(`IF(SUM(${flag(k)}${first}:${flag(k)}${last})>0,${k + 1},0)`, 0)
  }
  calc.getCell('A1').value = f(`MAX(${wl(0)}2:${lastW}2)`, 0)

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
      for (let k = 0; k < nW; k += 1) {
        const x = wl(k)
        put(`${x}${tr}`, f(`IF(${k + 1}>${LW},"",SUMPRODUCT($E$${i0}:$E$${i1},${K(`${x}${i0}:${x}${i1}`)})/$E$${tr})`, ''),
          { ...bold, fmt: '0%', font: { bold: true, size: 8 }, align: { horizontal: 'center', wrapText: false } })
      }
      put(`${col(cLast)}${tr}`, f(`IF(${LW}=0,0,INDEX($G${tr}:$${lastW}${tr},${LW}))`, 0), { ...bold, fmt: '0%', align: { horizontal: 'center' } })
      // แผนของงานนี้ ณ สัปดาห์ล่าสุด = ผลรวมแถว Plan ถึงสัปดาห์นั้น ÷ น้ำหนักงาน
      const planRow = ref(SHEET.plan, `$G$${pr}:$${lastW}$${pr}`)
      put(`${col(cPlan)}${tr}`, f(`IF(${LW}=0,0,IFERROR(SUM(${ref(SHEET.plan, `$G$${pr}`)}:INDEX(${planRow},${LW}))/${ref(SHEET.plan, `$${a.planWeightCol}$${pr}`)},0))`, 0),
        { ...bold, fmt: '0%', align: { horizontal: 'center' } })
      put(`${col(cDiff)}${tr}`, f(`${col(cLast)}${tr}-${col(cPlan)}${tr}`, 0), { ...bold, fmt: '+0%;-0%;0%', align: { horizontal: 'center' } })
      put(`${col(cStat)}${tr}`, f(`IF(${LW}=0,"-",IF(${col(cDiff)}${tr}>=0.01,"เร็วกว่าแผน",IF(${col(cDiff)}${tr}<=-0.01,"ช้ากว่าแผน","ตามแผน")))`, '-'),
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
        for (let k = 0; k < nW; k += 1) {
          const x = wl(k)
          const c = ws.getCell(`${x}${ir}`)
          put(`${x}${ir}`, null, input)
          c.dataValidation = {
            type: 'decimal', operator: 'between', allowBlank: true, formulae: [0, 1],
            showErrorMessage: true, errorTitle: 'ค่าไม่ถูกต้อง', error: 'กรอก % แล้วเสร็จสะสม 0–100',
          }
          const prev = k === 0 ? '0' : K(`${wl(k - 1)}${ir}`)
          calc.getCell(`${flag(k)}${ir}`).value = f(`IF(${P(`${x}${ir}`)}="",0,1)`, 0)
          calc.getCell(`${x}${ir}`).value = f(`IF(${P(`${x}${ir}`)}="",${prev},MIN(1,MAX(0,${P(`${x}${ir}`)})))`, 0)
        }
        put(`${col(cLast)}${ir}`, f(`IF(${LW}=0,0,INDEX(${K(`$G${ir}:$${lastW}${ir}`)},${LW}))`, 0), { fmt: '0%', align: { horizontal: 'center' } })
        ;[cPlan, cDiff, cStat].forEach((c) => put(`${col(c)}${ir}`, null))
        put(`${col(cQty)}${ir}`, f(`IF(C${ir}="","",C${ir}*${col(cLast)}${ir})`, 0), { fmt: '#,##0.##', align: { horizontal: 'right' } })
        put(`${col(cVal)}${ir}`, f(`E${ir}*${col(cLast)}${ir}`, 0), { fmt: '#,##0.00' })
      })
      ti += 1
    })
  }
  const tot = last + 1
  merge(tot, 1, tot, 4)
  put(`A${tot}`, 'รวมทั้งโครงการ', { fill: C.head, font: { bold: true }, align: { horizontal: 'center' } })
  put(`E${tot}`, f(`SUMPRODUCT(($C$${first}:$C$${last}<>"")*$E$${first}:$E$${last})`, dist.total), { fill: C.head, font: { bold: true }, fmt: '#,##0.00' })
  put(`F${tot}`, f(`E${tot}/${a.planTotal}`, 1), { fill: C.head, font: { bold: true }, fmt: '0.00%', align: { horizontal: 'center' } })
  for (let k = 0; k < nW; k += 1) put(`${wl(k)}${tot}`, null, { fill: C.head })
  put(`${col(cLast)}${tot}`, f('D7', 0), { fill: C.head, font: { bold: true }, fmt: '0.00%', align: { horizontal: 'center' } })
  put(`${col(cPlan)}${tot}`, f('D6', 0), { fill: C.head, font: { bold: true }, fmt: '0.00%', align: { horizontal: 'center' } })
  put(`${col(cDiff)}${tot}`, f('D8', 0), { fill: C.head, font: { bold: true }, fmt: '+0.00%;-0.00%;0.00%', align: { horizontal: 'center' } })
  put(`${col(cStat)}${tot}`, f('D9', '-'), { fill: C.head, font: { bold: true }, align: { horizontal: 'center' } })
  put(`${col(cQty)}${tot}`, null, { fill: C.head })
  put(`${col(cVal)}${tot}`, f(`SUMPRODUCT(($C$${first}:$C$${last}<>"")*${col(cVal)}${first}:${col(cVal)}${last})`, 0), { fill: C.head, font: { bold: true }, fmt: '#,##0.00' })

  // สถานะเป็นสี: ช้า = แดง · เร็ว = เขียว (ทั้งข้อความและตัวเลขผลต่าง)
  let prio = 10
  const red = { font: { color: { argb: C.bad }, bold: true } }
  const green = { font: { color: { argb: C.good }, bold: true } }
  for (const rg of ['D9', `${wl(0)}14:${lastW}14`, `${col(cStat)}${first}:${col(cStat)}${tot}`]) {
    ws.addConditionalFormatting({ ref: rg, rules: [
      { type: 'containsText', operator: 'containsText', text: 'ช้า', priority: prio++, style: red },
      { type: 'containsText', operator: 'containsText', text: 'เร็ว', priority: prio++, style: green },
    ] })
  }
  for (const rg of ['D8', `${wl(0)}13:${lastW}13`, `${col(cDiff)}${first}:${col(cDiff)}${tot}`]) {
    const top = rg.split(':')[0]
    ws.addConditionalFormatting({ ref: rg, rules: [
      { type: 'expression', formulae: [`AND(ISNUMBER(${top}),${top}<0)`], priority: prio++, style: red },
      { type: 'expression', formulae: [`AND(ISNUMBER(${top}),${top}>0)`], priority: prio++, style: green },
    ] })
  }
  ws.pageSetup.printTitlesRow = `${weekHead}:${weekHead}`
}
