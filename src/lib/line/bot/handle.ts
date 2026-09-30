import 'server-only'

import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { getProfileName } from '@/lib/line/client'
import { rpc, send, sessionGet, setState } from './api'
import { copy, dbErrorText } from './copy'
import { menuItems, readData, text } from './messages'
import type { LineEvent, Turn } from './types'
import * as allowance from './flows/allowance'
import * as approvals from './flows/approvals'
import { showAttendance } from './flows/attendance'
import * as expense from './flows/expense'
import * as wages from './flows/wages'

// ตัวจัดการ webhook — เจ้าของคนเดียว · แชทหนึ่งต่อหนึ่งเท่านั้น (กลุ่ม/ห้องข้ามไป)

const LINK_RE = /^(?:ผูก ?[:-]? ?)?(\d{6})$/

async function ownerProfileId(lineUserId: string): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('line_accounts')
    .select('profile_id')
    .eq('line_user_id', lineUserId)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`line_accounts: ${error.message}`)
  return data?.profile_id ?? null
}

async function tryLink(lineUserId: string, replyToken: string | null, code: string) {
  const turn: Turn = { lineUserId, replyToken, ownerName: '', session: { state: 'idle', payload: {} } }
  const display = await getProfileName(lineUserId).catch(() => null)
  const r = await rpc<{ ok: boolean; locked?: boolean; name?: string }>('bot_link', {
    p_line_user: lineUserId,
    p_code: code,
    p_display: display,
  })
  if (r.ok) return send(turn, [text(`${copy.linked}\n${copy.welcome}`, menuItems())])
  return send(turn, [text(r.locked ? copy.linkLocked : copy.linkFailed)])
}

async function openMenu(turn: Turn, menu: string) {
  switch (menu) {
    case 'exp':
      return expense.startExpense(turn)
    case 'att':
      await setState(turn, 'idle')
      return showAttendance(turn)
    case 'apr':
      await setState(turn, 'idle')
      return approvals.showQueue(turn)
    case 'allow':
      return allowance.showAllowance(turn)
    case 'wage':
      return wages.showWageList(turn)
    default:
      return send(turn, [text(copy.help, menuItems())])
  }
}

async function onPostback(turn: Turn, ev: NonNullable<LineEvent['postback']>) {
  const d = readData(ev.data)
  if (d.m) return openMenu(turn, d.m)
  const date = ev.params?.date ?? d.d
  switch (d.a) {
    case 'at':
      return showAttendance(turn, date)
    case 'ap':
      return approvals.decide(turn, d.k ?? '', d.i ?? '', d.x ?? '')
    case 'alw':
      return allowance.startAllowance(turn, d.p ?? '')
    case 'alt':
      return allowance.toggle(turn, d.e ?? '')
    case 'alp':
      return allowance.setPage(turn, Number(d.p))
    case 'ald':
      return allowance.setDate(turn, date)
    case 'alx':
      return allowance.clearPicked(turn)
    case 'alok':
      return allowance.confirmGive(turn)
    case 'alc':
      return allowance.cancel(turn)
    case 'xc':
      return expense.pickCategory(turn, d.c ?? '')
    case 'xs':
      return expense.pickSite(turn, d.s ?? '')
    case 'xd':
      return expense.setDate(turn, date)
    case 'xm':
      return expense.toggleMethod(turn)
    case 'xok':
      return expense.save(turn)
    case 'xcx':
      return expense.cancel(turn)
    case 'xw':
      return expense.askWho(turn)
    case 'xe':
      return expense.setWho(turn, d.e ?? '')
    case 'wg':
      return wages.showWageSlip(turn, d.e ?? '')
    default:
      return send(turn, [text(copy.expired, menuItems())])
  }
}

async function onText(turn: Turn, raw: string) {
  const body = raw.trim()
  if (body === 'ยกเลิก') {
    await setState(turn, 'idle')
    return send(turn, [text(copy.cancelled, menuItems())])
  }
  switch (turn.session.state) {
    case 'apr_reason':
      return approvals.rejectWithReason(turn, body)
    case 'exp_amount':
    case 'exp_cat':
    case 'exp_site':
    case 'exp_confirm':
      return expense.onText(turn, body)
    case 'wage_pick':
      return wages.onText(turn, body)
    default:
      return send(turn, [text(copy.help, menuItems())])
  }
}

async function handleOne(ev: LineEvent) {
  const lineUserId = ev.source.userId
  if (!lineUserId || ev.source.type !== 'user') return
  if (ev.type === 'unfollow') return

  const who = await rpc<{ linked: boolean; name?: string }>('bot_whoami', { p_line_user: lineUserId })
  const replyToken = ev.replyToken ?? null

  if (!who.linked) {
    if (ev.type === 'message' && ev.message?.type === 'text') {
      const m = LINK_RE.exec((ev.message.text ?? '').trim())
      if (m) return tryLink(lineUserId, replyToken, m[1])
    }
    const anon: Turn = { lineUserId, replyToken, ownerName: '', session: { state: 'idle', payload: {} } }
    return send(anon, [text(copy.howToLink)])
  }

  const turn: Turn = {
    lineUserId,
    replyToken,
    ownerName: who.name ?? '',
    session: await sessionGet(lineUserId),
  }

  try {
    if (ev.type === 'follow') return send(turn, [text(copy.welcome, menuItems())])
    if (ev.type === 'postback' && ev.postback) return await onPostback(turn, ev.postback)
    if (ev.type === 'message' && ev.message) {
      if (ev.message.type === 'text') return await onText(turn, ev.message.text ?? '')
      if (ev.message.type === 'image') {
        const profileId = await ownerProfileId(lineUserId)
        if (!profileId) return send(turn, [text(copy.howToLink)])
        return await expense.addPhoto(turn, ev.message.id, profileId)
      }
      return send(turn, [text(copy.help, menuItems())])
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : ''
    console.error('[line] handle failed', ev.type, message)
    await send(turn, [text(dbErrorText(message), menuItems())]).catch(() => undefined)
  }
}

/** LINE ส่งซ้ำได้ → bot_event_seen กันทำซ้ำ · event หนึ่งพังไม่ล้มตัวอื่น */
export async function handleEvents(events: LineEvent[]) {
  for (const ev of events) {
    try {
      if (await rpc<boolean>('bot_event_seen', { p_event_id: ev.webhookEventId })) continue
      await handleOne(ev)
    } catch (e) {
      console.error('[line] event failed', ev.type, e instanceof Error ? e.message : '')
    }
  }
}
