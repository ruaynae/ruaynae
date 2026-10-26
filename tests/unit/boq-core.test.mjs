import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoSchedule, distribute, parseBoq, weekCount } from '../../src/lib/boq/core.ts'

// ชีตจำลองจากตาราง 2 มิติ — ไม่ใช้ไฟล์ BOQ จริงของลูกค้า (repo เป็น public)
const sheet = (name, rows) => {
  const v = (r, c) => rows[r]?.[c] ?? null
  return { name, rows: rows.length, cols: 12, v, w: (r, c) => String(v(r, c) ?? '').replace(/\s+/g, ' ').trim() }
}
const PROJECT = 'โครงการปรับปรุงอาคารทดสอบ ชั้น 1'
const pr6 = sheet('ปร.6', [
  ['แบบสรุปราคากลาง'],
  ['ชื่อโครงการ/งานก่อสร้าง', null, PROJECT],
  ['สถานที่ก่อสร้าง', null, 'อาคารทดสอบ'],
  [null, null, 'ถนนทดสอบ'],
  ['หน่วยงานเจ้าของโครงการ/งานก่อสร้าง', null, 'หน่วยงานทดสอบ'],
  ['สรุป', 'รวมค่าก่อสร้างทั้งโครงการ/งานก่อสร้าง'],
  [null, null, 1500000],
])
const pr5 = sheet('ปร.5(ก)', [
  ['ชื่อโครงการ/งานก่อสร้าง', null, PROJECT],
  ['ลำดับที่', 'รายการ', 'ค่างานต้นทุน', 'Factor F'],
  ['1', 'หมวดงานสถาปัตยกรรม', 600000],
  ['2', 'หมวดงานระบบไฟฟ้า', 400000],
  [null, 'รวมค่างานต้นทุนทั้งหมด', 1000000, 1.3027],
])
const other5 = sheet('ปร.5(ข)', [
  ['ชื่อโครงการ/งานก่อสร้าง', null, 'โครงการก่อสร้างหอพักที่อื่นโดยสิ้นเชิง'],
  ['ลำดับที่', 'รายการ', 'ค่างานต้นทุน'],
  ['1', 'หมวดงานครุภัณฑ์', 600000],
])
const pr4 = (name, code, title, items) => sheet(name, [
  ['ลำดับที่', 'รายการ', 'จำนวน', 'หน่วย', 'ราคาค่าวัสดุ', null, 'ราคาค่าแรง', null, 'รวมค่าวัสดุและแรงงาน'],
  [code, title],
  ...items.map(([c, n, a]) => [c, n, 1, 'งาน', null, a, null, 0, a]),
])
const arch = pr4('1 สถาปัตย์', '1', 'หมวดงานสถาปัตยกรรม', [['1.1', 'หมวดงานรื้อถอน', 100000], ['1.2', 'งานพื้น', 500000]])
const elec = pr4('2 ไฟฟ้า', '2', 'หมวดงานระบบไฟฟ้า', [['2.1', 'หมวดงานสายไฟฟ้า และท่อไฟฟ้า', 300000], ['2.2', 'งานดวงโคมไฟฟ้า', 100000]])
// ชีตเทียบราคาที่ยอดบังเอิญชนกับหมวดไม่ได้ — ต้องไม่ถูกหยิบ
const decoy = pr4('เทียบงาน', '1', 'งานเทียบ', [['1.1', 'งานลด', 123]])

test('จับคู่ ปร.5 กับ ปร.4 ด้วยยอดเงิน แล้วข้าม ปร.5 ของโครงการอื่น', () => {
  const m = parseBoq([pr6, pr5, arch, other5, elec, decoy])
  assert.equal(m.project.name, PROJECT)
  assert.equal(m.project.total, 1500000)
  assert.equal(m.project.loc2, 'ถนนทดสอบ')
  assert.equal(m.factor, 1.3027)
  assert.deepEqual(m.categories.map((c) => c.name), ['หมวดงานสถาปัตยกรรม', 'หมวดงานระบบไฟฟ้า'])
  assert.deepEqual(m.categories[0].tasks.map((t) => t.amount), [100000, 500000])
  assert.ok(m.warnings.some((w) => w.includes('ปร.5(ข)')))
})

test('หมวดที่ไม่มีรายละเอียด ปร.4 กลายเป็นงานเดียวพร้อมคำเตือน', () => {
  const m = parseBoq([pr6, pr5, arch])
  assert.equal(m.categories[1].tasks.length, 1)
  assert.equal(m.categories[1].tasks[0].amount, 400000)
  assert.ok(m.warnings.some((w) => w.includes('หมวดงานระบบไฟฟ้า')))
})

test('ไฟล์ที่ไม่มีงานเลยโยน BOQ_EMPTY', () => {
  assert.throws(() => parseBoq([sheet('Sheet1', [['สวัสดี']])]), /BOQ_EMPTY/)
})

test('จัดลำดับ: รื้อถอนเริ่มก่อน · ทุกงานอยู่ในระยะสัญญา', () => {
  const cats = autoSchedule(parseBoq([pr6, pr5, arch, elec]).categories, 180)
  const all = cats.flatMap((c) => c.tasks)
  const demo = all.find((t) => t.name.includes('รื้อถอน'))
  assert.equal(Math.min(...all.map((t) => t.offset)), demo.offset)
  for (const t of all) assert.ok(t.offset >= 0 && t.dur >= 1 && t.offset + t.dur <= 180, t.name)
})

test('น้ำหนักรายสัปดาห์รวมกันได้ 100% และสะสมไม่ลด', () => {
  const cats = autoSchedule(parseBoq([pr6, pr5, arch, elec]).categories, 180)
  const d = distribute(cats, 180)
  assert.equal(d.weeks, weekCount(180))
  assert.ok(Math.abs(d.cum[d.cum.length - 1] - 1) < 1e-9)
  for (let i = 1; i < d.cum.length; i += 1) assert.ok(d.cum[i] >= d.cum[i - 1])
  d.plan.forEach((row, i) => assert.ok(Math.abs(row.reduce((s, x) => s + x, 0) - d.weights[i]) < 1e-9))
})

test('งานที่ติ๊กออกไม่ถูกนับน้ำหนัก', () => {
  const cats = autoSchedule(parseBoq([pr6, pr5, arch, elec]).categories, 180)
  cats[0].tasks[1].on = false
  const d = distribute(cats, 180)
  assert.equal(d.total, 500000)
  assert.equal(d.plan.length, 3)
})

test('รายการย่อยจากส่วนรายละเอียด ปร.4 ต้องรวมได้เท่ายอดงาน ไม่งั้นใช้งานทั้งก้อน', () => {
  const detail = sheet('1 สถาปัตย์', [
    ['ลำดับที่', 'รายการ', 'จำนวน', 'หน่วย', null, null, null, null, 'รวมค่าวัสดุและแรงงาน'],
    ['1', 'หมวดงานสถาปัตยกรรม'],
    ['1.1', 'หมวดงานรื้อถอน', 1, 'งาน', null, null, null, null, 100000],
    ['1.2', 'งานพื้น', 1, 'งาน', null, null, null, null, 500000],
    [],
    ['1', 'หมวดงานสถาปัตยกรรม'],
    ['1.1', 'หมวดงานรื้อถอน'],
    [null, ' - รื้อฝ้า', 20, 'ตร.ม.', null, null, null, null, 40000],
    [null, ' - รื้อพื้น', 100, 'ตร.ม.', null, null, null, null, 60000],
    [null, '   คำอธิบายต่อท้าย'],
    [null, 'รวมหมวดงานรื้อถอน', null, null, null, null, null, null, 100000],
    ['1.2', 'งานพื้น'],
    [null, ' - ปูกระเบื้อง', 200, 'ตร.ม.', null, null, null, null, 123],
  ])
  const m = parseBoq([pr6, pr5, detail, elec])
  const [demo, floor] = m.categories[0].tasks
  assert.deepEqual(demo.items.map((i) => [i.name, i.qty, i.unit, i.amount]), [['รื้อฝ้า', 20, 'ตร.ม.', 40000], ['รื้อพื้น', 100, 'ตร.ม.', 60000]])
  // ยอดไม่ตรง (123 ≠ 500,000) → งานทั้งก้อนเป็นรายการเดียว
  assert.deepEqual(floor.items.map((i) => [i.name, i.amount]), [['งานพื้น', 500000]])
})

import { readProgress, statusOf } from '../../src/lib/boq/progress-core.ts'

test('อ่านไฟล์ที่กรอกผลงานรายสัปดาห์: ช่องว่างยกค่าสัปดาห์ก่อน · แผน ณ สิ้นสัปดาห์คิดรายวัน', () => {
  const D = (y, m, d) => new Date(Date.UTC(y, m - 1, d))
  const summary = sheet('สรุปผลเบิกจ่าย', [[], [], [PROJECT]])
  // ชีตหมวด: หัวตารางแถว 8 (index 7) · สัปดาห์เริ่มคอลัมน์ M (index 12) · ตารางสรุปหัวชีตจบที่แถว "รวม…"
  const row = (cells, weeks = []) => { const r = new Array(12).fill(null); cells.forEach((v, i) => { r[i] = v }); return [...r, ...weeks] }
  const cat = { name: '1 งานสถาปัตยกรรม', rows: 0, cols: 20, v: null, w: null }
  const rows = [
    [], [], [], [], [], [], [],
    row(['ลำดับที่', 'รายการ', 'จำนวน', 'หน่วย', 'มูลค่างาน', 'เปอร์เซ็นที่แล้วเสร็จ'], ['W1', 'W2', 'W3']),
    [],
    row(['1', 'หมวดงานสถาปัตยกรรม']),
    row(['1.1', 'หมวดงานรื้อถอน', 1, 'งาน', 100], [0.99, 0.99]),
    row(['1.2', 'งานพื้น', 1, 'งาน', 300]),
    row([null, 'รวมหมวดงานสถาปัตยกรรม', null, null, 400]),
    [],
    row(['1', 'หมวดงานสถาปัตยกรรม']),
    row(['1.1', 'หมวดงานรื้อถอน']),
    row([null, ' - รื้อฝ้า', 10, 'ตร.ม.', 40], [0.5, 1]),
    row([null, ' - รื้อพื้น', 10, 'ตร.ม.', 60], [40]),
    row([null, 'รวมหมวดงานรื้อถอน', null, null, 100]),
    row(['1.2', 'งานพื้น']),
    row([null, ' - ปูกระเบื้อง', 10, 'ตร.ม.', 300]),
    row([null, 'รวมงานพื้น', null, null, 300]),
  ]
  Object.assign(cat, sheet(cat.name, rows), { cols: 20 })
  // สัญญา 35 วัน เริ่ม 1 มิ.ย. · งาน 1.1: 1–10 มิ.ย. (10 วัน) · งาน 1.2: 11 มิ.ย.–10 ก.ค. (30 วัน)
  const plan = sheet('แผนงานก่อสร้าง', [
    [], [null, null, D(2026, 6, 1)], [], [], [null, null, null, 35], [], [],
    [null, null, null, null, null, null, 'W1', 'W2', 'W3', 'W4', 'W5'],
    [null, null, 10, D(2026, 6, 1), D(2026, 6, 10), 'Plan', 0.175, 0.075],
    [null, null, null, null, null, 'Actual'],
    [null, null, 30, D(2026, 6, 11), D(2026, 7, 10), 'Plan', 0, 0.1, 0.175, 0.175, 0.3],
  ])
  const r = readProgress(summary, [cat], plan)
  assert.equal(r.projectName, PROJECT)
  // กรอกถึง W2 = สองจุด · วันที่ = วันสุดท้ายของสัปดาห์
  assert.equal(r.installments.length, 2)
  const [p1, p2] = r.installments
  assert.deepEqual([p1.date, p1.week, p2.date, p2.week], ['2026-06-07', 1, '2026-06-14', 2])
  // W1: (0.5×40 + 0.4×60)/400 = 0.11 · แผน = งาน 1.1 เดินไป 7/10 = 0.25 × 0.7 (ค่าในตารางสรุปหัวชีตไม่ถูกนับซ้ำ)
  assert.ok(Math.abs(p1.actual - 0.11) < 1e-9)
  assert.ok(Math.abs(p1.plan - 0.175) < 1e-9)
  // W2: รื้อพื้นว่าง → ยก 40% · แผน = 0.25 + 0.75 × 4/30
  assert.ok(Math.abs(p2.actual - (40 + 24) / 400) < 1e-9)
  assert.ok(Math.abs(p2.plan - (0.25 + 0.75 * 4 / 30)) < 1e-9)
  assert.equal(r.actualCum[0], p1.actual)
  assert.equal(r.actualCum[1], p2.actual)
  assert.equal(r.actualCum[2], null)
  const [demo, floor] = r.tasks
  assert.equal(demo.category, 'หมวดงานสถาปัตยกรรม')
  assert.ok(Math.abs(demo.actual - 0.64) < 1e-9)
  assert.equal(demo.plan, 1)
  assert.ok(Math.abs(floor.plan - 4 / 30) < 1e-9)
  assert.equal(statusOf(-0.02, 0.01), 'behind')
  assert.equal(statusOf(0.004, 0.005), 'on')
})

test('ไฟล์ที่ไม่ใช่แผนงานจากระบบ → NOT_PLAN_FILE', () => {
  assert.throws(() => readProgress(sheet('x', [['สวัสดี']]), [], sheet('y', [])), /NOT_PLAN_FILE/)
  assert.throws(() => readProgress(sheet('x', []), [sheet('z', [['สวัสดี']])], sheet('y', [])), /NOT_PLAN_FILE/)
})

// ---- ว.124 ข้อ 2.2
import { W124, w124Offset, w124State, withW124 } from '../../src/lib/boq/w124.ts'

test('ว.124: วันที่ตรวจ = วันแรกที่เวลาใช้ไปเกินสัดส่วน · ครบสัญญา = วันสุดท้าย', () => {
  assert.equal(w124Offset(180, 0.5), 90) // ใช้ไป 91 วัน > 90
  assert.equal(w124Offset(181, 0.5), 90) // ใช้ไป 91 วัน > 90.5
  assert.equal(w124Offset(180, 0.75), 135)
  assert.equal(w124Offset(180, 1), 179)
})

test('ว.124: ผ่านเมื่อถึงเกณฑ์ · ยังไม่ถึงวันตรวจ = รอ · ถึงแล้วต่ำกว่าเกณฑ์ = ไม่ผ่าน', () => {
  // ข้อ 2.2.1 กับ 2.2.2 รวมเป็นเกณฑ์เดียว (คำสั่งเจ้าของ 26 ต.ค. 2569): เวลาเกิน 1/2 ผลงาน ≥ 25%
  assert.deepEqual(W124.map((r) => [r.clause, r.frac, r.min]), [['2.2.1, 2.2.2', 0.5, 0.25], ['2.2.3', 0.75, 0.65], ['2.2.4', 1, 0.85]])
  const [half, r223] = W124
  assert.equal(w124State(half, true, 0.25), 'pass')
  assert.equal(w124State(half, true, 0.2385), 'fail') // ตัวอย่างในสิ่งที่ส่งมาด้วย 4 (23.85%)
  assert.equal(w124State(half, false, 0.2), 'pending')
  assert.equal(w124State(half, true, 0.0), 'fail') // ไม่มีผลงานก่อนวันตรวจ
  assert.equal(w124State(r223, true, 0.7), 'pass')
})

test('ว.124: ผลงาน ณ วันตรวจ = สัปดาห์ล่าสุดที่กรอกและจบไม่เกินวันตรวจ', () => {
  const base = { projectName: '', labels: [], sublabels: [], planWeekly: [], planCum: [], actualCum: [], tasks: [], w124: [] }
  const r = withW124({
    ...base, w124Enabled: true, start: '2026-03-01', days: 180, asOf: '2026-07-10',
    installments: [
      { no: 11, date: '2026-05-16', week: 11, plan: 0.13, actual: 0.2 },
      { no: 19, date: '2026-07-11', week: 19, plan: 0.64, actual: 0.35 },
    ],
  })
  assert.deepEqual(r.w124.map((c) => [c.clause, c.date, c.period, c.state]), [
    ['2.2.1, 2.2.2', '2026-05-30', 11, 'fail'],
    ['2.2.3', '2026-07-14', 19, 'pending'],
    ['2.2.4', '2026-08-27', 19, 'pending'],
  ])
  assert.equal(r.w124[0].x, 13)
})

// ---- BOQ แบบเก่า: ชื่อชีตไม่ตรงเนื้อหา · ปร.4 ไม่มีก้อนสรุปหัวชีต · หมวดจบที่แถว "รวมกลุ่มงาน…"
test('parseBoq: แบบเก่า (ปร.1 (ก)/ปร.2 (ก) ในชีตชื่อ ปร.4 (ก)/ปร.5 (ก)) — อ่านครบทุกงานและรายการ', () => {
  const amt = (cells, a) => { const r = [...cells]; while (r.length < 8) r.push(null); r[8] = a; return r }
  const head = ['ลำดับที่', 'รายการ', 'จำนวน', 'หน่วย', 'ค่าวัสดุ', null, 'ค่าแรงงาน', null, 'รวมค่าวัสดุ']
  const p6 = sheet('ปร.6', [
    ['แบบ ปร.4 แผ่นที่ 1/1'], ['แบบสรุปราคากลางงานก่อสร้างอาคาร'],
    [`ชื่อโครงการ/งานก่อสร้าง ${PROJECT}`],
    ['สรุป', 'รวมค่าก่อสร้างทั้งโครงการ/งานก่อสร้าง', 600000],
  ])
  const sum = sheet('ปร.4 (ก)', [
    ['แบบ ปร.1 (ก)'], ['แบบสรุปค่าก่อสร้าง'], ['ค่างานต้นทุน'], [`ชื่อโครงการ/งานก่อสร้าง ${PROJECT}`],
    ['ลำดับที่', 'รายการ', 'ค่างานต้นทุน', ' Factor F', 'ค่าก่อสร้าง'],
    [1, ' - กลุ่มงานสถาปัตยกรรม', 300000, 1.3073, 392190],
    [2, ' - กลุ่มงานไฟฟ้า', 100000, 1.3073, 130730],
  ])
  const det = sheet('ปร.4', [
    ['แบบแสดงรายการ ปริมาณงาน และราคา'], [`ชื่อโครงการ/งานก่อสร้าง ${PROJECT}`], head,
    ['', 'กลุ่มงานสถาปัตยกรรม'],
    [1, 'งานรื้อถอน'],
    amt(['1.1', ' - รื้อประตู', 4, 'ตร.ม.'], 100000),
    amt(['1.2', ' - รื้อพื้น', 45, 'ตร.ม.'], 50000),
    ['', '* รื้อเก็บหมายถึงรื้อไปเก็บไว้'],
    amt(['', 'รวมงานรื้อถอน'], 150000),
    [2, 'งานพื้น'],
    amt(['2.1', ' - ปูพื้น', 20, 'ตร.ม.'], 100000),
    amt(['', '   - ท่อเหล็ก', 341, 'กก.'], 50000),
    amt(['', 'งานพื้น'], 150000),
    amt(['', 'รวมกลุ่มงานสถาปัตยกรรม'], 300000),
    ['', 'กลุ่มงานระบบไฟฟ้า'],
    [3, 'งานระบบไฟฟ้า'],
    amt(['3.1', ' - สายไฟ', 80, 'เมตร'], 100000),
    amt(['', 'รวมกลุ่มงานระบบไฟฟ้า'], 100000),
  ])
  const fsum = sheet('ปร.5 (ก)', [
    ['แบบ ปร.2 (ก)'], ['แบบสรุปค่าครุภัณฑ์จัดซื้อ'], [`ชื่อโครงการ/งานก่อสร้าง ${PROJECT}`],
    ['ลำดับที่', 'รายการ', 'ค่าครุภัณ์', null, null, 'ค่าติดตั้ง'],
    [1, 'เก้าอี้อเนกประสงค์', 70000, 0.07, 74900],
  ])
  const fdet = sheet('ปร.5', [
    ['แบบ ปร.2 แผ่นที่ 1'], ['แบบแสดงรายการ ปริมาณงาน และราคา'], ['ค่าครุภัณฑ์จัดซื้อ'],
    ['ลำดับที่', 'รายการ', 'จำนวน', 'หน่วย', 'ค่าครุภัณฑ์', null, 'ค่าติดตั้ง', null, 'รวมค่าครุภัณฑ์'],
    amt([1, ' - เก้าอี้อเนกประสงค์ (สีผู้ว่าจ้างเลือก)', 7, 'ตัว'], 70000),
  ])
  const m = parseBoq([p6, sum, det, fsum, fdet])
  assert.deepEqual(m.warnings, [])
  assert.equal(m.factor, 1.3073)
  assert.equal(m.project.total, 600000)
  assert.deepEqual(m.categories.map((c) => [c.name, c.mult, c.tasks.map((t) => [t.name, t.amount, t.items.length])]), [
    ['กลุ่มงานสถาปัตยกรรม', 1.3073, [['งานรื้อถอน', 150000, 2], ['งานพื้น', 150000, 2]]],
    ['กลุ่มงานไฟฟ้า', 1.3073, [['งานระบบไฟฟ้า', 100000, 1]]],
    ['ค่าครุภัณฑ์จัดซื้อ', 1.07, [['เก้าอี้อเนกประสงค์', 70000, 1]]],
  ])
  assert.equal(m.categories[2].tasks[0].items[0].qty, 7)
})

test('แผนเสริม: setAltPlan เปิด/ปิดทีละแผน เริ่มเท่าแผนตามสัญญา · distribute ตามแผนที่เลือก · autoSchedule บีบแผนเสริมให้อยู่ในสัญญา', async () => {
  const { setAltPlan, altKindsOf, hasAltPlans, spanOf } = await import('../../src/lib/boq/core.ts')
  const task = (name, amount, offset, dur) => ({ name, amount, source: '', items: [], offset, dur, on: true })
  const cats = [{ name: 'หมวด', source: '', mult: 1, group: '', tasks: [task('ก', 100, 0, 14), task('ข', 300, 14, 14)] }]
  assert.equal(hasAltPlans(cats), false)
  const opsOnly = setAltPlan(cats, 'ops', true)
  assert.deepEqual(altKindsOf(opsOnly), ['ops'])
  const on = setAltPlan(opsOnly, 'fast', true)
  assert.deepEqual(altKindsOf(on), ['fast', 'ops'])
  assert.deepEqual(spanOf(on[0].tasks[1], 'ops'), { offset: 14, dur: 14 })
  assert.deepEqual(distribute(on, 28, 'fast').cum, distribute(on, 28).cum)
  on[0].tasks[1].fast = { offset: 0, dur: 7 }
  const fast = distribute(on, 28, 'fast')
  assert.ok(Math.abs(fast.perWeek[0] - (0.25 / 2 + 0.75)) < 1e-9)
  assert.ok(Math.abs(fast.cum.at(-1) - 1) < 1e-9)
  assert.deepEqual(altKindsOf(setAltPlan(on, 'fast', false)), ['ops'])
  assert.equal(hasAltPlans(setAltPlan(opsOnly, 'ops', false)), false)
  on[0].tasks[0].ops = { offset: 20, dur: 8 }
  assert.deepEqual(autoSchedule(on, 21)[0].tasks[0].ops, { offset: 20, dur: 1 })
})

test('เส้น "แผนงานตาม ว.124": ผ่าน 25% ที่เวลาเกิน 1/2 · 65% ที่ 3/4 · จบ 100% · เดินตามรูปทรงแผน', async () => {
  const { w124Curve, w124Anchors, cumAtDay } = await import('../../src/lib/boq/core.ts')
  // 28 วัน (4 สัปดาห์) · แผนสะสม 10/40/70/100
  const cum = [0.1, 0.4, 0.7, 1]
  assert.deepEqual(w124Anchors(28).map((a) => a.e), [0, 15, 22, 28])
  assert.ok(Math.abs(cumAtDay(cum, 28, 14) - 0.4) < 1e-9)
  assert.ok(Math.abs(cumAtDay(cum, 28, 15) - (0.4 + 0.3 / 7)) < 1e-9)
  const w = w124Curve(cum, 28)
  // W1–W2 อยู่ก่อนจุดครึ่งเวลา: 25% × แผนสะสม ÷ แผน ณ วันที่ 15
  const pH = 0.4 + 0.3 / 7
  assert.ok(Math.abs(w[0] - 0.25 * 0.1 / pH) < 1e-9)
  assert.ok(Math.abs(w[1] - 0.25 * 0.4 / pH) < 1e-9)
  assert.equal(w[3], 1)
  assert.ok(w.every((v, i) => i === 0 || v >= w[i - 1]))
  // 180 วัน: สัปดาห์ที่ 13 จบวันที่ 91 = วันตรวจครึ่งเวลา → 25% พอดี
  const flat = Array.from({ length: 26 }, (_, k) => Math.min(1, (7 * (k + 1)) / 180))
  assert.ok(Math.abs(w124Curve(flat, 180)[12] - 0.25) < 1e-9)
})
