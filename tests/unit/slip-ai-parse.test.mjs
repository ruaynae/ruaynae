import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanDate, joinNote, parseSlipReply, siteFromMemo, slipNote } from '../../src/lib/slip-ai/parse.ts'

const TODAY = '2026-10-31'

test('สลิปโอนปกติ: ยอด วันที่ พ.ศ. ผู้รับ เลขอ้างอิง', () => {
  const r = parseSlipReply(
    '{"is_receipt":true,"amount":1250.5,"date":"2569-10-30","payee":"ร้านวัสดุ ABC","ref":"016303123456ABC"}',
    TODAY,
  )
  assert.deepEqual(r, { amount: 1250.5, date: '2026-10-30', payee: 'ร้านวัสดุ ABC', ref: '016303123456ABC', memo: null, items: null })
})

test('ห่อด้วย ```json และยอดเป็นข้อความมีคอมมา', () => {
  const r = parseSlipReply('```json\n{"amount":"12,345.00 บาท","date":"2026-10-01"}\n```', TODAY)
  assert.equal(r?.amount, 12345)
  assert.equal(r?.date, '2026-10-01')
  assert.equal(r?.payee, null)
  assert.equal(r?.ref, null)
})

test('ไม่ใช่สลิป / ไม่มียอด / ยอดติดลบ / ข้อความเสีย = null', () => {
  assert.equal(parseSlipReply('{"is_receipt":false,"amount":500}', TODAY), null)
  assert.equal(parseSlipReply('{"amount":null}', TODAY), null)
  assert.equal(parseSlipReply('{"amount":-5}', TODAY), null)
  assert.equal(parseSlipReply('{"amount":0}', TODAY), null)
  assert.equal(parseSlipReply('ขออภัย อ่านไม่ได้', TODAY), null)
  assert.equal(parseSlipReply('[1,2]', TODAY), null)
  assert.equal(parseSlipReply('{"amount":"1.5k"}', TODAY), null)
})

test('ยอดปัดเป็นสตางค์', () => {
  assert.equal(parseSlipReply('{"amount":99.999}', TODAY)?.amount, 100)
})

test('วันที่: อนาคต/ไม่มีจริง/เก่าเกิน = null · พ.ศ. แปลงเป็น ค.ศ.', () => {
  assert.equal(cleanDate('2026-11-01', TODAY), null)
  assert.equal(cleanDate('2026-02-30', TODAY), null)
  assert.equal(cleanDate('2020-01-01', TODAY), null)
  assert.equal(cleanDate('2569-10-31', TODAY), '2026-10-31')
  assert.equal(cleanDate('2026-1-5', TODAY), '2026-01-05')
  assert.equal(cleanDate(null, TODAY), null)
  assert.equal(cleanDate('31/10/2569', TODAY), '2026-10-31')
  assert.equal(cleanDate('13/10/2026', TODAY), '2026-10-13')
  assert.equal(cleanDate('13/10/26', TODAY), null)
})

test('เลขอ้างอิงที่มีอักขระแปลก (อาจแทรก LIKE) ถูกทิ้ง · ช่องว่างถูกตัด', () => {
  assert.equal(parseSlipReply('{"amount":10,"ref":"50%_off"}', TODAY)?.ref, null)
  assert.equal(parseSlipReply('{"amount":10,"ref":"0163 0312 3456"}', TODAY)?.ref, '016303123456')
})

test('หมายเหตุ: ข้อความในสลิป · ผู้รับ · อ้างอิง', () => {
  assert.equal(slipNote({ amount: 1, date: null, payee: 'นายสมชาย', ref: 'A1234', memo: null, items: null }), 'นายสมชาย · อ้างอิง A1234')
  assert.equal(
    slipNote({ amount: 4427, date: null, payee: 'บริษัท คลังไฟฟ้า จำกัด', ref: '2026102813341224001728208', memo: 'รางไฟ รพ แมว', items: null }),
    'รางไฟ รพ แมว · บริษัท คลังไฟฟ้า จำกัด · อ้างอิง 2026102813341224001728208',
  )
  assert.equal(slipNote({ amount: 1, date: null, payee: null, ref: null, memo: null, items: null }), '')
})

test('สลิปกรุงเทพจริง (ตัวอย่างเจ้าของ): ข้อความ "บันทึก" ไปกับหมายเหตุ', () => {
  const r = parseSlipReply(
    '{"is_receipt":true,"amount":4427,"date":"2569-10-28","payee":"บริษัท คลังไฟฟ้า จำกัด","ref":"2026102813341224001728208","memo":"รางไฟ รพ แมว"}',
    TODAY,
  )
  assert.equal(r?.date, '2026-10-28')
  assert.equal(r?.memo, 'รางไฟ รพ แมว')
})

test('หาโครงการจากข้อความในสลิป', () => {
  const sites = [
    { id: 'a', name: 'รพ.แมว' },
    { id: 'b', name: 'สำนักทะเบียน' },
    { id: 'c', name: 'รพ' },
    { id: 'd', name: 'ก' },
  ]
  assert.equal(siteFromMemo('รางไฟ รพ แมว', sites)?.id, 'a')
  assert.equal(siteFromMemo('บัว สำนักทะเบียน', sites)?.id, 'b')
  assert.equal(siteFromMemo('ค่าปูน', sites), null)
  assert.equal(siteFromMemo(null, sites), null)
  // ชื่อสองโครงการเท่ากันหลังตัดช่องว่าง = ไม่เดา
  assert.equal(siteFromMemo('งาน รพ แมว', [{ id: 'x', name: 'รพ แมว' }, { id: 'y', name: 'รพ.แมว' }]), null)
})

test('หน้าจอคำสั่งซื้อไทวัสดุ (ตัวอย่างเจ้าของ): ชื่อสินค้า ร้าน วันที่ เลขคำสั่งซื้อ', () => {
  const r = parseSlipReply(
    '{"is_receipt":true,"amount":869,"date":"2026-10-13","payee":"ไทวัสดุ สาขาลำปาง","ref":"2614621612","memo":null,"items":"น้ำยาง CRS-2 PRO ONE ขนาด 18 ลิตร"}',
    TODAY,
  )
  assert.equal(r?.amount, 869)
  assert.equal(r?.date, '2026-10-13')
  assert.equal(slipNote(r), 'น้ำยาง CRS-2 PRO ONE ขนาด 18 ลิตร · ไทวัสดุ สาขาลำปาง · อ้างอิง 2614621612')
})

test('หมายเหตุที่พิมพ์เองต่อหน้าของ AI ไม่ทับ', () => {
  assert.equal(joinNote('น้ำยาง', 'น้ำยาง CRS-2 · ไทวัสดุ'), 'น้ำยาง CRS-2 · ไทวัสดุ')
  assert.equal(joinNote('ขยายไหล่ทาง', 'น้ำยาง · ไทวัสดุ'), 'ขยายไหล่ทาง · น้ำยาง · ไทวัสดุ')
  assert.equal(joinNote('', 'ไทวัสดุ'), 'ไทวัสดุ')
  assert.equal(joinNote('ค่าปูน', null), 'ค่าปูน')
})

test('ชื่อโครงการตรงบางส่วน (สลิปจริงของเจ้าของ: "เหล็ก ทต เกาะคา")', () => {
  const sites = [
    { id: 'k', name: 'ขยายไหล่ทาง ทต.เกาะคา' },
    { id: 'm', name: 'รพ.แมว' },
  ]
  assert.equal(siteFromMemo('เหล็ก ทต เกาะคา', sites)?.id, 'k')
  // สองโครงการใน ทต. เดียวกัน = ไม่เดา
  assert.equal(siteFromMemo('เหล็ก ทต เกาะคา', [...sites, { id: 'k2', name: 'ถนน คสล. ทต.เกาะคา' }]), null)
  // ส่วนที่ตรงสั้นเกินไป = ไม่เดา
  assert.equal(siteFromMemo('ค่า รพ', sites), null)
})
