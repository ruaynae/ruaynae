import { randomUUID } from 'node:crypto'
import type { Slip } from '@/lib/attachments'
import { IMAGE, MAX_ATTACHMENTS } from '@/lib/constants'
import { readSlip, type SlipAiResult } from '@/lib/slip-ai/gemini'
import { slipNote } from '@/lib/slip-ai/parse'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { rpc, send, sessionGet, setState } from '../api'
import { copy, dbErrorText } from '../copy'
import { bubble, carousel, choices, data, matchByName, menuItems, text, type QuickItem } from '../messages'
import { attachToTransaction, storeLineImage } from '../photo'
import type { Turn } from '../types'
import { addDays, baht, isDate, parseAmountNote, today, thaiDate } from '../util'

// เมนู 1 · คีย์รายจ่าย: (รูปบิล) → ยอด → หมวด → โครงการ → ยืนยัน · รายการเข้าเป็น "อนุมัติแล้ว" ทันที
// เพราะเจ้าของเป็นคนคีย์เอง (เหมือนคีย์ในเว็บ)

type Choice = { id: string; name: string }
type Options = { categories: Choice[]; sites: Choice[]; employees: Choice[] }

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
  /** คนงานที่ออกเงินให้ก่อน (R15) · null = บริษัทจ่ายเอง */
  owed?: string | null
  owedName?: string | null
  /** กำลังเลือก "ใครจ่ายเงินไป" — ข้อความที่พิมพ์คือชื่อคน ไม่ใช่หมายเหตุ */
  picking?: boolean
  /** ค่าที่ AI อ่านจากสลิป (31 ต.ค. 2569) — เป็นแค่ข้อเสนอ ยอดเข้าจริงเมื่อเจ้าของกด "ใช่" หรือพิมพ์ยอดเอง */
  aiAmount?: number
  aiDate?: string | null
  aiNote?: string
}

const payloadOf = (turn: Turn): Payload => {
  const p = turn.session.payload as Partial<Payload>
  return { ...p, slips: Array.isArray(p.slips) ? p.slips : [] }
}

const options = (turn: Turn) => rpc<Options>('bot_expense_options', { p_line_user: turn.lineUserId })

const cancelItem: QuickItem = { label: copy.exp.cancel, text: 'ยกเลิก' }

/** กดเมนู "คีย์รายจ่าย" · ถ้าส่งรูปมาก่อนแล้วให้เก็บรูปไว้ */
export async function startExpense(turn: Turn) {
  const prev = turn.session.state === 'exp_amount' ? payloadOf(turn) : null
  const keep = prev?.slips ?? []
  await setState(turn, 'exp_amount', {
    slips: keep,
    ...(prev?.aiAmount !== undefined ? { aiAmount: prev.aiAmount, aiDate: prev.aiDate ?? null, aiNote: prev.aiNote ?? '' } : {}),
  })
  const head = keep.length ? `${copy.exp.photoGotAmount(keep.length)}\n` : ''
  return send(turn, [text(head + copy.exp.askAmount, [cancelItem])])
}

/** รูปบิลเข้ามาในแชท (จากสถานะไหนก็ได้) */
export async function addPhoto(turn: Turn, messageId: string, ownerProfileId: string) {
  let stored: { slip: Slip; image: Buffer }
  try {
    stored = await storeLineImage(messageId, ownerProfileId)
  } catch {
    return send(turn, [text(copy.exp.photoFail)])
  }
  const { slip, image } = stored
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
    // ยังไม่มียอดที่อ่านได้ = ลองให้ AI อ่านรูปนี้ (ปิดอยู่/อ่านไม่ได้ = ถามยอดแบบเดิม)
    if (payloadOf(turn).aiAmount === undefined) {
      const res = await readSlip(image, IMAGE.type, today())
      if (await offerAiRead(turn, res, r.count)) return
      return send(turn, [text(aiFallback(res, r.count), [cancelItem])])
    }
    return send(turn, [text(copy.exp.photoGotAmount(r.count), aiItems(payloadOf(turn)))])
  }
  return send(turn, [text(copy.exp.photoGotAmount(r.count))])
}

/** ปุ่มตอบด่วนระหว่างรอยืนยันยอดจากสลิป */
function aiItems(p: Payload): QuickItem[] {
  return p.aiAmount !== undefined
    ? [{ label: copy.exp.aiYes(baht(p.aiAmount)), data: data({ a: 'xa' }) }, cancelItem]
    : [cancelItem]
}

function aiFallback(res: SlipAiResult, count: number): string {
  // อ่านได้แต่ไม่ได้เสนอ = เจ้าของพิมพ์ยอดไปแล้วระหว่างรอ AI
  if (res.ok) return copy.exp.photoGotAmount(count)
  if (res.reason === 'OFF' || res.reason === 'ERROR') return copy.exp.photoGot(count)
  if (res.reason === 'QUOTA') return copy.exp.aiQuota(count)
  if (res.reason === 'KEY_REJECTED') return copy.exp.aiKey(count)
  return copy.exp.aiUnreadable(count)
}

/** สลิปนี้เคยถูกบันทึกแล้วไหม — ดูจากเลขอ้างอิงที่บอทเติมไว้ในหมายเหตุ (เตือน ไม่ใช่ห้าม) */
async function refSeen(ref: string): Promise<boolean> {
  const pattern = `%อ้างอิง ${ref.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const { data: rows, error } = await getSupabaseAdmin()
    .from('transactions')
    .select('id')
    .ilike('note', pattern)
    .order('created_at', { ascending: false })
    .range(0, 0)
  if (error) {
    console.error('[line] ตรวจสลิปซ้ำไม่ได้', error.message)
    return false
  }
  return (rows ?? []).length > 0
}

/** AI อ่านยอดได้ → เก็บเป็นข้อเสนอ แล้วถามยืนยันยอด · คืน false เมื่อไม่มีอะไรจะเสนอ (ผู้เรียกตอบแบบเดิม) */
async function offerAiRead(turn: Turn, res: SlipAiResult, count: number): Promise<boolean> {
  if (!res.ok) return false
  const { read } = res
  const dup = read.ref ? await refSeen(read.ref) : false

  // 🔴 อ่านเซสชันใหม่ก่อนเขียน — ระหว่างรอ AI (ไม่กี่วินาที) รูปอื่นอาจต่อเข้ามา หรือเจ้าของพิมพ์ยอดไปแล้ว
  //    เขียนทับด้วยค่าเก่า = รูปที่เพิ่งต่อเข้ามาหาย (§17 ข้อ 35)
  turn.session = await sessionGet(turn.lineUserId)
  const p = payloadOf(turn)
  if (turn.session.state !== 'exp_amount' || p.aiAmount !== undefined) return false
  const next: Payload = { ...p, aiAmount: read.amount, aiDate: read.date, aiNote: slipNote(read) }
  await setState(turn, 'exp_amount', next)

  const lines = [
    copy.exp.aiHead(p.slips.length || count),
    `ยอด ${baht(read.amount)}`,
    ...(read.date ? [`วันที่ ${thaiDate(read.date)}`] : []),
    ...(read.payee ? [`ผู้รับ ${read.payee}`] : []),
    ...(read.ref ? [`อ้างอิง ${read.ref}`] : []),
    ...(dup ? [copy.exp.aiDuplicate] : []),
    copy.exp.aiAsk(baht(read.amount)),
  ]
  await send(turn, [text(lines.join('\n'), aiItems(next))])
  return true
}

/** เจ้าของกด "ใช่ ฿…" — ใช้ยอดที่ AI อ่านได้ */
export async function useAiAmount(turn: Turn) {
  const p = payloadOf(turn)
  if (turn.session.state !== 'exp_amount' || p.aiAmount === undefined) {
    return send(turn, [text(copy.expired, menuItems())])
  }
  await setState(turn, 'exp_cat', { ...p, amount: p.aiAmount, ...(p.aiNote ? { note: p.aiNote } : {}) })
  return askCategory(turn)
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
      if (payloadOf(turn).picking) {
        const { employees } = await options(turn)
        const hit = matchByName(employees, raw)
        return hit ? setWho(turn, hit.id) : askWho(turn)
      }
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
  // พิมพ์ยอดเอง = ใช้ยอดที่พิมพ์ · หมายเหตุที่ไม่ได้พิมพ์ใช้ผู้รับ/เลขอ้างอิงจากสลิปแทน (ถ้ามี)
  const p = payloadOf(turn)
  const note = hit.note || p.aiNote || ''
  await setState(turn, 'exp_cat', { ...p, amount: hit.amount, ...(note ? { note } : {}) })
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
    // วันที่บนสลิป (ถ้า AI อ่านได้) · ไม่มี = วันนี้ · เจ้าของเปลี่ยนได้บนการ์ดยืนยัน
    date: payloadOf(turn).aiDate ?? today(),
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
    p.owedName ? copy.exp.owedLine(p.owedName) : copy.exp.companyPaid,
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
            { label: copy.exp.whoPaid, data: data({ a: 'xw' }) },
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

/** "ใครจ่ายเงินไป" — บริษัท หรือคนงานที่ออกเงินให้ก่อน (คืนตอนจ่ายค่าแรง · R15) */
export async function askWho(turn: Turn) {
  if (turn.session.state !== 'exp_confirm') return send(turn, [text(copy.expired, menuItems())])
  const { employees } = await options(turn)
  await setState(turn, 'exp_confirm', { ...payloadOf(turn), picking: true })
  return send(turn, [
    text(copy.exp.askWho, [cancelItem]),
    choices(copy.exp.whoPaid, copy.exp.whoPaid, [
      { label: copy.exp.companySelf, data: data({ a: 'xe', e: 'none' }) },
      ...employees.map((e) => ({ label: e.name, data: data({ a: 'xe', e: e.id }) })),
    ]),
  ])
}

export async function setWho(turn: Turn, employeeId: string) {
  if (turn.session.state !== 'exp_confirm') return send(turn, [text(copy.expired, menuItems())])
  const p = payloadOf(turn)
  if (employeeId === 'none') {
    await setState(turn, 'exp_confirm', { ...p, owed: null, owedName: null, picking: false })
    return showConfirm(turn)
  }
  const { employees } = await options(turn)
  const e = employees.find((x) => x.id === employeeId)
  if (!e) return askWho(turn)
  await setState(turn, 'exp_confirm', { ...p, owed: e.id, owedName: e.name, picking: false })
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
  employee?: string | null
}

const GONE: Record<string, string> = {
  SITE_INVALID: copy.exp.siteGone,
  CATEGORY_INVALID: copy.exp.categoryGone,
  EMPLOYEE_INVALID: copy.exp.employeeGone,
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
      p_owed_employee: p.owed ?? null,
    })
  } catch (e) {
    return send(turn, [text(dbErrorText((e as Error).message), [cancelItem])])
  }
  if (!r.ok) {
    await setState(turn, 'idle')
    return send(turn, [text(GONE[r.code ?? ''] ?? copy.exp.categoryGone, menuItems())])
  }

  await setState(turn, 'idle')
  if (r.duplicate) return send(turn, [text(copy.exp.duplicate, menuItems())])

  const attached = r.transaction_id ? await attachToTransaction(r.transaction_id, p.slips) : true
  const where = r.site ? `โครงการ ${r.site}` : copy.exp.central
  return send(turn, [
    text(copy.exp.saved(r.category ?? p.categoryName ?? '', baht(p.amount), where, attached ? p.slips.length : 0, r.employee ?? null), [
      { label: 'คีย์รายการต่อ', data: 'm=exp' },
      ...menuItems().slice(1),
    ]),
    ...(attached ? [] : [text(copy.exp.slipFail)]),
  ])
}
