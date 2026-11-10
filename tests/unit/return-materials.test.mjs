import test from 'node:test'
import assert from 'node:assert/strict'
import { parseReturnMaterials, compactReturnMaterials, rmPhotoChars, RM_PHOTO_MAX_CHARS, RM_LIMITS } from '../../src/lib/return-materials.ts'

const jpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
test('รูป: เก็บได้สูงสุด 4 ต่อรายการ · ไม่ใช่ JPEG/ใหญ่เกินถูกทิ้ง แต่ตัวหนังสืออยู่', () => {
  const s = parseReturnMaterials({ v: 1, items: [
    { name: 'เครื่องปรับอากาศเดิม', qty: '3', unit: 'ชุด', photos: [jpg, jpg, jpg, jpg, jpg, 'data:image/png;base64,AA', 'http://x/y.jpg', 'data:image/jpeg;base64,' + 'A'.repeat(RM_PHOTO_MAX_CHARS)] },
    { name: 'ตู้', qty: '', unit: '' },
  ] })
  assert.equal(s.items[0].photos.length, RM_LIMITS.photos)
  assert.equal(s.items[1].photos.length, 0)
  assert.equal(rmPhotoChars(s), jpg.length * 4)
})
test('ตัวตรวจ: โครงสร้างผิด = null · รูปรวมเกินเพดาน = null · compact ทิ้งแถวไม่มีชื่อ', () => {
  assert.equal(parseReturnMaterials({ v: 2, items: [] }), null)
  assert.equal(parseReturnMaterials({ v: 1, items: Array.from({ length: 31 }, () => ({ name: 'x' })) }), null)
  assert.equal(compactReturnMaterials(parseReturnMaterials({ v: 1, items: [{ name: ' ' }] })), null)
  const big = 'data:image/jpeg;base64,' + 'A'.repeat(RM_PHOTO_MAX_CHARS - 30)
  const many = Array.from({ length: 30 }, () => ({ name: 'x', photos: [big, big, big, big] }))
  assert.equal(parseReturnMaterials({ v: 1, items: many }), null)
})

test('แบ่งแผ่นตามความสูงรูป: รายการเยอะรูปขึ้นแผ่นใหม่ · ทุกรายการอยู่ในแผ่นใดแผ่นหนึ่งพอดี', async () => {
  const { rmPages } = await import('../../src/lib/return-materials.ts')
  const it = (n) => ({ name: 'x', qty: '', unit: '', photos: Array.from({ length: n }, () => 'p') })
  const items = [it(4), it(4), it(4), it(4), it(4), it(0), it(1)]
  const pages = rmPages(items)
  assert.ok(pages.length >= 2)
  assert.equal(pages[0][0], 0)
  assert.equal(pages[pages.length - 1][1], items.length)
  pages.forEach((p, i) => i && assert.equal(p[0], pages[i - 1][1]))
  assert.deepEqual(rmPages([]), [[0, 0]])
})
