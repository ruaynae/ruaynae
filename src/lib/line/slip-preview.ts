import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * ลิงก์รูปสลิปในการ์ดยืนยันของบอท (31 ต.ค. 2569 · เจ้าของต้องเลื่อนขึ้นลงหาสลิปตอนยืนยันยอด)
 *
 * LINE ดึงรูปเองโดยไม่มีคุกกี้ → ลิงก์ต้องพกลายเซ็นของตัวเอง (HMAC + วันหมดอายุ)
 * 🔴 ใช้ CRON_SECRET เป็นกุญแจ แต่แยกโดเมนด้วยคำนำหน้า — ลายเซ็นนี้เอาไปเรียก cron ไม่ได้
 * 🔴 รับเฉพาะคีย์ใต้ `slips/` — ลิงก์ที่หลุดออกไปเปิดได้แค่รูปสลิปใบนั้น จนหมดอายุ
 */

const PREFIX = 'line-slip-preview:'
const TTL_SEC = 7 * 24 * 60 * 60

let origin: string | null = null

/** webhook ตั้งค่าที่อยู่เว็บจากคำขอของ LINE (https เท่านั้น — LINE ไม่รับรูปจาก http) */
export function setPublicOrigin(o: string | null) {
  if (o && o.startsWith('https://')) origin = o.replace(/\/+$/, '')
}

function sign(key: string, exp: number, secret: string) {
  return createHmac('sha256', secret).update(`${PREFIX}${key}|${exp}`).digest('base64url')
}

export const isSlipKey = (k: string) => /^slips\/[\w./-]+\.webp$/.test(k) && !k.includes('..')

/** ลิงก์รูปตัวอย่าง · null = ยังไม่รู้ที่อยู่เว็บ หรือไม่มีกุญแจ (การ์ดจะไม่มีรูป แต่ยังใช้งานได้) */
export function slipPreviewUrl(key: string | undefined): string | null {
  const secret = process.env.CRON_SECRET
  if (!origin || !secret || !key || !isSlipKey(key)) return null
  const exp = Math.floor(Date.now() / 1000) + TTL_SEC
  const q = new URLSearchParams({ k: key, e: String(exp), s: sign(key, exp, secret) })
  return `${origin}/api/line/slip-preview?${q.toString()}`
}

export function slipPreviewOk(key: string, exp: string, sig: string): boolean {
  const secret = process.env.CRON_SECRET
  const e = Number(exp)
  if (!secret || !isSlipKey(key) || !Number.isInteger(e) || e < Date.now() / 1000) return false
  const want = Buffer.from(sign(key, e, secret))
  const got = Buffer.from(sig)
  return want.length === got.length && timingSafeEqual(want, got)
}
