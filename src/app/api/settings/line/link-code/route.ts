import { NextResponse } from 'next/server'
import { denyUnlessLineOwner } from '@/lib/line/owner-guard'
import { getSupabaseServer } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/** POST /api/settings/line/link-code — ออกรหัส 6 หลัก (อายุ 10 นาที) ให้พิมพ์ในแชท LINE */
export async function POST() {
  const denied = await denyUnlessLineOwner()
  if (denied) return denied

  const sb = await getSupabaseServer()
  const { data, error } = await sb.rpc('create_line_link_code')
  if (error || typeof data !== 'string') {
    console.error('[line-link] ออกรหัสไม่สำเร็จ', error?.message ?? 'no data')
    return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, code: data, expiresInMinutes: 10 })
}
