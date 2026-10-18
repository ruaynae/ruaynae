import { NextResponse, type NextRequest } from 'next/server'
import { clearLoyverseToken } from '@/lib/loyverse/client'
import { denyUnlessOwner } from '@/lib/loyverse/owner-guard'
import { getSupabaseServer } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * PUT /api/settings/loyverse/token — เจ้าของวาง Access token ของ Loyverse (R18)
 * 🔴 ลง Supabase Vault ผ่าน `set_loyverse_token()` เท่านั้น · ไม่ log ไม่ส่งกลับ
 */
export async function PUT(req: NextRequest) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  let token = ''
  try {
    const b = await req.json()
    token = String(b?.token ?? '').trim()
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }
  if (!token) return NextResponse.json({ error: 'TOKEN_EMPTY' }, { status: 400 })

  const sb = await getSupabaseServer()
  const { error } = await sb.rpc('set_loyverse_token', { p_token: token })
  if (error) {
    if (error.message.includes('loyverse_token_invalid')) {
      return NextResponse.json({ error: 'TOKEN_INVALID' }, { status: 400 })
    }
    if (error.message.includes('FORBIDDEN')) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    console.error('[loyverse-token] บันทึกไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'SAVE_FAILED' }, { status: 500 })
  }
  clearLoyverseToken()
  return NextResponse.json({ ok: true })
}
