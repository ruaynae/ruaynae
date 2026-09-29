import { rpc, send, setState } from '../api'
import { copy, dbErrorText } from '../copy'
import { bubble, carousel, data, menuItems, text } from '../messages'
import type { Turn } from '../types'
import { baht, thaiDate } from '../util'

type Queue = {
  advances: { id: string; employee: string; amount: number; date: string; site: string | null; by: string | null; note: string | null }[]
  expenses: { id: string; kind: string; amount: number; date: string; category: string | null; site: string | null; by: string | null; note: string | null; slips: number }[]
  advance_count: number
  expense_count: number
}

type Decision = {
  ok: boolean
  action?: 'approve' | 'reject'
  code?: string
  label?: string
}

const compact = (xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x)

/** เมนู 3 · คิวรออนุมัติ: ใบเบิก + รายจ่ายที่หัวหน้าโครงการคีย์ */
export async function showQueue(turn: Turn) {
  const q = await rpc<Queue>('bot_queue', { p_line_user: turn.lineUserId })
  if (q.advance_count + q.expense_count === 0) {
    return send(turn, [text(copy.apr.none, menuItems())])
  }

  const msgs = [text(copy.apr.head(q.advance_count, q.expense_count))]

  if (q.advances.length) {
    msgs.push(
      carousel(
        `ใบเบิก ${q.advance_count} รายการ`,
        q.advances.map((a) =>
          bubble({
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
          }),
        ),
      ),
    )
  }

  if (q.expenses.length) {
    msgs.push(
      carousel(
        `รายจ่าย ${q.expense_count} รายการ`,
        q.expenses.map((e) =>
          bubble({
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
          }),
        ),
      ),
    )
  }

  const more = Math.max(0, q.advance_count - q.advances.length) + Math.max(0, q.expense_count - q.expenses.length)
  if (more > 0) msgs.push(text(copy.apr.more(more), menuItems()))
  return send(turn, msgs)
}

function resultText(r: Decision): string {
  const label = r.label ?? 'รายการ'
  if (r.ok) return r.action === 'approve' ? copy.apr.approved(label) : copy.apr.rejected(label)
  switch (r.code) {
    case 'ALREADY_APPROVED': return copy.apr.alreadyApproved(label)
    case 'ALREADY_REJECTED': return copy.apr.alreadyRejected(label)
    case 'NOT_FOUND': return copy.apr.notFound
    case 'REASON_REQUIRED': return copy.apr.needReason
    default: return copy.failed
  }
}

const afterDecision = () => [{ label: copy.apr.remaining, data: 'm=apr' }, ...menuItems()]

/** กดอนุมัติ/ตีกลับ · ตีกลับต้องถามเหตุผลก่อน */
export async function decide(turn: Turn, kind: string, id: string, action: string) {
  if ((kind !== 'advance' && kind !== 'expense') || (action !== 'approve' && action !== 'reject') || !id) {
    return send(turn, [text(copy.expired, menuItems())])
  }
  if (action === 'reject') {
    // ชื่อรายการสำหรับถามเหตุผล — ใช้ป้ายกลาง ๆ ไม่ต้องยิงฐานข้อมูลเพิ่ม
    await setState(turn, 'apr_reason', { kind, id })
    return send(turn, [text(copy.apr.askReason(kind === 'advance' ? 'ใบเบิก' : 'รายจ่าย'), [{ label: 'ยกเลิก', text: 'ยกเลิก' }])])
  }
  try {
    const r = await rpc<Decision>('bot_approve', {
      p_line_user: turn.lineUserId, p_kind: kind, p_id: id, p_action: 'approve', p_reason: null,
    })
    return send(turn, [text(resultText(r), afterDecision())])
  } catch (e) {
    return send(turn, [text(dbErrorText((e as Error).message), menuItems())])
  }
}

/** ข้อความที่พิมพ์ตอนรอเหตุผลตีกลับ */
export async function rejectWithReason(turn: Turn, reason: string) {
  const { kind, id } = turn.session.payload as { kind?: string; id?: string }
  if (!kind || !id) return send(turn, [text(copy.expired, menuItems())])
  const why = reason.trim()
  if (!why) return send(turn, [text(copy.apr.needReason)])
  try {
    const r = await rpc<Decision>('bot_approve', {
      p_line_user: turn.lineUserId, p_kind: kind, p_id: id, p_action: 'reject', p_reason: why,
    })
    if (!r.ok && r.code === 'REASON_REQUIRED') return send(turn, [text(copy.apr.needReason)])
    await setState(turn, 'idle')
    return send(turn, [text(resultText(r), afterDecision())])
  } catch (e) {
    await setState(turn, 'idle')
    return send(turn, [text(dbErrorText((e as Error).message), menuItems())])
  }
}
