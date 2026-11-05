import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildPdf } from '../../src/lib/pdf-build.ts'

const jpeg = (n) => new Uint8Array(n).fill(7)
const dec = (u8) => new TextDecoder('latin1').decode(u8)

test('buildPdf: โครงไฟล์ถูก — header, จำนวนหน้า, EOF', () => {
  const pdf = buildPdf([{ jpeg: jpeg(10), width: 100, height: 200 }, { jpeg: jpeg(20), width: 100, height: 200 }])
  const s = dec(pdf)
  assert.ok(s.startsWith('%PDF-1.4'))
  assert.ok(s.trimEnd().endsWith('%%EOF'))
  assert.match(s, /\/Count 2/)
  assert.equal((s.match(/\/Type \/Page /g) ?? []).length, 2)
})

test('buildPdf: ตาราง xref ชี้ตรงตำแหน่งของทุกวัตถุ', () => {
  const pdf = buildPdf([{ jpeg: jpeg(33), width: 10, height: 10 }, { jpeg: jpeg(5), width: 10, height: 10 }, { jpeg: jpeg(99), width: 10, height: 10 }])
  const s = dec(pdf)
  const start = Number(/startxref\n(\d+)/.exec(s)[1])
  assert.ok(s.slice(start).startsWith('xref'))
  const size = Number(/\/Size (\d+)/.exec(s)[1])
  const lines = s.slice(start).split('\n')
  for (let n = 1; n < size; n++) {
    const off = Number(lines[2 + n].slice(0, 10))
    assert.ok(s.slice(off).startsWith(`${n} 0 obj`), `วัตถุ ${n} ต้องอยู่ที่ offset ${off}`)
  }
})

test('buildPdf: /Length ของรูปเท่าจำนวนไบต์จริง และไบต์รูปถูกฝังครบ', () => {
  const pdf = buildPdf([{ jpeg: jpeg(123), width: 10, height: 10 }])
  const s = dec(pdf)
  assert.match(s, /\/Length 123 >>\nstream\n/)
  assert.ok(s.includes('\x07'.repeat(123)))
})

test('buildPdf: ไม่มีหน้า = ล้มชัดเจน ไม่สร้างไฟล์เสีย', () => {
  assert.throws(() => buildPdf([]), /NO_PAGES/)
})
