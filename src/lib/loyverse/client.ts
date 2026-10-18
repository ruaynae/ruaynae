import 'server-only'

import { getSupabaseAdmin } from '@/lib/supabase/admin'

/**
 * ตัวคุยกับ Loyverse API (R18) — เซิร์ฟเวอร์เท่านั้น
 *
 * 🔴 โทเคนอยู่ใน Supabase Vault (`_loyverse_token` · service role) ไม่ใช่ env
 * 🔴 รูปร่างข้อมูลของ Loyverse ยังไม่ได้ยืนยันกับเอกสารฉบับเต็ม → อ่านแบบระวัง
 *    (ทุกช่องอาจหาย · ตัวแปลงอยู่ใน `items.ts` ที่เดียว) · ปุ่มทดสอบในหน้าตั้งค่าคือตัวพิสูจน์
 * 🔴 ทุกลิสต์ของ Loyverse แบ่งหน้าด้วย `cursor` — อ่านจนหมดเสมอ ห้ามหยุดที่หน้าแรก (§7)
 */

const API = 'https://api.loyverse.com/v1.0'
const PAGE = 250
const MAX_PAGES = 200 // กันวนไม่รู้จบถ้า cursor ไม่หยุด (= 50,000 แถว)
const TOKEN_TTL_MS = 5 * 60_000

let cached: { value: string; at: number } | null = null

export function clearLoyverseToken() {
  cached = null
}

export async function loyverseToken(): Promise<string | null> {
  if (cached && Date.now() - cached.at < TOKEN_TTL_MS) return cached.value
  const { data, error } = await getSupabaseAdmin().rpc('_loyverse_token')
  if (error) throw new Error(error.message)
  const value = (data as string | null) ?? null
  cached = value ? { value, at: Date.now() } : null
  return value
}

export class LoyverseError extends Error {
  constructor(
    public code: 'NO_TOKEN' | 'TOKEN_REJECTED' | 'FORBIDDEN' | 'RATE_LIMITED' | 'NOT_FOUND' | 'HTTP' | 'NETWORK',
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

type Json = Record<string, unknown>

async function get(path: string, params: Record<string, string> = {}, retried = false): Promise<Json> {
  const token = await loyverseToken()
  if (!token) throw new LoyverseError('NO_TOKEN', 0, 'loyverse_token_missing')
  const qs = new URLSearchParams(params).toString()
  let res: Response
  try {
    res = await fetch(`${API}${path}${qs ? `?${qs}` : ''}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })
  } catch (e) {
    throw new LoyverseError('NETWORK', 0, `loyverse_network: ${(e as Error).message}`)
  }
  if (res.status === 401 && !retried) {
    // โทเคนอาจเพิ่งถูกเปลี่ยน · ล้างแคชแล้วลองอีกครั้งเดียว
    clearLoyverseToken()
    return get(path, params, true)
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 300)
    const code =
      res.status === 401 ? 'TOKEN_REJECTED'
      : res.status === 403 ? 'FORBIDDEN'
      : res.status === 429 ? 'RATE_LIMITED'
      : res.status === 404 ? 'NOT_FOUND'
      : 'HTTP'
    throw new LoyverseError(code, res.status, `loyverse ${res.status} ${path}: ${body}`)
  }
  return (await res.json()) as Json
}

/** อ่านทุกหน้าของลิสต์ · `key` = ชื่อ array ในคำตอบ (เช่น `items`) */
export async function getAll<T = Json>(path: string, key: string, params: Record<string, string> = {}): Promise<T[]> {
  const out: T[] = []
  let cursor: string | undefined
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await get(path, { ...params, limit: String(PAGE), ...(cursor ? { cursor } : {}) })
    const rows = page[key]
    if (Array.isArray(rows)) out.push(...(rows as T[]))
    cursor = typeof page.cursor === 'string' && page.cursor ? page.cursor : undefined
    if (!cursor) return out
  }
  throw new LoyverseError('HTTP', 0, `loyverse_too_many_pages ${path}`)
}

export type LvStore = { id: string; name?: string | null }
export type LvPaymentType = { id: string; name?: string | null; type?: string | null; deleted_at?: string | null }

export const listStores = () => getAll<LvStore>('/stores', 'stores')
export const listPaymentTypes = () => getAll<LvPaymentType>('/payment_types', 'payment_types')
