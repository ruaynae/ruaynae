import { NextResponse } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { mrErrorResponse } from '@/lib/materials-server'
import { getSupabaseServer } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/** POST /api/materials/[id]/issue — RPC `material_request_issue` เช็คบทบาทเอง (R18) */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })
  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'MR_NOT_FOUND' }, { status: 404 })
  const sb = await getSupabaseServer()
  const { data, error } = await sb.rpc('material_request_issue', { p_id: id })
  if (error) return mrErrorResponse(error.message, 'issue ไม่สำเร็จ')
  return NextResponse.json({ ok: true, ...(data as Record<string, unknown>) })
}
