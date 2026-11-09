/**
 * รายงานรายรับ-รายจ่ายรายโครงการ (PDF · 9 พ.ย. 2569) — รูปร่างข้อมูล + สูตรสรุป (ไฟล์ล้วน · unit test รันด้วย node ตรง ๆ)
 * ใช้ทั้งหน้าจอ (`/sites/[id]/statement`) และตัววาด PDF (`finance-canvas.ts`) — ตัวเลขทุกที่มาจากชุดเดียวกัน
 * · เฉพาะรายการที่ **อนุมัติแล้ว** · ไม่รวมค่าแรงรายวันที่ลงชื่อ (ไม่ใช่รายการรายรับ-รายจ่าย) — ระบุไว้ท้ายรายงาน
 */

export type StatementRow = {
  /** วันที่แสดงผล (พ.ศ. · จัดรูปแล้ว) */
  date: string
  text: string
  income: number | null
  expense: number | null
}
export type StatementCat = { name: string; total: number; count: number }
export type StatementData = {
  company: string
  siteName: string
  client: string
  /** "ทั้งหมด" หรือ "1 ต.ค. 2569 – 9 พ.ย. 2569" */
  range: string
  printed: string
  rows: StatementRow[]
  income: StatementCat[]
  expense: StatementCat[]
  /** ตัดที่เพดานแถว — รายงานไม่ครบ (บอกท้ายรายงาน) */
  truncated: boolean
}

export const ST_MAX_ROWS = 5000
export const ST_NOTE = 'รายงานนี้แสดงเฉพาะรายการรายรับ-รายจ่ายที่อนุมัติแล้ว ไม่รวมค่าแรงรายวันที่ลงชื่อเข้าโครงการ'

const r2 = (n: number) => Math.round(n * 100) / 100
export const stSum = (cats: readonly StatementCat[]) => r2(cats.reduce((s, c) => s + c.total, 0))

export function stTotals(d: Pick<StatementData, 'income' | 'expense'>) {
  const income = stSum(d.income)
  const expense = stSum(d.expense)
  return { income, expense, balance: r2(income - expense) }
}

/** รวมยอดแยกหมวดจากแถวรายการ (ใช้เมื่อไม่มีตัวรวมจากฐานข้อมูล · และตรวจว่าตรงกัน) */
export function stCategories(rows: readonly { kind: 'income' | 'expense'; category: string; amount: number }[]) {
  const make = (kind: 'income' | 'expense'): StatementCat[] => {
    const m = new Map<string, StatementCat>()
    for (const r of rows) {
      if (r.kind !== kind) continue
      const name = r.category || 'ไม่ระบุหมวด'
      const c = m.get(name) ?? { name, total: 0, count: 0 }
      c.total = r2(c.total + r.amount)
      c.count += 1
      m.set(name, c)
    }
    return [...m.values()].sort((a, b) => b.total - a.total)
  }
  return { income: make('income'), expense: make('expense') }
}

export const stMoney = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
