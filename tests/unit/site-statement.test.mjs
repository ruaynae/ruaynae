import test from 'node:test'
import assert from 'node:assert/strict'
import { stCategories, stTotals, stMoney } from '../../src/lib/site-statement.ts'

test('สรุปแยกหมวด: รวมต่อหมวด เรียงมากไปน้อย · รับ−จ่าย = คงเหลือ (ปัดสตางค์)', () => {
  const c = stCategories([
    { kind: 'income', category: 'งวดที่ 1', amount: 1000.1 },
    { kind: 'expense', category: 'วัสดุ', amount: 0.1 },
    { kind: 'expense', category: 'วัสดุ', amount: 0.2 },
    { kind: 'expense', category: 'ค่าแรง', amount: 500 },
    { kind: 'expense', category: '', amount: 5 },
  ])
  assert.deepEqual(c.expense.map((x) => [x.name, x.total, x.count]), [['ค่าแรง', 500, 1], ['ไม่ระบุหมวด', 5, 1], ['วัสดุ', 0.3, 2]])
  const t = stTotals(c)
  assert.deepEqual(t, { income: 1000.1, expense: 505.3, balance: 494.8 })
  assert.equal(stMoney(1234.5), '1,234.50')
})
