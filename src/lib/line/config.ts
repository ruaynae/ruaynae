import 'server-only'

import { getSupabaseAdmin } from '@/lib/supabase/admin'

// คีย์ LINE อยู่ใน Supabase Vault (ตั้งที่ /settings/line) อ่านผ่าน _line_key ซึ่งเฉพาะ service role
// โหมดปลอม (LINE_API_FAKE) ใช้ตอนทดสอบเท่านั้น และไม่มีผลบน production เด็ดขาด
export const lineFake = () =>
  process.env.LINE_API_FAKE === '1' && process.env.VERCEL_ENV !== 'production'

const KEY_TTL_MS = 5 * 60_000
const keys = new Map<string, { value: string; at: number }>()

export function clearLineKeys() {
  keys.clear()
}

async function vaultKey(
  name: 'line_channel_secret' | 'line_channel_access_token',
): Promise<string | null> {
  const hit = keys.get(name)
  if (hit && Date.now() - hit.at < KEY_TTL_MS) return hit.value
  const { data, error } = await getSupabaseAdmin().rpc('_line_key', { p_name: name })
  if (error) throw new Error(error.message)
  const value = (data as string | null) ?? null
  if (value) keys.set(name, { value, at: Date.now() })
  return value
}

export async function lineSecret(): Promise<string | null> {
  if (lineFake()) return process.env.LINE_FAKE_CHANNEL_SECRET ?? null
  return vaultKey('line_channel_secret')
}

export async function lineToken(): Promise<string | null> {
  if (lineFake()) return 'fake-token'
  return vaultKey('line_channel_access_token')
}
