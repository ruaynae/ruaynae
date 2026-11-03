import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CATALOG_LIMITS, appendCatalogPhotos, catalogToRow, isCatalogKey, isSharedKey, mergeCatalogRows, parseCatalogMeta, LETTER_PHOTO_KEY,
} from '../../src/lib/material-library.ts'

const U = '123e4567-e89b-12d3-a456-426614174000'

test('ตัวตรวจข้อมูลวัสดุ: ต้องมีชื่อ · ตัดช่องว่างซ้ำ · ตัดความยาว', () => {
  assert.deepEqual(parseCatalogMeta(null), { ok: false, error: 'CATALOG_NAME_REQUIRED' })
  assert.deepEqual(parseCatalogMeta({ name: '   ' }), { ok: false, error: 'CATALOG_NAME_REQUIRED' })
  assert.deepEqual(parseCatalogMeta({ name: 'x'.repeat(201) }), { ok: false, error: 'CATALOG_NAME_TOO_LONG' })
  const r = parseCatalogMeta({ name: '  ปูน   ก่อ ', category: 'ปูน', detail: 'd'.repeat(500), note: 5 })
  assert.equal(r.ok, true)
  assert.equal(r.value.name, 'ปูน ก่อ')
  assert.equal(r.value.detail.length, CATALOG_LIMITS.detail)
  assert.equal(r.value.note, '')
})

test('คีย์ไฟล์: catalog/ และ letters/ ถูกต้อง · ที่อื่นไม่ผ่าน · catalog เป็นของคลัง', () => {
  assert.equal(isCatalogKey(`catalog/${U}.jpg`), true)
  assert.equal(isCatalogKey(`letters/${U}.jpg`), false)
  assert.equal(isCatalogKey(`catalog/../${U}.jpg`), false)
  assert.equal(LETTER_PHOTO_KEY.test(`letters/${U}.png`), true)
  assert.equal(LETTER_PHOTO_KEY.test(`catalog/${U}.webp`), true)
  assert.equal(LETTER_PHOTO_KEY.test(`files/${U}.jpg`), false)
  assert.equal(isSharedKey(`catalog/${U}.jpg`), true)
  assert.equal(isSharedKey(`letters/${U}.jpg`), false)
})

test('วัสดุ → แถวรายการ: ช่องที่ขึ้นกับโครงการว่าง', () => {
  assert.deepEqual(catalogToRow({ name: 'ปูนก่อ', detail: 'เสือ มอร์ตาร์', note: 'ขออนุมัติใช้' }),
    { name: 'ปูนก่อ', drawing: '', boq: '', spec: '', detail: 'เสือ มอร์ตาร์', note: 'ขออนุมัติใช้' })
})

test('เติมวัสดุลงรายการ: แทนแถวว่าง · ไม่ซ้ำ · เคารพเพดาน', () => {
  const make = (p) => ({ ...catalogToRow(p) })
  const blank = [{ name: '', drawing: '', boq: '', spec: '', detail: '', note: 'ตรงตามแบบรูปรายการ' }]
  const a = mergeCatalogRows(blank, [{ name: 'A', detail: '1' }, { name: 'B', detail: '2' }], make, 100)
  assert.equal(a.rows.length, 2)
  assert.deepEqual([a.added, a.skipped], [2, 0])
  const b = mergeCatalogRows(a.rows, [{ name: 'A', detail: '1' }, { name: 'C', detail: '3' }], make, 100)
  assert.deepEqual(b.rows.map((r) => r.name), ['A', 'B', 'C'])
  assert.deepEqual([b.added, b.skipped], [1, 1])
  const c = mergeCatalogRows(a.rows, [{ name: 'X', detail: '' }, { name: 'Y', detail: '' }], make, 3)
  assert.equal(c.rows.length, 3)
  assert.deepEqual([c.added, c.skipped], [1, 1])
  // ไม่เลือกอะไรเลย = รายการเดิม (แถวว่างไม่หาย)
  assert.equal(mergeCatalogRows(blank, [], make, 100).rows.length, 1)
})

test('ต่อหน้าแค็ตตาล็อก: ข้ามคีย์ที่มีอยู่ · ไม่เกินเพดาน', () => {
  const ph = (k) => ({ key: k, url: '', caption: '' })
  const cur = [ph('a'), { url: 'blob:x', caption: '' }]
  const r = appendCatalogPhotos(cur, [ph('a'), ph('b'), ph('c')], 4)
  assert.deepEqual(r.photos.map((p) => p.key), ['a', undefined, 'b', 'c'])
  assert.deepEqual([r.added, r.skipped], [2, 1])
  const r2 = appendCatalogPhotos(r.photos, [ph('d')], 4)
  assert.deepEqual([r2.added, r2.skipped, r2.photos.length], [0, 1, 4])
})
