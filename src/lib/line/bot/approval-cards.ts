import { copy } from './copy'
import { bubble, data } from './messages'
import { baht, thaiDate } from './util'

/**
 * การ์ดรายการรออนุมัติ (ใบเบิก · รายจ่าย) — ใช้ร่วมกันสองที่:
 *  · เมนู "รออนุมัติ" ในแชท (`flows/approvals.ts`)
 *  · ข้อความแจ้งเตือนที่ระบบส่งเข้า LINE เองตอนมีของรออนุมัติ (`push-batch.ts`)
 * 🔴 ปุ่มทั้งสองที่ต้องส่ง postback data ชุดเดียวกัน (`a=ap&k=…&i=…&x=…`) เพื่อให้ตัวจัดการในบอทตัวเดียวรับได้
 *    จึงอยู่ที่เดียว ห้ามเขียนสำเนาไปไว้ที่ใดที่หนึ่ง
 */

export type QueueAdvance = {
  id: string
  employee: string
  amount: number
  date: string
  site: string | null
  by: string | null
  note: string | null
}

export type QueueExpense = {
  id: string
  kind: string
  amount: number
  date: string
  category: string | null
  site: string | null
  by: string | null
  note: string | null
  slips: number
}

/** ผลของ RPC `bot_queue` */
export type Queue = {
  advances: QueueAdvance[]
  expenses: QueueExpense[]
  advance_count: number
  expense_count: number
}

const compact = (xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x)

export function advanceBubble(a: QueueAdvance) {
  return bubble({
    title: `เบิก ${a.employee} ${baht(a.amount)}`,
    lines: compact([
      `วันที่ ${thaiDate(a.date)}`,
      a.site ? `โครงการ ${a.site}` : null,
      a.by ? `ผู้ยื่น ${a.by}` : null,
      a.note ? `หมายเหตุ ${a.note}` : null,
    ]),
    buttons: [
      { label: copy.apr.approve, style: 'primary', data: data({ a: 'ap', k: 'advance', i: a.id, x: 'approve' }) },
      { label: copy.apr.reject, data: data({ a: 'ap', k: 'advance', i: a.id, x: 'reject' }) },
    ],
  })
}

export function expenseBubble(e: QueueExpense) {
  return bubble({
    title: `${e.category ?? 'รายจ่าย'} ${baht(e.amount)}`,
    lines: compact([
      `วันที่ ${thaiDate(e.date)}`,
      e.site ? `โครงการ ${e.site}` : 'ส่วนกลาง',
      e.by ? `ผู้คีย์ ${e.by}` : null,
      e.note ? `หมายเหตุ ${e.note}` : null,
      e.slips ? `แนบสลิป ${e.slips} รูป (ดูในเว็บ)` : null,
    ]),
    buttons: [
      { label: copy.apr.approve, style: 'primary', data: data({ a: 'ap', k: 'expense', i: e.id, x: 'approve' }) },
      { label: copy.apr.reject, data: data({ a: 'ap', k: 'expense', i: e.id, x: 'reject' }) },
    ],
  })
}
