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

test('อ่านไฟล์ที่กรอกผลงานรายงวด: ช่องว่างยกค่างวดก่อน · แผน ณ วันส่งงวดคิดรายวัน', () => {
  const D = (y, m, d) => new Date(Date.UTC(y, m - 1, d))
  const summary = sheet('สรุปผลเบิกจ่าย', [
    [], [], [PROJECT],
    ['งวดที่ 1', null, D(2026, 6, 10)],
    ['งวดที่ 2', null, D(2026, 6, 30)],
    ['งวดที่ 3'],
  ])
  // ชีตหมวด: หัวตารางแถว 8 (index 7) · งวดเริ่มคอลัมน์ M (index 12) · ตารางสรุปหัวชีตจบที่แถว "รวม…"
  const row = (cells, periods = []) => { const r = new Array(12).fill(null); cells.forEach((v, i) => { r[i] = v }); return [...r, ...periods] }
  const cat = { name: '1 งานสถาปัตยกรรม', rows: 0, cols: 20, v: null, w: null }
  const rows = [
    [], [], [], [], [], [], [],
    row(['ลำดับที่', 'รายการ', 'จำนวน', 'หน่วย', 'มูลค่างาน', 'เปอร์เซ็นที่แล้วเสร็จ'], ['งวดที่ 1', 'งวดที่ 2', 'งวดที่ 3']),
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
  // งาน 1.1: 1–10 มิ.ย. (10 วัน) · งาน 1.2: 11 มิ.ย.–10 ก.ค. (30 วัน)
  const plan = sheet('แผนงานก่อสร้าง', [
    [], [null, null, D(2026, 6, 1)], [], [], [], [], [],
    [null, null, null, null, null, null, 'W1', 'W2', 'W3', 'W4', 'W5', 'W6'],
    [null, null, 10, D(2026, 6, 1), D(2026, 6, 10), 'Plan', 0.175, 0.075],
    [null, null, null, null, null, 'Actual'],
    [null, null, 30, D(2026, 6, 11), D(2026, 7, 10), 'Plan', 0, 0.1, 0.175, 0.175, 0.175, 0.125],
  ])
  const r = readProgress(summary, [cat], plan)
  assert.equal(r.projectName, PROJECT)
  assert.equal(r.installments.length, 2)
  const [p1, p2] = r.installments
  assert.deepEqual([p1.date, p1.week, p2.date, p2.week], ['2026-06-10', 2, '2026-06-30', 5])
  // งวด 1: (0.5×40 + 0.4×60)/400 = 0.11 · แผน = งาน 1.1 เสร็จพอดี = 0.25 (ค่าในตารางสรุปหัวชีตไม่ถูกนับซ้ำ)
  assert.ok(Math.abs(p1.actual - 0.11) < 1e-9)
  assert.ok(Math.abs(p1.plan - 0.25) < 1e-9)
  // งวด 2: รื้อพื้นว่าง → ยก 40% · แผน = 0.25 + 0.75 × 20/30
  assert.ok(Math.abs(p2.actual - (40 + 24) / 400) < 1e-9)
  assert.ok(Math.abs(p2.plan - (0.25 + 0.75 * 20 / 30)) < 1e-9)
  assert.equal(r.actualCum[1], p1.actual)
  assert.equal(r.actualCum[4], p2.actual)
  assert.equal(r.actualCum[2], null)
  const [demo, floor] = r.tasks
  assert.equal(demo.category, 'หมวดงานสถาปัตยกรรม')
  assert.ok(Math.abs(demo.actual - 0.64) < 1e-9)
  assert.equal(demo.plan, 1)
  assert.ok(Math.abs(floor.plan - 20 / 30) < 1e-9)
  assert.equal(statusOf(-0.02, 0.01), 'behind')
  assert.equal(statusOf(0.004, 0.005), 'on')
})

test('ไฟล์ที่ไม่ใช่แผนงานจากระบบ → NOT_PLAN_FILE', () => {
  assert.throws(() => readProgress(sheet('x', [['สวัสดี']]), [], sheet('y', [])), /NOT_PLAN_FILE/)
  assert.throws(() => readProgress(sheet('x', []), [sheet('z', [['สวัสดี']])], sheet('y', [])), /NOT_PLAN_FILE/)
})
