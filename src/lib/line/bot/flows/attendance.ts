import { rpc, send } from '../api'
import { copy } from '../copy'
import { data, menuItems, text, type QuickItem } from '../messages'
import type { Turn } from '../types'
import { addDays, isDate, today, thaiDate } from '../util'

type Result = {
  date: string
  sites: { site_id: string; name: string; people: { name: string; job: string | null; units: number }[] }[]
  empty_sites: string[]
  total_people: number
}

const dayChoices = (on: string): QuickItem[] => {
  const t = today()
  return [
    ...(on !== t ? [{ label: 'วันนี้', data: data({ a: 'at', d: t }) }] : []),
    ...(on !== addDays(t, -1) ? [{ label: 'เมื่อวาน', data: data({ a: 'at', d: addDays(t, -1) }) }] : []),
    { label: 'เลือกวันอื่น', datePicker: 'a=at', initial: on, max: t },
    ...menuItems(),
  ]
}

/** เมนู 2 · ใครลงชื่อเข้าโครงการไหน (ไม่มียอดเงิน) */
export async function showAttendance(turn: Turn, on?: string | null) {
  const date = isDate(on) ? on : today()
  const r = await rpc<Result>('bot_attendance_today', { p_line_user: turn.lineUserId, p_on: date })
  const isToday = date === today()

  if (r.total_people === 0) {
    const body = isToday ? copy.att.none : copy.att.noneDay(thaiDate(date))
    const extra = r.empty_sites.length ? `\n${copy.att.empty(r.empty_sites.join(', '))}` : ''
    return send(turn, [text(body + extra, dayChoices(date))])
  }

  const blocks = r.sites.map((s) => {
    const rows = s.people.map((p) => {
      const job = p.job ? ` (${p.job})` : ''
      const half = p.units && p.units !== 1 ? ` · ${p.units} แรง` : ''
      return `- ${p.name}${job}${half}`
    })
    return `${copy.att.site(s.name, s.people.length)}\n${rows.join('\n')}`
  })
  const tail = r.empty_sites.length ? [copy.att.empty(r.empty_sites.join(', '))] : []
  const all = [copy.att.head(isToday ? `วันนี้ ${thaiDate(date)}` : thaiDate(date), r.total_people), ...blocks, ...tail]

  // ข้อความละไม่เกิน ~4,500 ตัวอักษร (เพดาน LINE คือ 5,000) · reply ฟรีได้ 5 ข้อความ
  const chunks: string[] = []
  let cur = ''
  for (const b of all) {
    if (cur && cur.length + b.length + 2 > 4500) {
      chunks.push(cur)
      cur = b
    } else cur = cur ? `${cur}\n\n${b}` : b
  }
  if (cur) chunks.push(cur)
  const msgs = chunks.slice(0, 5).map((c, i, a) => text(c, i === a.length - 1 ? dayChoices(date) : undefined))
  return send(turn, msgs)
}
