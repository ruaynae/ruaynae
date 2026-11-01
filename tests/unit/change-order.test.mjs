import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  blockTotals, coTotals, emptyChangeOrder, hasItems, itemFromBoq, itemTotals, moveRow, num, parseChangeOrder,
} from '../../src/lib/change-order.ts'

const item = (text, qty, mat, lab = null) => ({ t: 'item', text, qty, unit: 'ชุด', mat, lab, note: '' })

test('งานลดตามตารางแบบที่ 2 ของเจ้าของ: รวม 797,165.62 · F 241,302.03 · รวมทั้งหมด 1,038,467.65', () => {
  const cut = {
    title: 'งานลด',
    rows: [
      { t: 'group', no: '1.6', text: 'งานตกแต่งภายใน' },
      { t: 'head', text: 'Built In ตู้เตี้ยเก็บเอกสาร : B-01' },
      item('ตู้เก็บเอกสาร 0.60x3.50x0.90', 6, 78505.3367),
      { t: 'head', text: 'Built In ตู้เตี้ยเก็บเอกสาร : B-02' },
      item('ตู้เก็บเอกสาร 0.60x3.50x0.90', 3, 74019.3167),
      item('ตู้ B-03', null, 71058.54),
      item('ตู้ B-09', 0, 43962.99),
      item('ตู้ B-12', 1, 104075.65),
    ],
  }
  const t = blockTotals(cut, 1.3027)
  assert.equal(t.items, 5)
  assert.equal(t.sum, 797165.62)
  assert.equal(t.fSum, 241302.03)
  assert.equal(t.total, 1038467.65)
  assert.equal(t.lab, 0)
})

test('ส่วนต่างและใบปะหน้า: งานเพิ่มมากกว่า = งานเพิ่ม ยอดบวก', () => {
  const co = emptyChangeOrder()
  co.cut.rows = [item('ตู้สูง B-04 (สัญญา)', 2.3375, 14681.52)]
  co.add.rows = [item('ตู้สูง B-04 (แบบใหม่)', 2.53, 14681.52)]
  const t = coTotals(co)
  assert.equal(t.cut.sum, 34318.05)
  assert.equal(t.add.sum, 37144.25)
  // Factor F คิดแยกบล็อก (แบบที่ 2) — ต่างจากแบบที่ 1 (คูณส่วนต่างครั้งเดียว = 3,681.68) ได้ 1 สตางค์
  assert.equal(t.cut.total, 44706.12)
  assert.equal(t.add.total, 48387.81)
  assert.equal(t.diff, 3681.69)
  assert.equal(t.kind, 'งานเพิ่ม')
  assert.equal(t.amount, 3681.69)
})

test('งานลดมากกว่า = งานลด ยอดบนใบปะหน้าเป็นบวก · ไม่มีรายการ = ไม่มีประเภท', () => {
  const co = emptyChangeOrder({ factor: 1.07 })
  assert.equal(coTotals(co).kind, null)
  co.cut.rows = [item('Access Control', 3, 25000, 2000)]
  const t = coTotals(co)
  assert.equal(t.cut.mat, 75000)
  assert.equal(t.cut.lab, 6000)
  assert.equal(t.cut.fSum, 5670)
  assert.equal(t.diff, -86670)
  assert.equal(t.kind, 'งานลด')
  assert.equal(t.amount, 86670)
  assert.ok(hasItems(co))
})

test('ยอดต่อแถวปัดทีละช่อง (วัสดุ/แรง) ก่อนรวม', () => {
  assert.deepEqual(itemTotals(item('x', 2.335, 10.005, 1.111)), { mat: 23.36, lab: 2.59, total: 25.95 })
  assert.deepEqual(itemTotals(item('x', null, 100)), { mat: 0, lab: 0, total: 0 })
})

test('ตัวตรวจ: รูปร่างผิดไม่พัง · ตัวเลขติดลบ/ข้อความทิ้ง · F < 1 ใช้ค่าตั้งต้น', () => {
  assert.equal(parseChangeOrder(null), null)
  assert.equal(parseChangeOrder([1]), null)
  const co = parseChangeOrder({
    project: '  โครงการ   ทดสอบ ', factor: 0.5,
    cut: { rows: [{ t: 'item', text: 'a', qty: '1,200.5', mat: '-3', lab: 'abc' }, { t: 'bogus' }, 7] },
    add: 'x',
  })
  assert.equal(co.project, 'โครงการ ทดสอบ')
  assert.equal(co.factor, 1.3027)
  assert.equal(co.cut.title, 'งานลด')
  assert.equal(co.cut.rows.length, 1)
  assert.deepEqual(co.cut.rows[0], { t: 'item', text: 'a', qty: 1200.5, unit: '', mat: null, lab: null, note: '' })
  assert.deepEqual(co.add, { title: 'งานเพิ่ม', rows: [] })
  assert.equal(num('12.345678'), 12.3457)
  assert.equal(num(''), null)
})

test('รายการจาก BOQ: ราคาต่อหน่วย = ค่างาน ÷ จำนวน · ไม่มีจำนวน = 1 งาน', () => {
  assert.deepEqual(itemFromBoq({ code: '1.1', name: 'ตู้', qty: 6, unit: 'ชุด', amount: 471032.04 }),
    { t: 'item', text: 'ตู้', qty: 6, unit: 'ชุด', mat: 78505.34, lab: null, note: '' })
  assert.deepEqual(itemFromBoq({ code: '', name: 'งานระบบ', qty: null, unit: '', amount: 5000 }),
    { t: 'item', text: 'งานระบบ', qty: 1, unit: 'งาน', mat: 5000, lab: null, note: '' })
})

test('ย้ายแถว: ขอบบน/ล่างไม่ขยับ · ไม่แก้ของเดิม', () => {
  const a = [1, 2, 3]
  assert.deepEqual(moveRow(a, 0, -1), [1, 2, 3])
  assert.deepEqual(moveRow(a, 1, -1), [2, 1, 3])
  assert.deepEqual(moveRow(a, 1, 1), [1, 3, 2])
  assert.deepEqual(a, [1, 2, 3])
})

test('ใบปะหน้าแบบ "งานเพิ่ม / งานลด" มีสิ่งที่ส่งมาด้วยตรงกับชื่อตาราง', async () => {
  const { LETTER_TEMPLATES } = await import('../../src/lib/letter-templates.ts')
  const { CO_ATTACHMENT } = await import('../../src/lib/change-order.ts')
  assert.deepEqual(LETTER_TEMPLATES.find((t) => t.id === 'change').atts, [CO_ATTACHMENT])
})
