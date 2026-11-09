import test from 'node:test'
import assert from 'node:assert/strict'
import { psTotalDays, psTime, psProgress, psBudget, fiscalYearBE, defaultBudget, parseProjectSummary, emptyProjectSummary } from '../../src/lib/project-summary.ts'

test('ระยะเวลา: 17 มิ.ย.–13 ธ.ค. 2569 = 180 วัน · ใช้ไป ณ 9 พ.ย. = 146 วัน', () => {
  const s = { start: '2026-06-17', end: '2026-12-13' }
  assert.equal(psTotalDays(s), 180)
  const t = psTime(s, '2026-11-09')
  assert.equal(t.used, 146)
  assert.equal(t.remain, 34)
  assert.equal(psTime(s, '2027-01-01').remain, 0)
  assert.equal(psTime(s, '2026-01-01').used, 0)
  assert.equal(psTotalDays({ start: '', end: '2026-12-13' }), null)
})
test('ปีงบประมาณ: ต.ค. นับปีถัดไป', () => {
  assert.equal(fiscalYearBE('2026-12-13'), 2570)
  assert.equal(fiscalYearBE('2026-09-30'), 2569)
  assert.deepEqual(defaultBudget('2026-09-30', 100), [{ label: 'พ.ศ. 2569', budget: 100, paid: 0 }])
})
test('สรุปหมวดงาน: แยกอาคาร/ครุภัณฑ์ · % ตามสัญญา · คงค้าง = สัญญา − จริง', () => {
  const it = (mat, lab, pm, pl) => ({ name: 'x', qty: 1, unit: 'u', mat, lab, pm, pl })
  const pw = { contract: 1000, cats: [
    { name: 'a', mult: 1, tasks: [{ name: 't', items: [it(300, 100, 0.5, 0.5)] }] },
    { name: 'b', mult: 1.5, equip: true, tasks: [{ name: 't', items: [it(400, 0, 0.25, 0)] }] },
  ] }
  const p = psProgress(pw)
  assert.deepEqual(p.groups.map((g) => [g.contract, g.actual]), [[400, 200], [600, 150]])
  assert.deepEqual(p.contractPct, [40, 60])
  assert.equal(p.totalActualPct, 35)
  assert.equal(p.totalLeftPct, 65)
  assert.deepEqual(p.leftPct, [20, 45])
})
test('ปีงบประมาณ: คงเหลือ = งบ − เบิกจ่าย', () => {
  const b = psBudget([{ label: 'พ.ศ. 2569', budget: 6800000, paid: 0 }])
  assert.equal(b.total.left, 6800000)
  assert.equal(b.total.paidPct, 0)
})
test('ตัวตรวจ: วันที่ผิดถูกทิ้ง · งวดนอกช่วง = null', () => {
  const s = parseProjectSummary({ ...emptyProjectSummary(), start: 'ไม่ใช่วันที่', installments: 500, budget: [{ label: 'x', budget: -1, paid: 0 }] })
  assert.equal(s.start, '')
  assert.equal(s.installments, null)
  assert.equal(s.budget.length, 0)
  assert.equal(parseProjectSummary({ v: 2 }), null)
})
