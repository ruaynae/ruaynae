import test from 'node:test'
import assert from 'node:assert/strict'
import { parseEquipSummary, compactEquipSummary, isJpegDataUrl, eqCell, EQ_PHOTO_MAX_CHARS } from '../../src/lib/equipment-summary.ts'

const jpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
test('รูปที่ไม่ใช่ JPEG data URL หรือใหญ่เกินถูกทิ้ง แต่ตัวหนังสือยังอยู่', () => {
  const s = parseEquipSummary({ v: 1, items: [
    { name: 'เก้าอี้', brand: 'MIKAEL', seller: 'บจก.', warranty: '1 ปี', photo: jpg },
    { name: 'โซฟา', photo: 'data:image/svg+xml;base64,AAAA' },
    { name: 'ตู้', photo: 'data:image/jpeg;base64,' + 'A'.repeat(EQ_PHOTO_MAX_CHARS) },
    { name: 'x', photo: 'https://evil.example/x.jpg' },
  ] })
  assert.deepEqual(s.items.map((i) => i.photo), [jpg, '', '', ''])
  assert.equal(s.items[1].name, 'โซฟา')
})
test('ตัวตรวจ: โครงสร้างผิด = null · compact ทิ้งแถวไม่มีชื่อ', () => {
  assert.equal(parseEquipSummary({ v: 2, items: [] }), null)
  assert.equal(parseEquipSummary({ v: 1, items: 'x' }), null)
  assert.equal(compactEquipSummary(parseEquipSummary({ v: 1, items: [{ name: ' ' }] })), null)
  assert.equal(isJpegDataUrl(jpg), true)
  assert.equal(eqCell(' '), '-')
})
