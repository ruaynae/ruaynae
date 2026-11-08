import test from 'node:test'
import assert from 'node:assert/strict'
import { mpMonths, mpLabel, mpSpanText, mpToggle, mpRemoveRow, parseMaintPlan, mpPages, emptyMaintPlan } from '../../src/lib/maintenance-plan.ts'

test('2 ปี ปีละ 2 ครั้ง เริ่ม พ.ย. 2026 (พ.ศ. 2569) = พ.ย.-69 พ.ค.-70 พ.ย.-70 พ.ค.-71', () => {
  const cols = mpMonths({ start: '2026-11', years: 2, perYear: 2 })
  assert.deepEqual(cols.map(mpLabel), ['พ.ย.-69', 'พ.ค.-70', 'พ.ย.-70', 'พ.ค.-71'])
  assert.equal(mpSpanText(cols), 'เดือน/ประจำปี พ.ศ. 2569 ถึง ปี พ.ศ. 2571')
})
test('ปีละ 4 ครั้ง ห่าง 3 เดือน · ไม่ตั้งเดือนเริ่ม = ไม่มีคอลัมน์', () => {
  assert.equal(mpMonths({ start: '2026-01', years: 1, perYear: 4 }).map(mpLabel).join(','), 'ม.ค.-69,เม.ย.-69,ก.ค.-69,ต.ค.-69')
  assert.equal(mpMonths({ start: '', years: 2, perYear: 2 }).length, 0)
})
test('สลับช่อง · ลบแถวเลื่อนเลข', () => {
  assert.deepEqual(mpToggle([], 1, 2), ['1.2'])
  assert.deepEqual(mpToggle(['1.2'], 1, 2), [])
  const p = { ...emptyMaintPlan(), items: ['a', 'b', 'c'], off: ['0.0', '1.1', '2.3'] }
  assert.deepEqual(mpRemoveRow(p, 1).off, ['0.0', '1.3'])
})
test('ตัวตรวจ: ปีละกี่ครั้งต้องหาร 12 ลงตัว · ช่องนอกตารางถูกทิ้ง', () => {
  const ok = parseMaintPlan({ v: 1, project: 'x', location: '', start: '2026-11', years: 2, perYear: 2, items: ['a'], off: ['0.1', '5.0', '0.9'] })
  assert.deepEqual(ok.off, ['0.1'])
  assert.equal(parseMaintPlan({ v: 1, start: '2026-11', years: 2, perYear: 5, items: [] }), null)
  assert.equal(parseMaintPlan({ v: 1, start: '2569-11', years: 2, perYear: 2, items: [] })?.start, '2569-11')
})
test('แบ่งแผ่น', () => {
  assert.deepEqual(mpPages(30, 13), [[0, 13], [13, 26], [26, 30]])
  assert.deepEqual(mpPages(0), [[0, 0]])
})
