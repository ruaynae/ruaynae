import 'server-only'

import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { parseSlipReply, SLIP_PROMPT, type SlipRead } from './parse'

/**
 * อ่านสลิปด้วย Gemini API (31 ต.ค. 2569 · เจ้าของเลือกลองแบบฟรีก่อน)
 *
 * 🔴 คีย์อยู่ใน Supabase Vault (`_slip_ai_key` · service role) ไม่ใช่ env · ไม่มีคีย์ = ปิดอยู่
 * 🔴 แบบฟรีของ Google: ข้อมูลที่ส่งไปอาจถูกใช้พัฒนาผลิตภัณฑ์ · โควตาต่อวันไม่ประกาศแน่นอน
 *    → หน้าตั้งค่าบอกเจ้าของไว้ · โควตาหมด (429) = บอทถามยอดแบบเดิม ไม่ใช่พัง
 * 🔴 ทุกความล้มเหลวคืนผลแบบมีชนิด ไม่ throw — การอ่านสลิปเป็นตัวช่วย ห้ามทำให้การรับรูปล้ม
 */

const API = 'https://generativelanguage.googleapis.com/v1beta/models'
/** รุ่นแรกคือรุ่นเล็กที่มีแบบฟรี · ตัวที่สองเป็นชื่อเรียกรุ่นล่าสุด เผื่อ Google เลิกชื่อแรก (404) */
export const SLIP_AI_MODELS = ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest'] as const
const TIMEOUT_MS = 15_000
const KEY_TTL_MS = 5 * 60_000

export type SlipAiResult =
  | { ok: true; read: SlipRead }
  | { ok: false; reason: 'OFF' | 'UNREADABLE' | 'QUOTA' | 'KEY_REJECTED' | 'ERROR' }

let cached: { value: string | null; at: number } | null = null

export function clearSlipAiKey() {
  cached = null
}

async function slipAiKey(): Promise<string | null> {
  if (cached && Date.now() - cached.at < KEY_TTL_MS) return cached.value
  const { data, error } = await getSupabaseAdmin().rpc('_slip_ai_key')
  if (error) {
    // ยังไม่ได้รัน migration = ฟังก์ชันไม่มี → ถือว่าปิดอยู่ (ไม่ทำให้บอทรับรูปไม่ได้)
    console.error('[slip-ai] อ่านคีย์ไม่ได้', error.message)
    return null
  }
  const value = (data as string | null) ?? null
  cached = { value, at: Date.now() }
  return value
}

type Reply = { status: number; text: string | null; reason?: string }

/** คำตอบ error ของ Google → เหตุผลสั้น ๆ (ไม่มีคีย์ปน) · ไว้แยก "คีย์ผิด" ออกจาก "คำขอผิด" และเขียน log */
async function errorReason(res: Response): Promise<string> {
  const b = (await res.json().catch(() => null)) as {
    error?: { status?: string; message?: string; details?: { reason?: string }[] }
  } | null
  const reason = b?.error?.details?.find((d) => d.reason)?.reason ?? b?.error?.status ?? ''
  return `${reason} ${(b?.error?.message ?? '').slice(0, 160)}`.trim()
}

const KEY_PROBLEM = /API_KEY|PERMISSION_DENIED|UNAUTHENTICATED|SERVICE_DISABLED|BILLING/i

async function call(model: string, key: string, image: Buffer, mime: string): Promise<Reply> {
  const res = await fetch(`${API}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: mime, data: image.toString('base64') } }, { text: SLIP_PROMPT }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 1024 },
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) return { status: res.status, text: null, reason: await errorReason(res) }
  const body = (await res.json().catch(() => null)) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  } | null
  const text = body?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  return { status: res.status, text }
}

/** รูป (ไบต์ที่บีบแล้ว) → ยอด/วันที่/ผู้รับ/เลขอ้างอิง · `today` = วันนี้เวลาไทย (YYYY-MM-DD) */
export async function readSlip(image: Buffer, mime: string, today: string): Promise<SlipAiResult> {
  const key = await slipAiKey().catch(() => null)
  if (!key) return { ok: false, reason: 'OFF' }

  try {
    for (const model of SLIP_AI_MODELS) {
      const r = await call(model, key, image, mime)
      if (r.status === 404) continue // ชื่อรุ่นถูกเลิกใช้ → ลองตัวถัดไป
      if (r.status === 429) return { ok: false, reason: 'QUOTA' }
      if (r.text === null) {
        console.error('[slip-ai] Google ตอบผิดพลาด', r.status, model, r.reason ?? '')
        if (r.status === 401 || r.status === 403 || KEY_PROBLEM.test(r.reason ?? '')) return { ok: false, reason: 'KEY_REJECTED' }
        return { ok: false, reason: 'ERROR' }
      }
      const read = parseSlipReply(r.text, today)
      return read ? { ok: true, read } : { ok: false, reason: 'UNREADABLE' }
    }
    console.error('[slip-ai] ไม่พบรุ่นที่ใช้ได้', SLIP_AI_MODELS.join(','))
    return { ok: false, reason: 'ERROR' }
  } catch (e) {
    console.error('[slip-ai] เรียกไม่สำเร็จ', (e as Error).name)
    return { ok: false, reason: 'ERROR' }
  }
}

/** ปุ่มทดสอบในหน้าตั้งค่า — ยิงข้อความสั้น ๆ ด้วยคีย์ที่บันทึกไว้ (ไม่ส่งรูป · กินโควตา 1 ครั้ง) */
export async function pingSlipAi(): Promise<{ ok: true; model: string } | { ok: false; reason: 'OFF' | 'QUOTA' | 'KEY_REJECTED' | 'ERROR' }> {
  clearSlipAiKey()
  const key = await slipAiKey().catch(() => null)
  if (!key) return { ok: false, reason: 'OFF' }
  try {
    for (const model of SLIP_AI_MODELS) {
      const res = await fetch(`${API}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'ตอบคำว่า ok' }] }], generationConfig: { maxOutputTokens: 10 } }),
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (res.status === 404) continue
      if (res.ok) return { ok: true, model }
      if (res.status === 429) return { ok: false, reason: 'QUOTA' }
      const reason = await errorReason(res)
      console.error('[slip-ai] ทดสอบคีย์ไม่ผ่าน', res.status, model, reason)
      if (res.status === 401 || res.status === 403 || KEY_PROBLEM.test(reason)) return { ok: false, reason: 'KEY_REJECTED' }
      return { ok: false, reason: 'ERROR' }
    }
    return { ok: false, reason: 'ERROR' }
  } catch {
    return { ok: false, reason: 'ERROR' }
  }
}
