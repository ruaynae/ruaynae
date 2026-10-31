import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanDate, parseSlipReply, slipNote } from '../../src/lib/slip-ai/parse.ts'

const TODAY = '2026-10-31'

test('สลิปโอนปกติ: ยอด วันที่ พ.ศ. ผู้รับ เลขอ้างอิง', () => {
  const r = parseSlipReply(
    '{"is_receipt":true,"amount":1250.5,"date":"2569-10-30","payee":"ร้านวัสดุ ABC","ref":"016303123456ABC"}',
    TODAY,
  )
  assert.deepEqual(r, { amount: 1250.5, date: '2026-10-30', payee: 'ร้านวัสดุ ABC', ref: '016303123456ABC' })
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
  assert.equal(cleanDate('31/10/2569', TODAY), null)
})

test('เลขอ้างอิงที่มีอักขระแปลก (อาจแทรก LIKE) ถูกทิ้ง · ช่องว่างถูกตัด', () => {
  assert.equal(parseSlipReply('{"amount":10,"ref":"50%_off"}', TODAY)?.ref, null)
  assert.equal(parseSlipReply('{"amount":10,"ref":"0163 0312 3456"}', TODAY)?.ref, '016303123456')
})

test('หมายเหตุ: ผู้รับ · อ้างอิง', () => {
  assert.equal(slipNote({ amount: 1, date: null, payee: 'นายสมชาย', ref: 'A1234' }), 'นายสมชาย · อ้างอิง A1234')
  assert.equal(slipNote({ amount: 1, date: null, payee: null, ref: null }), '')
})
