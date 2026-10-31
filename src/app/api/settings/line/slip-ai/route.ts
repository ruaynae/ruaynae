import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessLineOwner } from '@/lib/line/owner-guard'
import { clearSlipAiKey, pingSlipAi } from '@/lib/slip-ai/gemini'
import { getSupabaseServer } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * PUT /api/settings/line/slip-ai { key } — เจ้าของวางคีย์ Gemini API สำหรับอ่านสลิปในบอท
 * · key ว่าง = ปิดการอ่านสลิป
 * 🔴 คีย์ลง Supabase Vault ผ่าน `set_slip_ai_key()` เท่านั้น · ไม่ log ไม่ส่งกลับ
 */
export async function PUT(req: NextRequest) {
  const denied = await denyUnlessLineOwner()
  if (denied) return denied

  let key = ''
  try {
    const b = await req.json()
    key = String(b?.key ?? '').trim()
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const sb = await getSupabaseServer()
  const { error } = await sb.rpc('set_slip_ai_key', { p_key: key })
  if (error) {
    if (error.message.includes('slip_ai_key_invalid')) return NextResponse.json({ error: 'KEY_INVALID' }, { status: 400 })
    if (error.message.includes('FORBIDDEN')) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    if (error.message.includes('set_slip_ai_key')) return NextResponse.json({ error: 'NOT_INSTALLED' }, { status: 503 })
    console.error('[slip-ai-key] บันทึกไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'SAVE_FAILED' }, { status: 500 })
  }
  clearSlipAiKey()
  return NextResponse.json({ ok: true, enabled: key.length > 0 })
}

/** POST /api/settings/line/slip-ai — ปุ่มทดสอบคีย์ที่บันทึกไว้ (กินโควตา 1 ครั้ง) */
export async function POST() {
  const denied = await denyUnlessLineOwner()
  if (denied) return denied
  const r = await pingSlipAi()
  if (r.ok) return NextResponse.json({ ok: true, model: r.model })
  const status = r.reason === 'OFF' ? 409 : r.reason === 'ERROR' ? 502 : 400
  return NextResponse.json({ error: r.reason }, { status })
}
