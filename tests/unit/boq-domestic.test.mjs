import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyMarks, extractDomestic, isSteel, itemsOf, totals } from '../../src/lib/boq/domestic.ts'

// ชีตรายละเอียดจำลอง (ไม่ใช่ BOQ จริงของลูกค้า) — ก้อนสรุปหัวชีต แล้วตามด้วยส่วนรายละเอียด
const sheet = (name, rows) => {
  const v = (r, c) => rows[r]?.[c] ?? null
  return { name, rows: rows.length, cols: 10, v, w: (r, c) => String(v(r, c) ?? '').replace(/\s+/g, ' ').trim() }
}
const H = ['ลำดับที่', 'รายการ', 'จำนวน', 'หน่วย', 'ราคาค่าวัสดุ', null, 'ราคาค่าแรง', null, 'รวมค่าวัสดุและแรงงาน']
const g = sheet('1 งานทดสอบ', [
  ['แบบแสดงรายการ ปริมาณงาน และราคา'],
  H,
  [null, null, null, null, 'ราคา/หน่วย', 'รวม', 'ราคา/หน่วย', 'รวม'],
  [1, 'หมวดงานทดสอบ'],
  [1.1, 'งานรื้อถอน', 1, 'งาน', 0, 0, 500, 500, 500],
  [1.2, 'งานพื้น', 1, 'งาน', 1000, 1000, 200, 200, 1200],
  [null, 'รวมหมวดงานทดสอบ', null, null, null, 1000, null, 700, 1700],
  [1, 'หมวดงานทดสอบ'],
  [1.1, 'งานรื้อถอน'],
  [null, ' - รื้อพื้นเดิม', 10, 'ตร.ม.', 0, 0, 50, 500, 500],
  [null, 'รวมงานรื้อถอน', null, null, null, 0, null, 500, 500],
  [1.2, 'งานพื้น'],
  [null, ' - ปูกระเบื้อง', 10, 'ตร.ม.', 60, 600, 20, 200, 800],
  [null, '     - กาวยาแนว', null, null, 5],
  [null, ' - เหล็กเสริม SD40 DB12', 20, 'กก.', 20, 400, 0, 0, 400],
  [null, ' - ค่าแรงขัดพื้น', 10, 'ตร.ม.', 0, 0, 10, 100, 100],
  [null, '   รายละเอียดค่าแรงที่ต้องตัดทิ้ง'],
  [null, 'รวมงานพื้น', null, null, null, 1000, null, 300, 1300],
  [null, 'หมายเหตุ ท้ายชีต'],
])

test('อ่านเฉพาะส่วนรายละเอียด · ตัดหัวข้อที่ไม่มีค่าวัสดุ · ตัดรายการค่าแรงล้วนพร้อมบรรทัดต่อท้าย', () => {
  const m = extractDomestic([g, sheet('เทียบราคา', [H])], ['ปร.5(ก) → 1 งานทดสอบ'], 'โครงการทดสอบ')
  assert.equal(m.sheets.length, 1)
  const rows = m.sheets[0].rows
  assert.deepEqual(rows.map((r) => r.kind), ['head', 'head', 'item', 'text', 'item', 'sum'])
  assert.deepEqual(rows.filter((r) => r.kind === 'head').map((r) => r.code), ['1', '1.2'])
  const t = totals(itemsOf(m))
  assert.deepEqual(t, { count: 2, total: 1000, domestic: 1000, foreign: 0 })
})

test('เหล็ก: เหล็กเสริม/ข้ออ้อย/มอก.107 ใช่ · โครงคร่าวเหล็กชุบสังกะสีกับทาสีเหล็กไม่ใช่', () => {
  assert.equal(isSteel(' - เหล็กเสริม SD40 DB12'), true)
  assert.equal(isSteel('ท่อเหล็กกลวงสี่เหลี่ยมจัตุรัส (มอก.107) หนา 50x50 mm.'), true)
  assert.equal(isSteel('ไวร์เมช 4 มม.'), true)
  assert.equal(isSteel('ฝ้ายิปซัม โครงคร่าวเหล็กชุบสังกะสี หนา 0.52 มม.'), false)
  assert.equal(isSteel(' - ทาสีเหล็กกันสนิม'), false)
  const m = extractDomestic([g], ['1 งานทดสอบ'], '')
  assert.deepEqual(itemsOf(m).filter((i) => i.steel).map((i) => i.qty), [20])
})

test('ติ๊กนำเข้า → ย้ายมูลค่าไปพัสดุต่างประเทศ · ไม่แก้โมเดลเดิม', () => {
  const m = extractDomestic([g], ['1 งานทดสอบ'], '')
  const steel = itemsOf(m).find((i) => i.steel)
  const m2 = applyMarks(m, { [steel.id]: { foreign: true } })
  assert.deepEqual(totals(itemsOf(m2)), { count: 2, total: 1000, domestic: 600, foreign: 400 })
  assert.equal(totals(itemsOf(m)).foreign, 0)
})

test('หัวข้อย่อยไม่มีเลขที่มีแต่ค่าแรงถูกตัด · ป้ายกลุ่มเหนือหัวข้อมีเลขและคำอธิบายย่อหน้ายังอยู่', () => {
  const g2 = sheet('2 งานทดสอบ', [
    H,
    [null, null, null, null, 'ราคา/หน่วย', 'รวม', 'ราคา/หน่วย', 'รวม'],
    [null, 'กลุ่มงานสถาปัตยกรรม'],
    [2, 'งานประตู-หน้าต่าง'],
    [null, 'งานประตู'],
    [null, ' - D1 ประตูบานเปิด', 2, 'ชุด', 100, 200, 10, 20, 220],
    [null, '   วงกบอลูมิเนียม หนา 2 มม.'],
    [null, 'งานรื้อประตูเดิม'],
    [null, ' - รื้อประตูเดิม', 2, 'ชุด', 0, 0, 30, 60, 60],
    [null, 'งานหน้าต่าง'],
    [null, ' - W1 หน้าต่าง', 1, 'ชุด', 300, 300, 10, 10, 310],
    [null, 'งานย้ายเครื่องปรับอากาศ'],
    [null, ' - ย้ายเครื่องปรับอากาศ', 1, 'ชุด', 0, 0, 900, 900, 900],
    [null, 'รวมงานประตู-หน้าต่าง', null, null, null, 500, null, 990, 1490],
  ])
  const rows = extractDomestic([g2], ['2 งานทดสอบ'], '').sheets[0].rows
  assert.deepEqual(
    rows.map((r) => (r.kind === 'item' ? 'item' : `${r.kind}:${r.name.trim()}`)),
    ['head:งานประตู-หน้าต่าง', 'text:งานประตู', 'item', 'text:วงกบอลูมิเนียม หนา 2 มม.', 'text:งานหน้าต่าง', 'item', 'sum:รวมงานประตู-หน้าต่าง'],
  )
})
