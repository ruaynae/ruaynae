import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planReport } from '../../src/lib/boq/core.ts'
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

test('planReport: % ช่องเดียวต่อรายการ (แยก/ไม่แยกค่าวัสดุ/ค่าแรง ได้ผลเท่ากัน) · ถ่วงด้วยมูลค่า', () => {
  const p = parsePlanInput(plan()).value
  const r = planReport({ ...p, progress: { items: { '0.0.0': [0.5], '0.0.1': [1], '0.0.2': [0] } } }, '2027-01-10')
  // (500k·0.5 + 50k·1 + 50k·0) / 600k
  assert.ok(Math.abs(r.installments[0].actual - 300000 / 600000) < 1e-12)
})

test('parseProgress: ไม่มีช่อง % ค่าแรงแยก (คีย์ lab ถูกทิ้ง)', () => {
  const p = parsePlanInput(plan()).value
  const r = parseProgress({ weekly: true, items: { '0.0.0': [0.5] }, lab: { '0.0.0': [0.2] } }, p)
  assert.equal(r.ok, true)
  assert.equal(r.value.lab, undefined)
  assert.deepEqual(r.value.items['0.0.0'], [0.5, null, null, null])
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

test('buildProgressWork: % เดียวใช้กับค่าวัสดุและค่าแรง · ก้อนที่เป็น 0 ไม่มี % · ยอดรวมถ่วงมูลค่า ไม่ใช่ค่าเฉลี่ย', () => {
  const p = parsePlanInput(plan()).value
  const src = { id: 'p1', name: p.name, project: p.project, categories: p.categories, start: p.start, days: p.days,
    progress: { items: { '0.0.0': [1], '0.0.1': [0.5], '0.0.2': [0] } } }
  assert.deepEqual(filledWeeks(src.progress), [1])
  const pw = buildProgressWork(src, 1)
  const [tile, demo, trim] = pw.cats[0].tasks[0].items
  assert.deepEqual([tile.pm, tile.pl], [1, 1])
  assert.deepEqual([demo.pm, demo.pl], [0, 0.5])
  assert.deepEqual([trim.pm, trim.pl], [0, 0])
  assert.equal(pw.asOf, '2027-01-07')
  // วันส่งงวดแก้ได้ (เก็บใน asOf) · ไม่กระทบสัปดาห์ที่ดึง %
  const edited = parseProgressWork({ ...JSON.parse(JSON.stringify(pw)), asOf: '2027-02-20' })
  assert.equal(edited.asOf, '2027-02-20')
  assert.equal(edited.week, 1)
  assert.equal(edited.planStart, p.start)
  assert.equal(pw.unsplit, 0)
  const t = pwTotal(pw)
  assert.equal(t.matDone, 400000)
  assert.equal(t.labDone, 125000)
  assert.ok(Math.abs(t.value - 525000 * 1.3) < 1e-6)
  // ค่าเฉลี่ยธรรมดาของ % รายการ = (100+50+0)/3 = 50% · ถ่วงมูลค่า = 525k/600k
  assert.ok(Math.abs(ratio(catSum(pw.cats[0]).done, 600000) - 525000 / 600000) < 1e-12)
  assert.ok(Math.abs(ratio(t.value, pw.contract) - 0.6825) < 1e-12)
  assert.equal(hasPwItems(pw), true)
  // ผ่านตัวตรวจไป-กลับได้ค่าเดิม
  assert.deepEqual(parseProgressWork(JSON.parse(JSON.stringify(pw))), pw)
  // แผนเก่าไม่แยก = ลงช่องค่าวัสดุทั้งก้อน
  const old = buildProgressWork({ ...src, categories: fillSplit(src.categories, []).categories.map((c) => ({ ...c, tasks: c.tasks.map((t) => ({ ...t, items: t.items.map(({ mat, lab, ...it }) => it) })) })) }, 1)
  assert.equal(old.unsplit, 3)
  assert.equal(old.cats[0].tasks[0].items[0].mat, 500000)
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

test('rebaseSchedule (R28b): ย้ายวันแผนตามโครงการ · ผลงานย้ายตามวันที่จริง ไม่ใช่เลข W', async () => {
  const { rebaseSchedule, spanDaysIso } = await import('../../src/lib/boq/plan-store.ts')
  // กรณีจริงของเจ้าของ: แผนตั้งวันเริ่มตามค่าตั้งต้น 15 พ.ย. แต่สัญญาเริ่ม 17 มิ.ย. – 13 ธ.ค. (180 วัน)
  assert.equal(spanDaysIso('2026-06-17', '2026-12-13'), 180)
  assert.equal(spanDaysIso('2026-12-13', '2026-06-17'), null)
  const p = parsePlanInput({ ...plan(), start: '2026-11-15', days: 180 }).value
  const r = rebaseSchedule({ ...p, progress: { weekly: true, items: { '0.0.0': [0.5, 0.8], '0.0.1': [1] } } }, '2026-06-17', 180)
  // สิ้น W1 เดิม = 21 พ.ย. → สัปดาห์ที่ 23 ของสัญญาใหม่ (index 22) · W2 เดิม (28 พ.ย.) → index 23
  assert.equal(r.progress.items['0.0.0'][22], 0.5)
  assert.equal(r.progress.items['0.0.0'][23], 0.8)
  assert.equal(r.progress.items['0.0.1'][22], 1)
  assert.equal(r.dropped, 0)
  // ผลงานที่ตกนอกสัญญาใหม่ถูกนับว่าทิ้ง · งานถูกบีบให้อยู่ในระยะใหม่
  const short = rebaseSchedule({ ...p, progress: { weekly: true, items: { '0.0.0': [0.5] } } }, '2026-01-01', 30)
  assert.equal(short.dropped, 1)
  assert.deepEqual(short.progress.items, {})
  for (const t of short.categories.flatMap((c) => c.tasks)) assert.ok(t.offset + t.dur <= 30)
  assert.equal(parsePlanInput({ ...plan(), categories: short.categories, start: '2026-01-01', days: 30 }).ok, true)
})

test('fitCurve (R29): ยอดรวมถ่วงมูลค่าตรงเส้นที่ให้ · % รายรายการไม่ลดลง · งานที่แผนว่าควรเสร็จก่อนได้มากกว่า', async () => {
  const { fitCurve, interpolateCum, readActualCurve } = await import('../../src/lib/boq/curve-fit.ts')
  const many = plan()
  many.categories[0].tasks.push({ name: 'งานหลัง', amount: 400000, source: '', offset: 14, dur: 14, on: true, items: [item('ทาสี', 100000, 300000)] })
  const p = parsePlanInput({ ...many, days: 28 }).value
  const cum = interpolateCum([0.1, null, 0.4, null, 0.9]) // W1..W5 · เส้นตรงระหว่างจุดที่รู้
  assert.ok(Math.abs(cum[1] - 0.25) < 1e-12)
  assert.equal(interpolateCum([null, null]).every((x) => x == null), true)
  const r = fitCurve(p, [...cum.slice(0, 4)])
  assert.equal(r.lastWeek, 4)
  assert.ok(r.maxErr < 5e-5)
  for (const a of Object.values(r.items)) for (let w = 1; w < 4; w += 1) assert.ok(a[w] >= a[w - 1])
  // W1: งานแรกควรเสร็จก่อนงานหลัง
  assert.ok(r.items['0.0.0'][0] > r.items['0.1.0'][0])
  // ผลลัพธ์ผ่านตัวตรวจผลงานและ planReport ได้ยอดตรง
  const pr = parseProgress({ weekly: true, items: r.items }, p)
  assert.equal(pr.ok, true)
  const rep = planReport({ ...p, progress: pr.value }, '2027-02-01')
  assert.ok(Math.abs(rep.installments[3].actual - cum[3]) < 5e-5)
  // เส้นสูงกว่าแผนก็ถึงเป้า (งานที่ยังไม่ถึงเวลาไต่ตาม)
  const hi = fitCurve(p, [0.95])
  assert.ok(Math.abs(hi.items['0.1.0'][0] - 0.95) < 0.2 && hi.maxErr < 5e-5)
  // อ่านเส้นจริงจากชีตจำลอง
  const cells = { '3,4': 'W1', '3,5': 'W2', '3,6': 'W3', '4,1': 'ดำเนินการ ได้จริง', '4,2': 'ความคืบหน้า / สัปดาห์ (%)', '5,2': 'ความคืบหน้าสะสม / สัปดาห์ (%)', '4,4': 0.05, '5,4': 0.1, '5,5': 0.3 }
  const g = { name: 'x', rows: 8, cols: 8, v: (r, c) => cells[`${r},${c}`] ?? null, w: (r, c) => String(cells[`${r},${c}`] ?? '') }
  assert.deepEqual(readActualCurve(g), [0.1, 0.3, null])
  assert.equal(readActualCurve({ ...g, v: () => null, w: () => '' }), null)
})

test('planReport.actualValueNow = ผลงานรวมตัวคูณ ÷ ราคาสัญญา ตรงกับตารางแนบหนังสือ', () => {
  const p = parsePlanInput(plan()).value
  const progress = { weekly: true, items: { '0.0.0': [1], '0.0.1': [0.5], '0.0.2': [0] } }
  const rep = planReport({ ...p, progress }, '2027-01-10')
  const pw = buildProgressWork({ id: 'p1', name: p.name, project: p.project, categories: p.categories, start: p.start, days: p.days, progress }, 1)
  assert.ok(Math.abs(rep.actualValueNow - ratio(pwTotal(pw).value, pw.contract)) < 1e-12)
  // ต่างจากเลขต้นทุน (ก่อนตัวคูณ) เมื่อราคาสัญญาไม่เท่ายอดต้นทุน
  assert.notEqual(Math.round(rep.actualValueNow * 1e6), Math.round(rep.installments[0].actual * 1e6))
})

test('S-Curve แนบหนังสือ (R30): ภาพนิ่ง ณ สัปดาห์ที่ตัด · ไป-กลับผ่านตัวตรวจ · ค่าเสียถูกปฏิเสธ', async () => {
  const { buildSCurveAttach, parseSCurveAttach, hasSCurve } = await import('../../src/lib/s-curve-attach.ts')
  const p = parsePlanInput({ ...plan(), days: 28 }).value
  const items = { '0.0.0': [0.2, 0.5, 0.9, 1], '0.0.1': [0, 0.3, 0.6, 1], '0.0.2': [0.1, 0.4, 0.7, 1] }
  // ตัดที่ W2 — ผลงาน W3–W4 ต้องไม่เข้า
  const cut = Object.fromEntries(Object.entries(items).map(([k, a]) => [k, a.slice(0, 2)]))
  const rep = planReport({ ...p, progress: { items: cut } }, '2027-02-01')
  const s = buildSCurveAttach(rep, { planId: 'p1', planName: p.name, project: p.name, week: 2, asOf: '2027-01-14' })
  assert.equal(s.actualCum.length, 4)
  assert.ok(s.actualCum[0] != null && s.actualCum[1] != null && s.actualCum[2] == null && s.actualCum[3] == null)
  assert.ok(Math.abs(s.planNow - rep.planCum[1]) < 1e-12)
  assert.ok(Math.abs(s.actualNow - s.actualCum[1]) < 1e-12)
  assert.ok(hasSCurve(s))
  assert.deepEqual(parseSCurveAttach(JSON.parse(JSON.stringify(s))), s)
  assert.equal(parseSCurveAttach(null), null)
  assert.equal(parseSCurveAttach({ ...s, week: 9 }), null)
  assert.equal(parseSCurveAttach({ ...s, asOf: '14/1/2027' }), null)
  assert.equal(parseSCurveAttach({ ...s, planCum: [0.1, 2, 0.3, 0.4] }), null)
  assert.equal(parseSCurveAttach({ ...s, actualCum: [0.1] }), null)
})

test('applySchedule (R31): จับคู่ชื่อ · แถว Actual = แผนตามสัญญา · Plan = แผนดำเนินการ · วันตรงจากแถว Plan', async () => {
  const { applySchedule, readSchedule } = await import('../../src/lib/boq/schedule-import.ts')
  const { similarity } = await import('../../src/lib/boq/core.ts')
  const p = parsePlanInput({ ...plan(), days: 120, start: '2026-07-13' }).value
  const rows = [
    { name: 'งานพื้น', planDates: { start: '2026-07-27', end: '2026-08-16' }, planWeeks: [2, 4], actualWeeks: [4, 6] },
    { name: 'งานที่ไม่มีในแผนเลยจริง ๆ', planDates: null, planWeeks: [0, 0], actualWeeks: null },
  ]
  const r = applySchedule(p.categories, rows, { start: '2026-07-13', days: 120, contractFrom: 'Actual', withOps: true, similarity })
  assert.equal(r.matched.length, 1)
  assert.deepEqual(r.unmatched, ['งานที่ไม่มีในแผนเลยจริง ๆ'])
  const t = r.categories[0].tasks[0]
  assert.deepEqual({ offset: t.offset, dur: t.dur }, { offset: 28, dur: 21 }) // สัปดาห์ W5–W7 (แถว Actual)
  assert.deepEqual(t.ops, { offset: 14, dur: 21 }) // วันตรงจากแถว Plan: 27 ก.ค. – 16 ส.ค.
  // ของเดิมไม่ถูกแก้ (immutable)
  assert.equal(p.categories[0].tasks[0].offset, 0)
  // ตัวอ่านไฟล์: ไม่มีหัว W1 = null
  assert.equal(readSchedule({ name: 'x', rows: 2, cols: 2, v: () => null, w: () => '' }), null)
})
