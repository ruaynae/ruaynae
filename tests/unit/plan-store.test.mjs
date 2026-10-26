import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePlanInput, parseProgress, planFromRow, lastFilledWeek } from '../../src/lib/boq/plan-store.ts'
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

test('parseProgress: ยาวเท่าจำนวนสัปดาห์ · ทิ้งคีย์ที่ไม่มีรายการ · ค่านอก 0–1 = error', () => {
  const p = plan() // 70 วัน = 10 สัปดาห์
  const r = parseProgress({
    weekly: true,
    items: { '0.0.0': [0.5, null, 1, ...new Array(9).fill(1)], '9.9.9': [1], '1.0.0': [null, null], '0.0.1': [0.123456] },
  }, p)
  assert.equal(r.ok, true)
  assert.equal(r.value.weekly, true)
  assert.deepEqual(r.value.items['0.0.0'], [0.5, null, 1, 1, 1, 1, 1, 1, 1, 1])
  assert.deepEqual(r.value.items['0.0.1'], [0.1235, ...new Array(9).fill(null)])
  assert.equal('9.9.9' in r.value.items || '1.0.0' in r.value.items, false)
  assert.equal(parseProgress({ weekly: true, items: { '0.0.0': [1.2] } }, p).error, 'PROGRESS_VALUE_INVALID')
  assert.equal(lastFilledWeek(r.value), 10)
})

test('parseProgress: ข้อมูลแบบงวดเดิม → สัปดาห์ของวันส่งงวด · งวดไม่มีวันที่ = สัปดาห์ของวันนี้', () => {
  const p = plan()
  const r = parseProgress({ dates: ['2027-01-20', null], items: { '0.0.0': [0.5, 1] } }, p, '2027-02-14')
  assert.equal(r.ok, true)
  // 20 ม.ค. = วันที่ 20 → W3 · 14 ก.พ. = วันที่ 45 → W7
  assert.deepEqual(r.value.items['0.0.0'], [null, null, 0.5, null, null, null, 1, null, null, null])
  assert.equal(lastFilledWeek(r.value), 7)
})

test('planFromRow: jsonb รูปร่างเพี้ยน = null ไม่ใช่หน้าพัง · ผลงานเพี้ยน = ว่าง', () => {
  const p = plan()
  const row = { id: 'x', name: p.name, site_id: null, project: p.project, factor: '1.3', vat: '0.07', categories: p.categories,
    start_date: p.start, days: p.days, periods: p.periods, w124: true, source_file: '', progress: 'bad', updated_at: 't' }
  const ok = planFromRow(row)
  assert.equal(ok.factor, 1.3)
  assert.deepEqual(ok.progress, { weekly: true, items: {} })
  assert.equal(planFromRow({ ...row, categories: [{}] }), null)
})

test('planReport: ผลงานรายสัปดาห์ · ช่องว่างยกค่าสัปดาห์ก่อน · น้ำหนักจากค่างาน · เส้น ว.124', () => {
  const p = plan()
  const w = (pairs) => { const a = new Array(10).fill(null); for (const [k, v] of pairs) a[k] = v; return a }
  const progress = { weekly: true, items: { '0.0.0': w([[2, 1]]), '0.0.1': w([[2, 0.25], [6, 1]]), '1.0.0': w([[6, 0.2], [9, 0.5]]) } }
  const r = planReport({ ...p, progress }, '2027-03-01')
  // กรอกถึง W10 = 10 จุด · งานที่ปิดไว้ไม่นับ: ฐาน = 600,000 + 400,000
  assert.equal(r.installments.length, 10)
  const at = (wk) => r.installments[wk - 1]
  assert.equal(at(1).actual, 0)
  assert.equal(at(3).actual, (200000 + 100000) / 1e6)
  assert.equal(at(7).actual, (600000 + 80000) / 1e6)
  assert.equal(at(10).actual, (600000 + 200000) / 1e6)
  // สิ้น W3 = วันที่ 21 ของงานฐานราก (35 วัน) → 21/35 × 60%
  assert.equal(at(3).date, '2027-01-21')
  assert.ok(Math.abs(at(3).plan - (21 / 35) * 0.6) < 1e-12)
  assert.equal(r.actualCum[2], at(3).actual)
  // ข้อมูล ณ วันที่ = สิ้นสัปดาห์ล่าสุดที่กรอก (W10 จบวันสุดท้ายของสัญญา)
  assert.equal(r.asOf, '2027-03-11')
  assert.deepEqual(r.tasks.map((t) => t.code), ['1.1', '2.1'])
  assert.equal(r.w124Enabled, true)
  assert.equal(r.w124Cum.length, 10)
  assert.equal(r.w124Cum[9], 1)
  assert.equal(planReport({ ...p, w124: false, progress: { weekly: true, items: {} } }, '2027-01-01').w124Cum, undefined)
})

test('แผนเสริม (เร่งรัด/ดำเนินการ): บันทึกได้ · ช่วงเกินสัญญาถูกปฏิเสธ · รายงานมีเส้นสะสมของทั้งสองแผน', () => {
  const p = plan()
  p.categories[0].tasks[0].fast = { offset: 0, dur: 21 }
  p.categories[0].tasks[0].ops = { offset: 7, dur: 35 }
  const r = parsePlanInput(p)
  assert.equal(r.ok, true)
  assert.deepEqual(r.value.categories[0].tasks[0].fast, { offset: 0, dur: 21 })
  assert.equal('fast' in r.value.categories[1].tasks[0], false)

  const bad = plan()
  bad.categories[1].tasks[0].ops = { offset: 50, dur: 30 }
  assert.deepEqual(parsePlanInput(bad), { ok: false, error: 'PLAN_CATEGORIES_INVALID' })

  const rep = planReport({ ...r.value, progress: { weekly: true, items: {} } }, '2027-01-01')
  assert.equal(rep.fastCum.length, 10)
  assert.ok(Math.abs(rep.fastCum.at(-1) - 1) < 1e-9 && Math.abs(rep.opsCum.at(-1) - 1) < 1e-9)
  // เร่งรัด: ฐานรากเสร็จใน 3 สัปดาห์ (น้ำหนัก 60%) · ตามสัญญายังได้แค่ 3/5 ของงานนั้น
  assert.ok(Math.abs(rep.fastCum[2] - 0.6) < 1e-9)
  assert.ok(Math.abs(rep.planCum[2] - 0.36) < 1e-9)
  assert.equal(planReport({ ...plan(), progress: { weekly: true, items: {} } }, '2027-01-01').fastCum, undefined)
})
