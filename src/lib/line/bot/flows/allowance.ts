import { rpc, send, setState } from '../api'
import { copy, dbErrorText } from '../copy'
import { data, flex, menuItems, text, type QuickItem } from '../messages'
import type { Turn } from '../types'
import { addDays, baht, isDate, today, thaiDate } from '../util'

// เมนู 4 · เบี้ยเลี้ยง เลือกทีละคน — ไม่ติ๊กใครไว้ล่วงหน้า · คนที่ได้แล้วโชว์ป้าย "ได้แล้ว" กดไม่ได้

const PAGE = 10

type Person = { employee_id: string; name: string; sites: string | null; given: boolean }
type People =
  | { ok: true; preset: { id: string; name: string; amount: number }; people: Person[] }
  | { ok: false; code: string }
type Give = {
  ok: boolean
  code?: string
  preset?: string
  amount?: number
  given: string[]
  already: string[]
  blocked: string[]
  no_attendance: string[]
}

type Payload = { preset: string; date: string; picked: string[]; page: number }

const readPayload = (turn: Turn): Payload | null => {
  const p = turn.session.payload as Partial<Payload>
  if (turn.session.state !== 'allow_pick' || !p.preset || !isDate(p.date)) return null
  return {
    preset: p.preset,
    date: p.date,
    picked: Array.isArray(p.picked) ? p.picked : [],
    page: typeof p.page === 'number' && p.page >= 0 ? p.page : 0,
  }
}

const dayChoices = (on: string): QuickItem[] => {
  const t = today()
  return [
    ...(on !== t ? [{ label: 'วันนี้', data: data({ a: 'ald', d: t }) }] : []),
    ...(on !== addDays(t, -1) ? [{ label: 'เมื่อวาน', data: data({ a: 'ald', d: addDays(t, -1) }) }] : []),
    { label: 'เลือกวันอื่น', datePicker: 'a=ald', initial: on, max: t },
    { label: copy.allow.cancel, text: 'ยกเลิก' },
  ]
}

const postback = (label: string, d: string, style: 'primary' | 'secondary' = 'secondary') => ({
  type: 'button',
  style,
  height: 'sm',
  action: { type: 'postback', label: label.slice(0, 20), data: d, displayText: label },
})

/** เมนู: เลือกรายการเบี้ยเลี้ยง (ถ้ามีรายการเดียวข้ามไปเลือกคนเลย) */
export async function showAllowance(turn: Turn) {
  const presets = await rpc<{ id: string; name: string; amount: number }[]>('bot_allowance_presets', {
    p_line_user: turn.lineUserId,
  })
  if (presets.length === 0) return send(turn, [text(copy.allow.noPreset, menuItems())])
  if (presets.length === 1) return startAllowance(turn, presets[0].id)
  await setState(turn, 'idle')
  return send(turn, [
    text(
      copy.allow.pickPreset,
      presets.slice(0, 12).map((p) => ({
        label: p.name,
        data: data({ a: 'alw', p: p.id }),
      })),
    ),
  ])
}

export async function startAllowance(turn: Turn, preset: string, date: string = today()) {
  await setState(turn, 'allow_pick', { preset, date, picked: [], page: 0 })
  return render(turn)
}

async function render(turn: Turn) {
  const p = readPayload(turn)
  if (!p) return send(turn, [text(copy.expired, menuItems())])

  const r = await rpc<People>('bot_allowance_people', {
    p_line_user: turn.lineUserId,
    p_on: p.date,
    p_preset: p.preset,
  })
  if (!r.ok) {
    await setState(turn, 'idle')
    return send(turn, [text(copy.allow.presetGone, menuItems())])
  }
  if (r.people.length === 0) {
    return send(turn, [text(copy.allow.none(thaiDate(p.date)), dayChoices(p.date))])
  }

  // เลือกได้เฉพาะคนที่ยังไม่ได้ และยังอยู่ในรายการของวันนั้น
  const eligible = new Set(r.people.filter((x) => !x.given).map((x) => x.employee_id))
  const picked = p.picked.filter((id) => eligible.has(id))
  const pages = Math.max(1, Math.ceil(r.people.length / PAGE))
  const page = Math.min(p.page, pages - 1)
  if (picked.length !== p.picked.length || page !== p.page) {
    await setState(turn, 'allow_pick', { ...p, picked, page })
  }

  const rows = r.people.slice(page * PAGE, (page + 1) * PAGE).map((x) => {
    if (x.given) {
      return {
        type: 'box',
        layout: 'horizontal',
        paddingAll: 'sm',
        contents: [
          { type: 'text', text: x.name, size: 'sm', wrap: true, flex: 3, color: '#6b7280' },
          { type: 'text', text: copy.allow.doneBadge, size: 'sm', align: 'end', flex: 1, color: '#15803d', weight: 'bold' },
        ],
      }
    }
    const on = picked.includes(x.employee_id)
    return postback(`${on ? '[x]' : '[ ]'} ${x.name}`, data({ a: 'alt', e: x.employee_id }), on ? 'primary' : 'secondary')
  })

  const nav = [
    ...(page > 0 ? [postback(copy.allow.prev, data({ a: 'alp', p: page - 1 }))] : []),
    ...(page < pages - 1 ? [postback(copy.allow.next, data({ a: 'alp', p: page + 1 }))] : []),
  ]
  const footer = [
    ...nav,
    ...(picked.length > 0
      ? [postback(copy.allow.confirm(picked.length), data({ a: 'alok' }), 'primary'), postback(copy.allow.clear, data({ a: 'alx' }))]
      : []),
    postback(copy.allow.cancel, data({ a: 'alc' })),
  ]

  const head = copy.allow.head(r.preset.name, baht(r.preset.amount), thaiDate(p.date))
  const status = picked.length ? `\n${copy.allow.picked(picked.length)}` : ''
  const pageNote = pages > 1 ? `\nหน้า ${page + 1}/${pages}` : ''

  return send(turn, [
    {
      ...flex(`${r.preset.name} · ${thaiDate(p.date)}`, {
        type: 'bubble',
        size: 'giga',
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            { type: 'text', text: head + status + pageNote, size: 'sm', wrap: true, weight: 'bold' },
            ...rows,
          ],
        },
        footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: footer },
      }),
      quickReply: text('', dayChoices(p.date)).quickReply,
    },
  ])
}

export async function toggle(turn: Turn, employeeId: string) {
  const p = readPayload(turn)
  if (!p || !employeeId) return send(turn, [text(copy.expired, menuItems())])
  const picked = p.picked.includes(employeeId)
    ? p.picked.filter((x) => x !== employeeId)
    : [...p.picked, employeeId]
  await setState(turn, 'allow_pick', { ...p, picked })
  return render(turn)
}

export async function setPage(turn: Turn, page: number) {
  const p = readPayload(turn)
  if (!p) return send(turn, [text(copy.expired, menuItems())])
  await setState(turn, 'allow_pick', { ...p, page: Number.isFinite(page) && page >= 0 ? page : 0 })
  return render(turn)
}

export async function setDate(turn: Turn, date: string | undefined) {
  const p = readPayload(turn)
  if (!p || !isDate(date)) return send(turn, [text(copy.expired, menuItems())])
  if (date > today()) return send(turn, [text(copy.exp.future, dayChoices(p.date))])
  // เปลี่ยนวัน = รายชื่อคนเปลี่ยน · ล้างที่เลือกไว้กันให้ผิดคน
  await setState(turn, 'allow_pick', { ...p, date, picked: [], page: 0 })
  return render(turn)
}

export async function clearPicked(turn: Turn) {
  const p = readPayload(turn)
  if (!p) return send(turn, [text(copy.expired, menuItems())])
  await setState(turn, 'allow_pick', { ...p, picked: [], page: 0 })
  return render(turn)
}

export async function cancel(turn: Turn) {
  await setState(turn, 'idle')
  return send(turn, [text(copy.cancelled, menuItems())])
}

/** ยืนยัน · คนที่ให้ไม่ได้ถูกข้ามและบอกชื่อ คนที่เหลือบันทึกต่อ */
export async function confirmGive(turn: Turn) {
  const p = readPayload(turn)
  if (!p) return send(turn, [text(copy.expired, menuItems())])
  if (p.picked.length === 0) return send(turn, [text(copy.allow.nothingPicked)])

  let r: Give
  try {
    r = await rpc<Give>('bot_allowance_give', {
      p_line_user: turn.lineUserId,
      p_on: p.date,
      p_preset: p.preset,
      p_employee_ids: p.picked,
    })
  } catch (e) {
    return send(turn, [text(dbErrorText((e as Error).message), menuItems())])
  }
  if (!r.ok) {
    await setState(turn, 'idle')
    return send(turn, [text(copy.allow.presetGone, menuItems())])
  }

  await setState(turn, 'idle')
  const lines = [
    r.given.length ? copy.allow.given(r.preset ?? '', baht(r.amount ?? 0), r.given) : copy.allow.nobody,
    r.already.length ? copy.allow.already(r.already) : null,
    r.blocked.length ? copy.allow.blocked(r.blocked) : null,
    r.no_attendance.length ? copy.allow.noAttendance(r.no_attendance) : null,
  ].filter((x): x is string => !!x)
  return send(turn, [
    text(lines.join('\n'), [{ label: copy.allow.another, data: 'm=allow' }, ...menuItems()]),
  ])
}
