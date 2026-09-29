import { after, NextResponse, type NextRequest } from 'next/server'
import { clearLineKeys, lineSecret } from '@/lib/line/config'
import { signatureOk } from '@/lib/line/signature'
import { handleEvents } from '@/lib/line/bot/handle'
import type { LineEvent } from '@/lib/line/bot/types'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * POST /api/line/webhook — LINE ยิงเข้ามาทุกครั้งที่เจ้าของพิมพ์/กดในแชท
 *
 * 🔴 ตรวจลายเซ็นจาก **ไบต์ดิบ** ก่อน JSON.parse เสมอ — parse แล้ว stringify ใหม่
 * จะได้ไบต์คนละชุดและลายเซ็นไม่มีวันตรง
 * 🔴 ตอบ 200 ทันทีแล้วทำงานใน after() — LINE ถือว่าเกิน ~1 วินาทีคือล้มเหลวแล้วส่งซ้ำ
 * (ส่งซ้ำถูกกันด้วย bot_event_seen)
 * คีย์อยู่ใน Vault (เจ้าของกรอกที่หน้าตั้งค่า) ไม่ใช่ env · ยังไม่ตั้ง = 503
 */
export async function POST(req: NextRequest) {
  const raw = await req.text()
  const header = req.headers.get('x-line-signature')

  let secret = await lineSecret()
  if (!secret) return NextResponse.json({ error: 'NOT_CONFIGURED' }, { status: 503 })

  let ok = signatureOk(raw, header, secret)
  if (!ok) {
    // เจ้าของเพิ่งเปลี่ยนคีย์ แคชอาจยังเป็นค่าเก่า — ล้างแล้วลองอีกรอบเดียว
    clearLineKeys()
    secret = await lineSecret()
    ok = !!secret && signatureOk(raw, header, secret)
  }
  if (!ok) return NextResponse.json({ error: 'BAD_SIGNATURE' }, { status: 401 })

  let events: LineEvent[] = []
  try {
    const body = JSON.parse(raw) as { events?: LineEvent[] }
    events = Array.isArray(body.events) ? body.events : []
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  after(async () => {
    try {
      await handleEvents(events)
    } catch (e) {
      console.error('[line] webhook failed', e instanceof Error ? e.message : '')
    }
  })
  return NextResponse.json({ ok: true })
}
