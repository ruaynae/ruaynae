import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDomesticSummary, dsRate, dsPass, dsTotal, parseDomesticSummary, hasDomesticSummary } from '../../src/lib/domestic-summary.ts'

const it = (id, qty, price, o = {}) => ({ kind: 'item', id, code: '1', name: id, qty, unit: 'ชิ้น', price, steel: false, foreign: false, ...o })
const model = { project: 'P', sheets: [{ sheet: 'A', rows: [{ kind: 'head', code: '', name: 'h' }, it('a', 2, 100), it('b', 1, 100, { foreign: true }), it('s', 10, 50, { steel: true })] }] }

test('พัสดุ = ทุกรายการ · เหล็ก = เฉพาะที่ติ๊ก · นำเข้านับเป็นต่างประเทศ', () => {
  const s = buildDomesticSummary(model, { planId: 'x', planName: 'n' })
  assert.deepEqual(s.material, { count: 3, domestic: 700, foreign: 100 })
  assert.deepEqual(s.steel, { count: 1, domestic: 500, foreign: 0 })
  assert.equal(dsTotal(s.material), 800)
  assert.equal(dsRate(s.material), 0.875)
  assert.equal(dsPass(s.material, 0.6), true)
  assert.equal(dsPass(s.material, 0.9), false)
})
test('ไม่มีเหล็ก = steel null · ตัวตรวจปฏิเสธโครงสร้างผิด', () => {
  const s = buildDomesticSummary({ project: 'P', sheets: [{ sheet: 'A', rows: [it('a', 1, 10)] }] }, { planId: 'x', planName: 'n' })
  assert.equal(s.steel, null)
  assert.equal(parseDomesticSummary({ v: 1, material: { count: 1, domestic: -1, foreign: 0 } }), null)
  assert.equal(hasDomesticSummary(parseDomesticSummary(s)), true)
  assert.equal(hasDomesticSummary(null), false)
})

test('ผ่านทั้งโครงการ: พัสดุ ≥ 60% และเหล็ก (ถ้ามี) ≥ 90%', async () => {
  const { dsOverallPass } = await import('../../src/lib/domestic-summary.ts')
  const base = { v: 1, planId: '', planName: '', project: '' }
  assert.equal(dsOverallPass({ ...base, material: { count: 1, domestic: 70, foreign: 30 }, steel: null }), true)
  assert.equal(dsOverallPass({ ...base, material: { count: 1, domestic: 50, foreign: 50 }, steel: null }), false)
  assert.equal(dsOverallPass({ ...base, material: { count: 1, domestic: 100, foreign: 0 }, steel: { count: 1, domestic: 80, foreign: 20 } }), false)
})
