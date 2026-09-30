// ส่วนของ webhook body ที่บอทอ่าน (Messaging API) — อย่างอื่นข้ามไป
export type LineEvent = {
  type: 'message' | 'postback' | 'follow' | 'unfollow' | string
  webhookEventId: string
  replyToken?: string
  timestamp?: number
  source: { type: 'user' | 'group' | 'room'; userId?: string }
  message?: {
    type: 'text' | 'image' | string
    id: string
    text?: string
  }
  postback?: { data: string; params?: { date?: string } }
}
export type WebhookBody = { destination?: string; events: LineEvent[] }

export type SessionState =
  | 'idle'
  | 'apr_reason'
  | 'exp_amount'
  | 'exp_cat'
  | 'exp_site'
  | 'exp_confirm'
  | 'allow_pick'
  | 'wage_pick'

export type Session = { state: SessionState; payload: Record<string, unknown> }

/** หนึ่งเทิร์นของแชท: ใคร · ตอบไปทางไหน · แชทรออะไรอยู่ */
export type Turn = {
  lineUserId: string
  replyToken: string | null
  ownerName: string
  session: Session
}

// วินาทีที่แต่ละสถานะรอ (bot_session_set รับเป็นวินาที)
export const TTL_SEC: Record<SessionState, number> = {
  idle: 900,
  apr_reason: 600,
  exp_amount: 1800,
  exp_cat: 1800,
  exp_site: 1800,
  exp_confirm: 1800,
  allow_pick: 1800,
  wage_pick: 900,
}
