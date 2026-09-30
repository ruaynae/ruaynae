import { randomUUID } from 'node:crypto'
import type { Slip } from '@/lib/attachments'
import { MAX_ATTACHMENTS } from '@/lib/constants'
import { rpc, send, sessionGet, setState } from '../api'
import { copy, dbErrorText } from '../copy'
import { bubble, carousel, data, menuItems, text, type QuickItem } from '../messages'
import { attachToTransaction, storeLineImage } from '../photo'
import type { Turn } from '../types'
import { addDays, baht, isDate, parseAmountNote, today, thaiDate } from '../util'

// เมนู 1 · คีย์รายจ่าย: (รูปบิล) → ยอด → หมวด → โครงการ → ยืนยัน · รายการเข้าเป็น "อนุมัติแล้ว" ทันที
// เพราะเจ้าของเป็นคนคีย์เอง (เหมือนคีย์ในเว็บ)

type Options = { categories: { id: string; name: string }[]; sites: { id: string; name: string }[] }
type Choice = { id: string; name: string }

type Payload = {
  slips: Slip[]
  amount?: number
  category?: string
  categoryName?: string
  site?: string | null
  siteName?: string | null
  date?: string
  method?: 'cash' | 'transfer'
  note?: string
  ref?: string
}

const payloadOf = (turn: Turn): Payload => {
  const p = turn.session.payload as Partial<Payload>
  return { ...p, slips: Array.isArray(p.slips) ? p.slips : [] }
}

const options = (turn: Turn) => rpc<Options>('bot_expense_options', { p_line_user: turn.lineUserId })

const cancelItem: QuickItem = { label: copy.exp.cancel, text: 'ยกเลิก' }

/** ตัวเลือกยาว ๆ: ใบละ 4 ปุ่ม เลื่อนซ้าย-ขวา (LINE จำกัด 12 ใบ) */
function choices(alt: string, title: string, items: { label: string; data: string }[]) {
  const groups: (typeof items)[] = []
  for (let i = 0; i < items.length; i += 4) groups.push(items.slice(i, i + 4))
  return carousel(
    alt,
    groups.slice(0, 12).map((g, i) =>
      bubble({ title: groups.length > 1 ? `${title} (${i + 1}/${groups.length})` : title, lines: [], buttons: g }),
    ),
  )
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '')

/** พิมพ์ชื่อมา: ตรงเป๊ะก่อน · ไม่งั้นต้องมีตัวเดียวที่มีคำนั้น */
function matchByName(list: Choice[], typed: string): Choice | null {
  const t = norm(typed)
  if (!t) return null
  const exact = list.filter((x) => norm(x.name) === t)
  if (exact.length === 1) return exact[0]
  const part = list.filter((x) => norm(x.name).includes(t))
  return part.length === 1 ? part[0] : null
}

/** กดเมนู "คีย์รายจ่าย" · ถ้าส่งรูปมาก่อนแล้วให้เก็บรูปไว้ */
export async function startExpense(turn: Turn) {
  const keep = turn.session.state === 'exp_amount' ? payloadOf(turn).slips : []
  await setState(turn, 'exp_amount', { slips: keep })
  const head = keep.length ? `${copy.exp.photoGotAmount(keep.length)}\n` : ''
  return send(turn, [text(head + copy.exp.askAmount, [cancelItem])])
}

/** รูปบิลเข้ามาในแชท (จากสถานะไหนก็ได้) */
export async function addPhoto(turn: Turn, messageId: string, ownerProfileId: string) {
  let slip: Slip
  try {
    slip = await storeLineImage(messageId, ownerProfileId)
  } catch {
    return send(turn, [text(copy.exp.photoFail)])
  }
  const r = await rpc<{ state: string; count: number; full: boolean; started: boolean }>('bot_session_photo', {
    p_line_user: turn.lineUserId,
    p_slip: slip,
    p_max: MAX_ATTACHMENTS,
    p_ttl_sec: 1800,
  })
  if (r.full) return send(turn, [text(copy.exp.photoFull)])

  turn.session = await sessionGet(turn.lineUserId)
  if (r.state === 'exp_confirm') return showConfirm(turn, copy.exp.photoGotAmount(r.count))
  if (r.state === 'exp_amount') {
    return send(turn, [text(copy.exp.photoGot(r.count), [cancelItem])])
  }
  return send(turn, [text(copy.exp.photoGotAmount(r.count))])
}

/** ข้อความที่พิมพ์เข้ามาระหว่างคีย์รายจ่าย */
export async function onText(turn: Turn, raw: string) {
  switch (turn.session.state) {
    case 'exp_amount':
      return onAmount(turn, raw)
    case 'exp_cat': {
      const { categories } = await options(turn)
      const hit = matchByName(categories, raw)
      return hit ? pickCategory(turn, hit.id) : askCategory(turn)
    }
    case 'exp_site': {
      const { sites } = await options(turn)
      const hit = matchByName(sites, raw)
      return hit ? pickSite(turn, hit.id) : askSite(turn)
    }
    case 'exp_confirm': {
      const note = raw.trim().slice(0, 200)
      await setState(turn, 'exp_confirm', { ...payloadOf(turn), note })
      return showConfirm(turn)
    }
    default:
      return send(turn, [text(copy.help, menuItems())])
  }
}

async function onAmount(turn: Turn, raw: string) {
  const hit = parseAmountNote(raw)
  if (!hit) return send(turn, [text(copy.exp.badAmount, [cancelItem])])
  await setState(turn, 'exp_cat', { ...payloadOf(turn), amount: hit.amount, ...(hit.note ? { note: hit.note } : {}) })
  return askCategory(turn)
}

async function askCategory(turn: Turn) {
  const { categories } = await options(turn)
  if (categories.length === 0) {
    await setState(turn, 'idle')
    return send(turn, [text(copy.exp.noCategory, menuItems())])
  }
  const amount = baht(payloadOf(turn).amount ?? 0)
  return send(turn, [
    text(copy.exp.pickCategory(amount), [cancelItem]),
    choices('เลือกหมวด', 'เลือกหมวด', categories.map((c) => ({ label: c.name, data: data({ a: 'xc', c: c.id }) }))),
  ])
}

export async function pickCategory(turn: Turn, categoryId: string) {
  if (turn.session.state !== 'exp_cat') return send(turn, [text(copy.expired, menuItems())])
  const { categories } = await options(turn)
  const cat = categories.find((c) => c.id === categoryId)
  if (!cat) return send(turn, [text(copy.exp.categoryGone, menuItems())])
  await setState(turn, 'exp_site', { ...payloadOf(turn), category: cat.id, categoryName: cat.name })
  return askSite(turn)
}

async function askSite(turn: Turn) {
  const { sites } = await options(turn)
  if (sites.length === 0) return enterConfirm(turn, null, null)
  return send(turn, [
    text(copy.exp.pickSite, [cancelItem]),
    choices('เลือกโครงการ', 'เลือกโครงการ', [
      { label: copy.exp.central, data: data({ a: 'xs', s: 'none' }) },
      ...sites.map((s) => ({ label: s.name, data: data({ a: 'xs', s: s.id }) })),
    ]),
  ])
}

export async function pickSite(turn: Turn, siteId: string) {
  if (turn.session.state !== 'exp_site') return send(turn, [text(copy.expired, menuItems())])
  if (siteId === 'none') return enterConfirm(turn, null, null)
  const { sites } = await options(turn)
  const site = sites.find((s) => s.id === siteId)
  if (!site) return send(turn, [text(copy.exp.siteGone, menuItems())])
  return enterConfirm(turn, site.id, site.name)
}

async function enterConfirm(turn: Turn, site: string | null, siteName: string | null) {
  await setState(turn, 'exp_confirm', {
    ...payloadOf(turn),
    site,
    siteName,
    date: today(),
    method: 'transfer',
    ref: randomUUID(),
  })
  return showConfirm(turn)
}

async function showConfirm(turn: Turn, prefix?: string) {
  const p = payloadOf(turn)
  if (turn.session.state !== 'exp_confirm' || !p.category || p.amount === undefined || !isDate(p.date)) {
    return send(turn, [text(copy.expired, menuItems())])
  }
  const method = p.method === 'transfer' ? copy.exp.transfer : copy.exp.cash
  const lines = [
    `${p.categoryName ?? ''} · ${baht(p.amount)}`,
    p.siteName ? `โครงการ ${p.siteName}` : copy.exp.central,
    `วันที่ ${thaiDate(p.date)}`,
    `จ่ายด้วย ${method}`,
    ...(p.slips.length ? [`แนบรูปบิล ${p.slips.length} รูป`] : []),
    ...(p.note ? [`หมายเหตุ ${p.note}`] : [copy.exp.noteHint]),
  ]
  const t = today()
  const quickItems: QuickItem[] = [
    { label: copy.exp.otherDate, datePicker: 'a=xd', initial: p.date, max: t },
    ...(p.date !== t ? [{ label: 'วันนี้', data: data({ a: 'xd', d: t }) }] : []),
    ...(p.date !== addDays(t, -1) ? [{ label: 'เมื่อวาน', data: data({ a: 'xd', d: addDays(t, -1) }) }] : []),
    cancelItem,
  ]
  const msgs = [
    ...(prefix ? [text(prefix)] : []),
    {
      ...carousel('ยืนยันรายจ่าย', [
        bubble({
          title: 'ยืนยันรายจ่าย',
          lines,
          buttons: [
            { label: copy.exp.save, style: 'primary', data: data({ a: 'xok' }) },
            { label: copy.exp.changeMethod, data: data({ a: 'xm' }) },
            { label: copy.exp.cancel, data: data({ a: 'xcx' }) },
          ],
        }),
      ]),
      quickReply: text('', quickItems).quickReply,
    },
  ]
  return send(turn, msgs)
}

export async function setDate(turn: Turn, date: string | undefined) {
  if (turn.session.state !== 'exp_confirm') return send(turn, [text(copy.expired, menuItems())])
  if (!isDate(date)) return showConfirm(turn)
  if (date > today()) return send(turn, [text(copy.exp.future)])
  await setState(turn, 'exp_confirm', { ...payloadOf(turn), date })
  return showConfirm(turn)
}

export async function toggleMethod(turn: Turn) {
  if (turn.session.state !== 'exp_confirm') return send(turn, [text(copy.expired, menuItems())])
  const p = payloadOf(turn)
  await setState(turn, 'exp_confirm', { ...p, method: p.method === 'transfer' ? 'cash' : 'transfer' })
  return showConfirm(turn)
}

export async function cancel(turn: Turn) {
  await setState(turn, 'idle')
  return send(turn, [text(copy.cancelled, menuItems())])
}

type Created = {
  ok: boolean
  code?: string
  duplicate?: boolean
  transaction_id?: string
  category?: string
  site?: string | null
}

export async function save(turn: Turn) {
  const p = payloadOf(turn)
  if (turn.session.state !== 'exp_confirm' || !p.category || p.amount === undefined || !isDate(p.date)) {
    return send(turn, [text(copy.expired, menuItems())])
  }

  let r: Created
  try {
    r = await rpc<Created>('bot_create_expense', {
      p_line_user: turn.lineUserId,
      p_category: p.category,
      p_amount: p.amount,
      p_date: p.date,
      p_site: p.site ?? null,
      p_pay_method: p.method ?? 'transfer',
      p_note: p.note ?? null,
      p_client_ref: p.ref ?? null,
    })
  } catch (e) {
    return send(turn, [text(dbErrorText((e as Error).message), [cancelItem])])
  }
  if (!r.ok) {
    await setState(turn, 'idle')
    return send(turn, [text(r.code === 'SITE_INVALID' ? copy.exp.siteGone : copy.exp.categoryGone, menuItems())])
  }

  await setState(turn, 'idle')
  if (r.duplicate) return send(turn, [text(copy.exp.duplicate, menuItems())])

  const attached = r.transaction_id ? await attachToTransaction(r.transaction_id, p.slips) : true
  const where = r.site ? `โครงการ ${r.site}` : copy.exp.central
  return send(turn, [
    text(copy.exp.saved(r.category ?? p.categoryName ?? '', baht(p.amount), where, attached ? p.slips.length : 0), [
      { label: 'คีย์รายการต่อ', data: 'm=exp' },
      ...menuItems().slice(1),
    ]),
    ...(attached ? [] : [text(copy.exp.slipFail)]),
  ])
}
