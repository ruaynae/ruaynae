import { test } from 'node:test'
import assert from 'node:assert/strict'
import { domesticFromRow, parseDomModel, parseDomName } from '../../src/lib/boq/domestic-store.ts'

// โมเดลจำลอง (ไม่ใช่ BOQ จริงของลูกค้า)
const item = (id, extra = {}) => ({ kind: 'item', id, code: '', name: ' - ปูกระเบื้อง', qty: 10, unit: 'ตร.ม.', price: 60, steel: false, foreign: false, ...extra })
const model = {
  project: 'โครงการทดสอบ',
  sheets: [{
    sheet: '1 งานทดสอบ',
    rows: [
      { kind: 'head', code: '1', name: 'งานพื้น' },
      item('1 งานทดสอบ#5', { foreign: true }),
      { kind: 'text', name: '   - กาวยาแนว', price: 5 },
      { kind: 'text', name: 'งานหน้าต่าง', price: null, sub: true },
      item('1 งานทดสอบ#9', { steel: true, name: ' - เหล็กเสริม' }),
      { kind: 'sum', name: 'รวมงานพื้น' },
    ],
  }],
}

test('โมเดลที่ถูกต้องผ่าน และธงเหล็ก/นำเข้าที่ติ๊กไว้ไม่หาย (ไปกลับฐานข้อมูลได้ค่าเดิม)', () => {
  const r = parseDomModel(model)
  assert.equal(r.ok, true)
  assert.deepEqual(r.value, model)
  const row = domesticFromRow({ id: 'x', name: 'แผน', site_id: null, source_file: 'boq.xlsx', model, updated_at: '2026-10-27T00:00:00Z' })
  assert.deepEqual(row.model.sheets[0].rows.filter((x) => x.kind === 'item').map((x) => [x.steel, x.foreign]), [[false, true], [true, false]])
})

test('ปฏิเสธ: ไม่มีรายการ · id ซ้ำ · ราคา/จำนวนติดลบ · ชนิดแถวแปลก · ชื่อว่าง', () => {
  assert.equal(parseDomModel({ project: '', sheets: [{ sheet: 'a', rows: [{ kind: 'head', code: '1', name: 'x' }] }] }).error, 'DOMESTIC_MODEL_EMPTY')
  assert.equal(parseDomModel({ sheets: [{ sheet: 'a', rows: [item('a#1'), item('a#1')] }] }).error, 'DOMESTIC_MODEL_INVALID')
  assert.equal(parseDomModel({ sheets: [{ sheet: 'a', rows: [item('a#1', { price: -1 })] }] }).error, 'DOMESTIC_MODEL_INVALID')
  assert.equal(parseDomModel({ sheets: [{ sheet: 'a', rows: [item('a#1', { qty: 'x' })] }] }).error, 'DOMESTIC_MODEL_INVALID')
  assert.equal(parseDomModel({ sheets: [{ sheet: 'a', rows: [{ kind: 'evil' }] }] }).error, 'DOMESTIC_MODEL_INVALID')
  assert.equal(parseDomModel(null).error, 'DOMESTIC_MODEL_INVALID')
  assert.equal(parseDomName('   ').error, 'DOMESTIC_NAME_REQUIRED')
  assert.equal(parseDomName('  แผน A ').value, 'แผน A')
  assert.equal(domesticFromRow({ id: 'x', updated_at: 't', model: { sheets: 'no' } }), null)
})
