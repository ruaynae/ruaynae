import 'server-only'

import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { push, reply, type LineMessage } from '@/lib/line/client'
import { TTL_SEC, type Session, type SessionState, type Turn } from './types'

/** เรียกฟังก์ชัน bot_* ด้วยสิทธิ์ service-role (ฟังก์ชันสวมสิทธิ์เจ้าของเองข้างใน) */
export async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const admin = getSupabaseAdmin() as unknown as {
    rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
  }
  const { data, error } = await admin.rpc(name, args)
  if (error) throw new Error(error.message)
  return data as T
}

export async function sessionGet(lineUserId: string): Promise<Session> {
  const row = await rpc<{ state: SessionState; payload: Record<string, unknown> } | null>(
    'bot_session_get',
    { p_line_user: lineUserId },
  )
  return row ? { state: row.state, payload: row.payload ?? {} } : { state: 'idle', payload: {} }
}

export async function setState(
  turn: Turn,
  state: SessionState,
  payload: Record<string, unknown> = {},
) {
  turn.session = { state, payload }
  await rpc('bot_session_set', {
    p_line_user: turn.lineUserId,
    p_state: state,
    p_payload: payload,
    p_ttl_sec: TTL_SEC[state],
  })
}

/**
 * ส่งข้อความ: ห้าข้อความแรกใช้ reply token (ฟรี · ใช้ได้ครั้งเดียว)
 * ที่เกินหรือหลังใช้ token แล้วเป็น push (นับโควตา) จึงพยายามให้จบในหนึ่ง reply
 */
export async function send(turn: Turn, messages: LineMessage[]) {
  let rest = messages
  if (turn.replyToken && messages.length > 0) {
    const token = turn.replyToken
    turn.replyToken = null
    try {
      await reply(token, turn.lineUserId, messages.slice(0, 5))
      rest = messages.slice(5)
    } catch {
      rest = messages
    }
  }
  if (rest.length > 0) await push(turn.lineUserId, rest)
}
