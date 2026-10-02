import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanMonths,
  defaultMonth,
  isOpenMonth,
  monthEnd,
  monthKey,
  monthLabel,
  monthOf,
  monthShort,
  nextMonth,
  parseMonth,
} from '../../src/lib/wage-month.ts'

test('parseMonth รับทั้งเดือนและวันที่ คืนวันที่ 1 เสมอ', () => {
  assert.equal(parseMonth('2026-09'), '2026-09-01')
  assert.equal(parseMonth('2026-09-17'), '2026-09-01')
  assert.equal(parseMonth(' 2026-10-01 '), '2026-10-01')
})

test('parseMonth ปฏิเสธของที่ไม่ใช่เดือน — รวมปี พ.ศ. ที่หลุดมา', () => {
  for (const bad of ['', '2026-13', '2026-00', '2569-09', '26-09', 'abc', null, undefined, 202609]) {
    assert.equal(parseMonth(bad), null, `ควรปฏิเสธ: ${String(bad)}`)
  }
})

test('monthEnd รู้จักเดือนสั้นและปีอธิกสุรทิน', () => {
  assert.equal(monthEnd('2026-09-01'), '2026-09-30')
  assert.equal(monthEnd('2026-10-01'), '2026-10-31')
  assert.equal(monthEnd('2026-02-01'), '2026-02-28')
  assert.equal(monthEnd('2028-02-01'), '2028-02-29')
})

test('nextMonth ข้ามปีได้', () => {
  assert.equal(nextMonth('2026-09-01'), '2026-10-01')
  assert.equal(nextMonth('2026-12-01'), '2027-01-01')
})

test('ป้ายเดือนเป็น พ.ศ. แต่ค่าข้างในเป็น ค.ศ.', () => {
  assert.equal(monthLabel('2026-09-01'), 'กันยายน 2569')
  assert.equal(monthShort('2026-10-01'), 'ต.ค. 2569')
  assert.equal(monthKey('2026-09-01'), '2026-09')
  assert.equal(monthOf('2026-09-30'), '2026-09-01')
})

test('เดือนปัจจุบันยังไม่จบ · เดือนที่แล้วจบแล้ว', () => {
  assert.equal(isOpenMonth('2026-10-01', '2026-10-02'), true)
  assert.equal(isOpenMonth('2026-09-01', '2026-10-02'), false)
})

// 🔴 ตัวอย่างของเจ้าของ: ออกใบสรุปวันที่ 2 ต.ค. ต้องได้ ก.ย. ไม่ใช่ 1 ก.ย. – 2 ต.ค.
test('ค่าเริ่มต้น = เดือนล่าสุดที่จบแล้ว (จ่ายวันที่ 5 ของเดือนถัดไป)', () => {
  assert.equal(defaultMonth(['2026-09-01', '2026-10-01'], '2026-10-02'), '2026-09-01')
  assert.equal(defaultMonth(['2026-08-01', '2026-09-01', '2026-10-01'], '2026-10-05'), '2026-09-01')
})

test('ค่าเริ่มต้นเมื่อเหลือแต่เดือนนี้ หรือไม่มีอะไรค้าง', () => {
  assert.equal(defaultMonth(['2026-10-01'], '2026-10-06'), '2026-10-01')
  assert.equal(defaultMonth([], '2026-10-06'), '2026-10-01')
})

test('cleanMonths ไม่เชื่อรูปจาก RPC · เรียง · ไม่ซ้ำ', () => {
  assert.deepEqual(cleanMonths(['2026-10-01', 'x', '2026-09-01', '2026-09-01', 7]), ['2026-09-01', '2026-10-01'])
  assert.deepEqual(cleanMonths(null), [])
})
