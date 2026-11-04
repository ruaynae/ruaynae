import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  compactMaterialApproval, contractFromRefs, emptyMaterialApproval, hasMaItems, maBodyLines, maCell, maLine, maStyleOf,
  moveMaItem, parseMaterialApproval, stripProjectWord, MA_UNSPECIFIED, MA_AUTO, MA_AUTO_MAX_INLINE, maListRows,
} from '../../src/lib/material-approval.ts'

const it = (name, detail = '', extra = {}) => ({ name, drawing: '', boq: '', spec: '', detail, note: 'ตรงตามแบบรูปรายการ', ...extra })

test('ข้อในเนื้อหา = รายการ + รายละเอียด (แบบ agro009)', () => {
  assert.equal(maLine(it('ตู้โหลดเซ็นเตอร์ 50A', 'ยี่ห้อ CHANG รุ่น MV-18')), 'ตู้โหลดเซ็นเตอร์ 50A ยี่ห้อ CHANG รุ่น MV-18')
  assert.equal(maLine(it('ปูนก่อผนัง', '- เสือ มอร์ตาร์ ก่อทั่วไป')), 'ปูนก่อผนัง เสือ มอร์ตาร์ ก่อทั่วไป')
  assert.equal(maLine(it('', 'สวิตช์ 2 ทาง ยี่ห้อ CHANG')), 'สวิตช์ 2 ทาง ยี่ห้อ CHANG')
  assert.equal(maLine(it('โคม', 'โคมติดผนัง 2 ทิศทาง')), 'โคมติดผนัง 2 ทิศทาง')
  assert.equal(maLine(it('กระจก', 'หนา 6+0.38+6 มม.\nหนา 4+0.38+4 มม.')), 'กระจก หนา 6+0.38+6 มม. หนา 4+0.38+4 มม.')
})

test('เนื้อหาไม่มีรายการ = ข้อเดียวเป็นจุดไข่ปลา · แถวว่างถูกข้าม', () => {
  assert.deepEqual(maBodyLines(null, '…'), ['1. …'])
  const ma = { v: 1, project: '', contract: '', items: [it('A', 'x'), it('', ''), it('B')] }
  assert.deepEqual(maBodyLines(ma, '…'), ['1. A x', '2. B'])
  assert.equal(hasMaItems(ma), true)
  assert.equal(hasMaItems(emptyMaterialApproval()), false)
})

test('รูปแบบหนังสือ: ค่าเก่าที่ไม่มีช่องนี้ = แนบตาราง', () => {
  assert.equal(maStyleOf(undefined), 'table')
  assert.equal(maStyleOf('แนบตาราง'), 'table')
  assert.equal(maStyleOf('ระบุในเนื้อหา'), 'inline')
})

test('รูปแบบอัตโนมัติ: ไม่เกินเพดาน = ระบุในเนื้อหา · เกิน = แนบตาราง · เลือกเองชนะอัตโนมัติ', () => {
  assert.equal(maStyleOf(MA_AUTO, 0), 'inline')
  assert.equal(maStyleOf(MA_AUTO, MA_AUTO_MAX_INLINE), 'inline')
  // เกินเพดาน = แนบรายการ (ตาราง 3 คอลัมน์) — ไม่เคยเลือกตาราง 7 คอลัมน์ให้เอง (เจ้าของสั่ง 4 พ.ย. 2569)
  assert.equal(maStyleOf(MA_AUTO, MA_AUTO_MAX_INLINE + 1), 'list')
  assert.equal(maStyleOf(MA_AUTO, 100), 'list')
  assert.equal(maStyleOf('แนบรายการ', 1), 'list')
  assert.equal(maStyleOf('แนบตาราง', 1), 'table')
  assert.equal(maStyleOf('แนบตาราง', 100), 'table')
  assert.equal(maStyleOf('ระบุในเนื้อหา', 50), 'inline')
  // หนังสือเก่าก่อน R26 (ไม่มีช่อง) ยังเป็นแนบตาราง ไม่ว่ากี่รายการ
  assert.equal(maStyleOf(undefined, 1), 'table')
})

test('แนบรายการ: แถว = ชื่อ + รายละเอียด · ตัดขีดนำหน้า/หลายบรรทัด · ว่าง = "-" · แถวว่างไม่นับ', () => {
  const rows = maListRows({ v: 1, project: '', contract: '', items: [
    it('ลามิเนตปิดผิว', 'Formica 0869NT'),
    it('- ตู้โหลดเซ็นเตอร์ 50A', 'ยี่ห้อ CHANG\nรุ่น MV-18'),
    it('ไม้โครงจ๊อยสัก', ''),
    it('', ''),
  ] })
  assert.deepEqual(rows, [
    { name: 'ลามิเนตปิดผิว', detail: 'Formica 0869NT' },
    { name: 'ตู้โหลดเซ็นเตอร์ 50A', detail: 'ยี่ห้อ CHANG รุ่น MV-18' },
    { name: 'ไม้โครงจ๊อยสัก', detail: '-' },
  ])
  assert.deepEqual(maListRows(null), [])
})

test('สัญญาจ้างจากบรรทัดอ้างถึง', () => {
  assert.equal(contractFromRefs(['สัญญาจ้างเลขที่ 5/2569 ลงวันที่ 16 มิถุนายน 2569']), '5/2569 ลงวันที่ 16 มิถุนายน 2569')
  assert.equal(contractFromRefs(['หนังสือที่ อว 1', '1. สัญญาจ้างเลขที่ 17/2569 ลงวันที่ 7 มกราคม 2569']), '17/2569 ลงวันที่ 7 มกราคม 2569')
  assert.equal(contractFromRefs(['หนังสือที่ อว 1']), '')
})

test('ช่องว่างในตาราง = "- ไม่ระบุ" · ชื่อโครงการตัดคำว่าโครงการ', () => {
  assert.equal(maCell('  '), MA_UNSPECIFIED)
  assert.equal(maCell('WEBER'), 'WEBER')
  assert.equal(stripProjectWord('โครงการ ปรับปรุงอาคาร'), 'ปรับปรุงอาคาร')
  assert.equal(emptyMaterialApproval('โครงการปรับปรุง').project, 'ปรับปรุง')
})

test('ตัวตรวจ: รูปผิด = null · ตัดความยาว · ค่าที่ไม่ใช่ข้อความ = ว่าง · เก็บแต่แถวที่กรอก', () => {
  assert.equal(parseMaterialApproval(null), null)
  assert.equal(parseMaterialApproval([]), null)
  assert.equal(parseMaterialApproval({ items: 'x' }), null)
  const p = parseMaterialApproval({ project: 'P', items: [{ name: 'A'.repeat(500), note: 5 }, null, { detail: 'd' }, {}] })
  assert.equal(p.items.length, 3)
  assert.equal(p.items[0].name.length, 300)
  assert.equal(p.items[0].note, '')
  assert.equal(p.contract, '')
  const c = compactMaterialApproval(p)
  assert.equal(c.items.length, 2)
  assert.equal(compactMaterialApproval({ v: 1, project: '', contract: '', items: [it('')] }), null)
  assert.equal(parseMaterialApproval({ items: Array.from({ length: 150 }, () => it('x')) }).items.length, 100)
})

test('ย้ายแถว · นอกขอบไม่เปลี่ยน', () => {
  const a = [it('1'), it('2'), it('3')]
  assert.deepEqual(moveMaItem(a, 0, 1).map((x) => x.name), ['2', '1', '3'])
  assert.deepEqual(moveMaItem(a, 0, -1).map((x) => x.name), ['1', '2', '3'])
  assert.deepEqual(moveMaItem(a, 2, 1).map((x) => x.name), ['1', '2', '3'])
})

test('แบ่งแผ่นตาราง: 10 แถวสั้นอยู่แผ่นเดียว · แถวยาวขึ้นแผ่นใหม่ · ช่วงต่อกันครบ', async () => {
  const { maPages, maRowHeight, MA_PAGE_BUDGET } = await import('../../src/lib/material-approval.ts')
  const short = Array.from({ length: 10 }, (_, i) => it(`วัสดุ ${i}`, 'ยี่ห้อ A'))
  assert.deepEqual(maPages(short), [[0, 10]])
  assert.deepEqual(maPages([]), [])
  const tall = it('x', Array.from({ length: 30 }, () => 'บรรทัด').join('\n'))
  assert.ok(maRowHeight(tall) > MA_PAGE_BUDGET)
  assert.deepEqual(maPages([tall]), [[0, 1]])
  const many = Array.from({ length: 40 }, (_, i) => it(`วัสดุ ${i}`, 'ยี่ห้อ A\nรุ่น B'))
  const pages = maPages(many)
  assert.ok(pages.length > 1)
  assert.equal(pages[0][0], 0)
  assert.equal(pages.at(-1)[1], 40)
  for (let i = 1; i < pages.length; i++) assert.equal(pages[i][0], pages[i - 1][1])
  for (const [a, b] of pages) assert.ok(many.slice(a, b).reduce((s, x) => s + maRowHeight(x), 0) <= MA_PAGE_BUDGET)
})
