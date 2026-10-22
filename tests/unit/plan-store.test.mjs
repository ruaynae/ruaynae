import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePlanInput, parseProgress, planFromRow, lastFilledPeriod } from '../../src/lib/boq/plan-store.ts'
import { planReport } from '../../src/lib/boq/core.ts'

// แผนจำลอง (ไม่ใช่ BOQ จริงของลูกค้า): 2 หมวด · งานที่ปิดไว้ 1 งาน · 70 วัน (10 สัปดาห์)
const item = (name, amount) => ({ code: '', name, qty: 1, unit: 'งาน', amount })
const plan = () => ({
  name: 'โครงการทดสอบ',
  project: { name: 'โครงการทดสอบ', owner: 'หน่วยงานทดสอบ', loc1: '', loc2: '', code: '', total: 1300000, contractor: '', contractNo: '', contractDate: '', contractorRep: '' },
  factor: 1.3, vat: 0.07,
  categories: [
    { name: 'งานโครงสร้าง', source: 'ปร.4', mult: 1.3, group: '', tasks: [
      { name: 'งานฐานราก', amount: 600000, source: '', offset: 0, dur: 35, on: true, items: [item('ขุดดิน', 200000), item('เทคอนกรีต', 400000)] },
      { name: 'งานที่ไม่ทำ', amount: 50000, source: '', offset: 0, dur: 10, on: false, items: [item('x', 50000)] },
    ] },
    { name: 'งานสถาปัตยกรรม', source: 'ปร.4', mult: 1.3, group: '', tasks: [
      { name: 'งานผนัง', amount: 400000, source: '', offset: 35, dur: 35, on: true, items: [item('ก่ออิฐ', 400000)] },
    ] },
  ],
  start: '2027-01-01', days: 70, periods: 3, w124: true, sourceFile: 'boq.xlsx',
})

test('parsePlanInput: แผนที่ถูกต้องผ่าน · ชื่อว่างใช้ชื่อโครงการ', () => {
  const r = parsePlanInput({ ...plan(), name: '' })
  assert.equal(r.ok, true)
  assert.equal(r.value.name, 'โครงการทดสอบ')
  assert.equal(r.value.categories[0].tasks[1].on, false)
})

test('parsePlanInput: งานเลยวันสิ้นสุดสัญญา · ไม่มีงานที่เลือก · ระยะเวลา/งวด/วันที่ผิด → ปฏิเสธ', () => {
  const late = plan(); late.categories[1].tasks[0].dur = 36
  assert.deepEqual(parsePlanInput(late), { ok: false, error: 'PLAN_CATEGORIES_INVALID' })
  const none = plan(); none.categories.forEach((c) => c.tasks.forEach((t) => { t.on = false }))
  assert.equal(parsePlanInput(none).error, 'PLAN_CATEGORIES_INVALID')
  assert.equal(parsePlanInput({ ...plan(), days: 13 }).error, 'PLAN_DAYS_INVALID')
  assert.equal(parsePlanInput({ ...plan(), periods: 25 }).error, 'PLAN_PERIODS_INVALID')
  assert.equal(parsePlanInput({ ...plan(), start: '2027-02-30' }).error, 'PLAN_START_INVALID')
  const neg = plan(); neg.categories[0].tasks[0].items[0].amount = -1
  assert.equal(parsePlanInput(neg).error, 'PLAN_CATEGORIES_INVALID')
})

test('parseProgress: ตัดงวดที่เกิน · ทิ้งคีย์ที่ไม่มีรายการ · ค่านอก 0–1 / วันที่ผิด = error', () => {
  const p = plan()
  const r = parseProgress({
    dates: ['2027-01-20', null, '', '2027-03-30'],
    items: { '0.0.0': [0.5, null, 1, 1], '9.9.9': [1], '1.0.0': [null, null, null, 0.5], '0.0.1': [0.123456] },
  }, p.periods, p.categories)
  assert.equal(r.ok, true)
  assert.deepEqual(r.value.dates, ['2027-01-20', null, null])
  assert.deepEqual(r.value.items, { '0.0.0': [0.5, null, 1], '0.0.1': [0.1235, null, null] })
  assert.equal(parseProgress({ dates: [], items: { '0.0.0': [1.2] } }, 3, p.categories).error, 'PROGRESS_VALUE_INVALID')
  assert.equal(parseProgress({ dates: ['20/01/2570'], items: {} }, 3, p.categories).error, 'PROGRESS_DATE_INVALID')
  assert.equal(lastFilledPeriod(r.value), 3)
})

test('planFromRow: jsonb รูปร่างเพี้ยน = null ไม่ใช่หน้าพัง · ผลงานเพี้ยน = ว่าง', () => {
  const p = plan()
  const row = { id: 'x', name: p.name, site_id: null, project: p.project, factor: '1.3', vat: '0.07', categories: p.categories,
    start_date: p.start, days: p.days, periods: p.periods, w124: true, source_file: '', progress: 'bad', updated_at: 't' }
  const ok = planFromRow(row)
  assert.equal(ok.factor, 1.3)
  assert.deepEqual(ok.progress, { dates: [], items: {} })
  assert.equal(planFromRow({ ...row, categories: [{}] }), null)
})

test('planReport: ช่องว่างยกค่างวดก่อน · น้ำหนักจากค่างาน · แผน ณ วันส่งงวดคิดรายวัน', () => {
  const p = plan()
  const progress = {
    dates: ['2027-01-18', '2027-02-14', null],
    items: { '0.0.0': [1, null, null], '0.0.1': [0.25, 1, null], '1.0.0': [null, 0.2, 0.5] },
  }
  const r = planReport({ ...p, progress }, '2027-03-01')
  // งานที่ปิดไว้ไม่นับ: ฐาน = 600,000 + 400,000
  assert.equal(r.installments.length, 3)
  const [a, b, c] = r.installments
  assert.equal(a.actual, (200000 + 100000) / 1e6)
  assert.equal(b.actual, (600000 + 80000) / 1e6)
  assert.equal(c.actual, (600000 + 200000) / 1e6)
  assert.equal(c.date, null)
  // 18 ม.ค. = วันที่ 18 ของงานฐานราก (35 วัน) → 18/35 × 60%
  assert.ok(Math.abs(a.plan - (18 / 35) * 0.6) < 1e-12)
  assert.equal(a.week, 3)
  // ข้อมูล ณ วันที่ = งวดล่าสุด (ไม่มีวันที่ = วันนี้)
  assert.equal(r.asOf, '2027-03-01')
  assert.deepEqual(r.tasks.map((t) => t.code), ['1.1', '2.1'])
  assert.equal(r.w124Enabled, true)
})
