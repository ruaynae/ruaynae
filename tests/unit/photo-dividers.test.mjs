import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDividers, dividersFromPhotos, applyDividers } from '../../src/lib/photo-dividers.ts'

test('แผนที่หน้าคั่น: ไป-กลับตามลำดับรูป · ตามรูปเมื่อเลื่อนลำดับ', () => {
  const photos = [{ k: 'a', divider: 'รูปภาพระหว่างก่อสร้าง' }, { k: 'b' }, { k: 'c', divider: ' ผลการทดสอบ  แสงสว่าง ' }]
  const map = dividersFromPhotos(photos)
  assert.deepEqual(map, { 1: 'รูปภาพระหว่างก่อสร้าง', 3: 'ผลการทดสอบ แสงสว่าง' })
  const back = applyDividers([{ k: 'a' }, { k: 'b' }, { k: 'c' }], map)
  assert.equal(back[2].divider, 'ผลการทดสอบ แสงสว่าง')
  // เลื่อนรูป c ขึ้นมาที่สอง → หน้าคั่นตามไปกับรูปนั้น (คำนวณใหม่จากลำดับใหม่)
  const moved = [photos[0], photos[2], photos[1]]
  assert.deepEqual(Object.keys(dividersFromPhotos(moved)), ['1', '2'])
})
test('ตัวตรวจ: คีย์/ชนิดผิดถูกทิ้ง · ข้อความยาวเกินถูกตัด', () => {
  const m = parseDividers({ 1: 'ก', x: 'ข', 0: 'ค', 2: 5, 3: '', 4: 'ง'.repeat(500) })
  assert.deepEqual(Object.keys(m), ['1', '4'])
  assert.equal(m['4'].length, 120)
  assert.deepEqual(parseDividers(null), {})
})
