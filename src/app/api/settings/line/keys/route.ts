import { NextResponse, type NextRequest } from 'next/server'
import { clearLineKeys } from '@/lib/line/config'
import { denyUnlessLineOwner } from '@/lib/line/owner-guard'
import { getSupabaseServer } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * PUT /api/settings/line/keys — เจ้าของวาง Channel secret / Channel access token
 *
 * 🔴 คีย์ลง Supabase Vault ผ่าน `set_line_keys()` เท่านั้น · ไม่ log ไม่ส่งกลับ
 * ช่องที่ว่างคือ "คงค่าเดิม" — เปลี่ยนทีละตัวได้
 */
export async function PUT(req: NextRequest) {
  const denied = await denyUnlessLineOwner()
  if (denied) return denied

  let secret = ''
  let token = ''
  try {
    const b = await req.json()
    secret = String(b?.channelSecret ?? '').trim()
    token = String(b?.accessToken ?? '').trim()
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }
  if (!secret && !token) return NextResponse.json({ error: 'KEYS_EMPTY' }, { status: 400 })

  const sb = await getSupabaseServer()
  const { error } = await sb.rpc('set_line_keys', { p_secret: secret, p_token: token })
  if (error) {
    if (error.message.includes('line_key_invalid')) {
      const code = error.details === 'secret' ? 'SECRET_INVALID' : 'TOKEN_INVALID'
      return NextResponse.json({ error: code }, { status: 400 })
    }
    if (error.message.includes('FORBIDDEN')) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    console.error('[line-keys] บันทึกคีย์ไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'SAVE_FAILED' }, { status: 500 })
  }

  // ล้างแคชของ instance นี้ · instance อื่นหมดอายุเองภายใน 5 นาที
  // (webhook ที่ลายเซ็นไม่ตรงจะล้างแล้วลองใหม่เองอีกชั้น)
  clearLineKeys()
  return NextResponse.json({ ok: true })
}
