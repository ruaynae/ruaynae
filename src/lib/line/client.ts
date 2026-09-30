import 'server-only'

import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { clearLineKeys, lineFake, lineToken } from './config'

const API = 'https://api.line.me/v2/bot'
const DATA = 'https://api-data.line.me/v2/bot'

export type LineMessage = Record<string, unknown> & { type: string }

export class LineHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

async function outbox(toUser: string | null, kind: string, body: unknown) {
  const { error } = await getSupabaseAdmin()
    .from('line_outbox_test')
    .insert({ to_user: toUser, kind, body: body as never })
  if (error) throw new Error(error.message)
}

async function call(url: string, init: RequestInit, retried = false): Promise<Response> {
  const token = await lineToken()
  if (!token) throw new Error('line_token_missing')
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  })
  if (res.status === 401 && !retried) {
    clearLineKeys()
    return call(url, init, true)
  }
  if (!res.ok) {
    throw new LineHttpError(res.status, `LINE ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  return res
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

/** ตอบกลับได้ไม่เกิน 5 ข้อความต่อ reply token (ฟรี ไม่นับโควตา) */
export async function reply(replyToken: string, toUser: string, messages: LineMessage[]) {
  if (messages.length === 0) return
  if (messages.length > 5) throw new Error('reply takes at most 5 messages')
  if (lineFake()) return outbox(toUser, 'reply', { replyToken, messages })
  await call(`${API}/message/reply`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ replyToken, messages }),
  })
}

/** push เป็นก้อนละ 5 · นับโควตาก้อนละ 1 ข้อความ */
export async function push(toUser: string, messages: LineMessage[]) {
  for (let i = 0; i < messages.length; i += 5) {
    const part = messages.slice(i, i + 5)
    if (lineFake()) await outbox(toUser, 'push', { messages: part })
    else
      await call(`${API}/message/push`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ to: toUser, messages: part }),
      })
  }
}

// JPEG ขาว 1x1 — สิ่งที่ "LINE" ตอบให้ทุกรูปในโหมดปลอม
const FAKE_JPEG = Uint8Array.from(
  Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64',
  ),
)

/** ไบต์ของรูปที่ผู้ใช้ส่งมา */
export async function getContent(messageId: string): Promise<Uint8Array> {
  if (lineFake()) return FAKE_JPEG
  const res = await call(`${DATA}/message/${encodeURIComponent(messageId)}/content`, {
    method: 'GET',
  })
  return new Uint8Array(await res.arrayBuffer())
}

export type RichMenuArea = {
  bounds: { x: number; y: number; width: number; height: number }
  action:
    | { type: 'postback'; label: string; data: string; displayText?: string }
    | { type: 'uri'; label: string; uri: string }
}

export async function createDefaultRichMenu(
  def: {
    name: string
    chatBarText: string
    size: { width: number; height: number }
    areas: RichMenuArea[]
  },
  image: { bytes: Uint8Array; type: 'image/png' | 'image/jpeg' },
): Promise<string> {
  if (lineFake()) {
    await outbox(null, 'richmenu', {
      definition: def,
      image: { type: image.type, bytes: image.bytes.byteLength },
    })
    return 'fake-richmenu'
  }
  const created = (await (
    await call(`${API}/richmenu`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ ...def, selected: true }),
    })
  ).json()) as { richMenuId: string }
  await call(`${DATA}/richmenu/${created.richMenuId}/content`, {
    method: 'POST',
    headers: { 'Content-Type': image.type },
    body: Buffer.from(image.bytes),
  })
  await call(`${API}/user/all/richmenu/${created.richMenuId}`, { method: 'POST' })
  return created.richMenuId
}

export type LineQuota = { limit: number | null; used: number }

/** โควตา push ของเดือนนี้ · limit = null คือไม่จำกัด · reply ไม่นับ */
export async function getQuota(): Promise<LineQuota> {
  if (lineFake()) return { limit: 300, used: 12 }
  const [q, c] = await Promise.all([
    call(`${API}/message/quota`, { method: 'GET' }),
    call(`${API}/message/quota/consumption`, { method: 'GET' }),
  ])
  const quota = (await q.json()) as { type: 'none' | 'limited'; value?: number }
  const used = (await c.json()) as { totalUsage: number }
  return {
    limit: quota.type === 'limited' ? (quota.value ?? 0) : null,
    used: used.totalUsage ?? 0,
  }
}

export async function getProfileName(toUser: string): Promise<string | null> {
  if (lineFake()) return 'ทดสอบ LINE'
  try {
    const res = await call(`${API}/profile/${encodeURIComponent(toUser)}`, { method: 'GET' })
    const p = (await res.json()) as { displayName?: string }
    return p.displayName ?? null
  } catch {
    return null
  }
}
