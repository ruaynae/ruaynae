import { test } from 'node:test'
import assert from 'node:assert/strict'
import { itemSeries, isSplitItem, planReport } from '../../src/lib/boq/core.ts'
import { fillSplit, parsePlanInput, parseProgress, splitCount } from '../../src/lib/boq/plan-store.ts'
import {
  PW_ATTACHMENT, buildProgressWork, catSum, filledWeeks, hasPwItems, parseProgressWork, pwPages, pwRows, pwTotal, ratio,
} from '../../src/lib/progress-work.ts'

// แผนจำลอง (ไม่ใช่ BOQ จริงของลูกค้า) — R28 ค่าวัสดุ/ค่าแรงแยกกัน
const item = (name, mat, lab) => ({ code: '', name, qty: 1, unit: 'งาน', amount: mat + lab, mat, lab })
const plan = () => ({
  name: 'โครงการทดสอบ',
  project: { name: 'โครงการทดสอบ', owner: 'หน่วยงาน', loc1: 'ที่ตั้ง', loc2: '', code: '', total: 1000000, contractor: '', contractNo: '', contractDate: '', contractorRep: '' },
  factor: 1.3, vat: null,
  categories: [
    { name: 'หมวดงานพื้น', source: 'ปร.4', mult: 1.3, group: '', tasks: [
      { name: 'งานพื้น', amount: 600000, source: '', offset: 0, dur: 14, on: true, items: [
        item('กระเบื้อง', 400000, 100000), // แยกสองก้อน
        item('รื้อถอน', 0, 50000), // ค่าแรงล้วน
        item('บัว', 50000, 0), // ค่าวัสดุล้วน
      ] },
    ] },
  ],
  start: '2027-01-01', days: 28, periods: 1, w124: false, sourceFile: 'boq.xlsx',
})

test('isSplitItem: ต้องมีทั้งค่าวัสดุและค่าแรง', () => {
  const [a, b, c] = plan().categories[0].tasks[0].items
  assert.equal(isSplitItem(a), true)
  assert.equal(isSplitItem(b), false)
  assert.equal(isSplitItem(c), false)
  assert.equal(isSplitItem({ ...a, mat: undefined, lab: undefined }), false)
})

test('itemSeries: ค่าแรงที่ยังไม่เคยกรอก = เท่าค่าวัสดุสัปดาห์นั้น · กรอกแล้วยกต่อ · ถ่วงด้วยมูลค่า', () => {
  const it = plan().categories[0].tasks[0].items[0] // 400k / 100k
  const s = itemSeries(it, [0.5, null, 1, null], [null, 0.2, null, null], 4)
  assert.deepEqual(s.m, [0.5, 0.5, 1, 1])
  assert.deepEqual(s.l, [0.5, 0.2, 0.2, 0.2])
  assert.equal(s.eff[0], 0.5)
  assert.ok(Math.abs(s.eff[1] - (400000 * 0.5 + 100000 * 0.2) / 500000) < 1e-12)
  assert.ok(Math.abs(s.eff[3] - (400000 + 100000 * 0.2) / 500000) < 1e-12)
  // ไม่แยก = ช่องเดียวเหมือนเดิม
  const one = { ...it, mat: undefined, lab: undefined }
  assert.deepEqual(itemSeries(one, [0.3], [0.9], 2).eff, [0.3, 0.3])
})

test('planReport: แผนเก่า (ไม่มี lab) ได้ผลเท่าเดิม · กรอกค่าแรงแยกแล้วผลงานถ่วงมูลค่า', () => {
  const p = parsePlanInput(plan()).value
  const base = planReport({ ...p, progress: { items: { '0.0.0': [0.5], '0.0.1': [1], '0.0.2': [0] } } }, '2027-01-10')
  // (500k·0.5 + 50k·1 + 50k·0) / 600k
  assert.ok(Math.abs(base.installments[0].actual - 300000 / 600000) < 1e-12)
  const split = planReport({ ...p, progress: { items: { '0.0.0': [1], '0.0.1': [1], '0.0.2': [0] }, lab: { '0.0.0': [0] } } }, '2027-01-10')
  assert.ok(Math.abs(split.installments[0].actual - (400000 + 50000) / 600000) < 1e-12)
  // กรอกแค่ค่าแรงในสัปดาห์ 2 ก็นับเป็นสัปดาห์ที่กรอก
  const w2 = planReport({ ...p, progress: { items: { '0.0.0': [1] }, lab: { '0.0.0': [null, 0.5] } } }, '2027-01-20')
  assert.equal(w2.installments.length, 2)
})

test('parsePlanInput: เก็บ mat/lab เมื่อรวมกันเท่ายอด · ไม่ลงตัวถูกทิ้ง (ไม่ใช่ error)', () => {
  const p = plan()
  p.categories[0].tasks[0].items[2] = { ...p.categories[0].tasks[0].items[2], mat: 10, lab: 10 }
  const r = parsePlanInput(p)
  assert.equal(r.ok, true)
  const items = r.value.categories[0].tasks[0].items
  assert.equal(items[0].mat, 400000)
  assert.equal(items[0].lab, 100000)
  assert.equal(items[2].mat, undefined)
  assert.deepEqual(splitCount(r.value.categories), { total: 3, split: 2 })
})

test('parseProgress: lab ใช้กติกาเดียวกับ items · ค่านอก 0–1 ปฏิเสธ · lab ว่างไม่เก็บคีย์', () => {
  const p = parsePlanInput(plan()).value
  const ok = parseProgress({ weekly: true, items: { '0.0.0': [0.5] }, lab: { '0.0.0': [null, 0.25], 'x.y.z': [1] } }, p)
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.value.lab, { '0.0.0': [null, 0.25, null, null] })
  assert.equal(parseProgress({ weekly: true, items: {}, lab: { '0.0.0': [2] } }, p).error, 'PROGRESS_VALUE_INVALID')
  assert.equal(parseProgress({ weekly: true, items: { '0.0.0': [0.5] }, lab: {} }, p).value.lab, undefined)
})

test('fillSplit: เติมค่าวัสดุ/ค่าแรงให้แผนเดิมตามชื่อ+ยอด · ยอดรวมของรายการไม่เปลี่ยน', () => {
  const old = plan().categories.map((c) => ({ ...c, tasks: c.tasks.map((t) => ({ ...t, items: t.items.map(({ mat, lab, ...it }) => it) })) }))
  assert.deepEqual(splitCount(old), { total: 3, split: 0 })
  const r = fillSplit(old, plan().categories)
  assert.equal(r.filled, 3)
  const it = r.categories[0].tasks[0].items[0]
  assert.equal(it.mat, 400000)
  assert.equal(it.lab, 100000)
  assert.equal(it.amount, 500000)
  // ไฟล์ที่ไม่มีอะไรตรงเลย = ไม่เติม
  assert.equal(fillSplit(old, [{ name: 'x', source: '', mult: 1, group: '', tasks: [{ name: 'y', amount: 1, source: '', offset: 0, dur: 1, on: true, items: [item('อื่น', 1, 1)] }] }]).filled, 0)
})

test('buildProgressWork: % ค่าแรงล้วน/วัสดุล้วนลงช่องที่ถูก · ยอดรวมถ่วงมูลค่า ไม่ใช่ค่าเฉลี่ย', () => {
  const p = parsePlanInput(plan()).value
  const src = { id: 'p1', name: p.name, project: p.project, categories: p.categories, start: p.start, days: p.days,
    progress: { items: { '0.0.0': [1], '0.0.1': [0.5], '0.0.2': [0] }, lab: { '0.0.0': [0] } } }
  assert.deepEqual(filledWeeks(src.progress), [1])
  const pw = buildProgressWork(src, 1)
  const [tile, demo, trim] = pw.cats[0].tasks[0].items
  assert.deepEqual([tile.pm, tile.pl], [1, 0])
  assert.deepEqual([demo.pm, demo.pl], [0, 0.5])
  assert.deepEqual([trim.pm, trim.pl], [0, 0])
  assert.equal(pw.asOf, '2027-01-07')
  assert.equal(pw.unsplit, 0)
  const t = pwTotal(pw)
  assert.equal(t.matDone, 400000)
  assert.equal(t.labDone, 25000)
  assert.ok(Math.abs(t.value - 425000 * 1.3) < 1e-6)
  // ค่าเฉลี่ยธรรมดาของ % รายการ = (100+50+0)/3 = 50% · ถ่วงมูลค่า = 425k/600k
  assert.ok(Math.abs(ratio(catSum(pw.cats[0]).done, 600000) - 425000 / 600000) < 1e-12)
  assert.ok(Math.abs(ratio(t.value, pw.contract) - 0.5525) < 1e-12)
  assert.equal(hasPwItems(pw), true)
  // ผ่านตัวตรวจไป-กลับได้ค่าเดิม
  assert.deepEqual(parseProgressWork(JSON.parse(JSON.stringify(pw))), pw)
})

test('parseProgressWork: รูปร่างผิด/ค่าเกินช่วง = null', () => {
  assert.equal(parseProgressWork(null), null)
  assert.equal(parseProgressWork({ v: 2, cats: [] }), null)
  const base = { v: 1, planId: 'a', planName: '', project: '', location: '', owner: '', week: 1, asOf: '2027-01-07', contract: 1, unsplit: 0,
    cats: [{ name: 'c', mult: 1.3, tasks: [{ name: 't', items: [{ name: 'i', qty: 1, unit: 'u', mat: 1, lab: 0, pm: 1, pl: 0 }] }] }] }
  assert.ok(parseProgressWork(base))
  assert.equal(parseProgressWork({ ...base, week: 0 }), null)
  assert.equal(parseProgressWork({ ...base, asOf: '7/1/2027' }), null)
  const bad = structuredClone(base); bad.cats[0].tasks[0].items[0].pm = 1.5
  assert.equal(parseProgressWork(bad), null)
  assert.equal(hasPwItems(parseProgressWork({ ...base, cats: [] })), false)
})

test('pwRows/pwPages: ครบทุกแถว ไม่ซ้ำ · หัวหมวด/หัวงานไม่ค้างท้ายแผ่น', () => {
  const many = plan()
  many.categories[0].tasks[0].items = Array.from({ length: 80 }, (_, i) => item(`รายการที่ ${i + 1} `.repeat(4), 1000, 100))
  many.categories[0].tasks.push({ ...many.categories[0].tasks[0], name: 'งานที่สอง' })
  const p = parsePlanInput(many).value
  const pw = buildProgressWork({ id: 'p', name: 'x', project: p.project, categories: p.categories, start: p.start, days: p.days, progress: { items: {} } }, 1)
  const rows = pwRows(pw)
  const pages = pwPages(rows)
  assert.ok(pages.length > 1)
  assert.equal(pages[0][0], 0)
  assert.equal(pages[pages.length - 1][1], rows.length)
  for (let i = 1; i < pages.length; i += 1) assert.equal(pages[i][0], pages[i - 1][1])
  for (const [, to] of pages.slice(0, -1)) assert.ok(!['cat', 'task'].includes(rows[to - 1].k))
  assert.equal(rows[rows.length - 1].k, 'grand')
  assert.equal(PW_ATTACHMENT, 'แบบแสดงรายการ ปริมาณงาน และราคา ที่แล้วเสร็จ 1 ชุด')
})
