import test from 'node:test'
import assert from 'node:assert/strict'
import { parseBillReply, parseBillPatch, cleanBillDate } from '../../src/lib/bills.ts'
import { scoreTxn, rankCandidates, autoPick, nameSimilarity, coverage } from '../../src/lib/bill-match.ts'

const today = '2026-11-12'

test('อ่านบิล: ปี พ.ศ./ปีย่อ → ค.ศ. · เลขผู้เสียภาษี 13 หลัก · ไม่ใช่บิล = null', () => {
  const r = parseBillReply('```json\n{"is_bill":true,"vendor":"บจก. ไทวัสดุ","tax_id":"0-1055-12345-67-8","bill_no":"INV-0012","date":"2569-11-05","amount":"12,345.50","vat":"807.62"}\n```', today)
  assert.deepEqual(r, { vendor: 'บจก. ไทวัสดุ', taxId: '0105512345678', billNo: 'INV-0012', date: '2026-11-05', amount: 12345.5, vat: 807.62 })
  assert.equal(parseBillReply('{"is_bill":false}', today), null)
  assert.equal(parseBillReply('ไม่ใช่ JSON', today), null)
  assert.equal(cleanBillDate('05/11/69', today), '2026-11-05')
  assert.equal(cleanBillDate('2027-01-01', today), null) // อนาคต
  assert.equal(parseBillReply('{"is_bill":true,"vendor":"ร้าน ก","tax_id":"123","amount":0}', today).taxId, null)
})

test('ตัวตรวจช่องที่แก้: เลขผู้เสียภาษีผิด/ยอดติดลบ = ปฏิเสธ · ไม่ส่ง = ไม่แตะ', () => {
  assert.deepEqual(parseBillPatch({ amount: '1,200', billDate: '2026-11-01' }), { ok: true, value: { amount: 1200, billDate: '2026-11-01' } })
  assert.equal(parseBillPatch({ vendorTaxId: '12' }).ok, false)
  assert.equal(parseBillPatch({ amount: -5 }).ok, false)
  assert.deepEqual(parseBillPatch({ vendorTaxId: '' }), { ok: true, value: { vendorTaxId: null } })
})

test('ชื่อผู้ขาย: ตัดคำนิติบุคคล/สาขา · อยู่ในหมายเหตุ = 1', () => {
  assert.equal(nameSimilarity('บริษัท ไทวัสดุ จำกัด สาขา 12', 'วัสดุ รพ แมว · ไทวัสดุ · อ้างอิง 123'), 1)
  assert.ok(nameSimilarity('โฮมโปร', 'ค่าปูน ร้านเฮง') < 0.3)
  assert.equal(nameSimilarity(null, 'x'), 0)
})

test('จับคู่: ยอดตรง + วันที่ใกล้ + ชื่อตรง = คู่ชัดเจน · ยอดตรงสองราย/มีบิลแย่ง = ไม่จับเอง', () => {
  const bill = { amount: 12345.5, date: '2026-11-05', vendor: 'ไทวัสดุ' }
  const txns = [
    { id: 'a', amount: 12345.5, date: '2026-11-04', text: 'ไทวัสดุ อ้างอิง 1' },
    { id: 'b', amount: 12345, date: '2026-11-04', text: 'อื่น' },
    { id: 'c', amount: 999, date: '2026-11-04', text: 'ไทวัสดุ' },
    { id: 'd', amount: 12345.5, date: '2026-06-01', text: 'ไทวัสดุ' }, // ห่างเกิน −45 วัน
  ]
  const ranked = rankCandidates(bill, txns)
  assert.deepEqual(ranked.map((c) => c.txnId), ['a', 'b'])
  assert.equal(ranked[0].exact, true)
  assert.equal(ranked[1].exact, false)
  assert.equal(autoPick(ranked, 0), 'a')
  assert.equal(autoPick(ranked, 1), null)
  const twin = rankCandidates(bill, [...txns, { id: 'e', amount: 12345.5, date: '2026-11-06', text: '' }])
  assert.equal(autoPick(twin, 0), null)
  assert.equal(scoreTxn({ amount: null, date: null, vendor: null }, txns[0]), null)
})

test('โอนครั้งเดียวจ่ายหลายบิล: รวมยอดบิลเทียบยอดโอน', () => {
  assert.deepEqual(coverage(1500, [1000, 500]), { sum: 1500, diff: 0, complete: true })
  assert.deepEqual(coverage(1500, [1000, null]), { sum: 1000, diff: 500, complete: false })
})
