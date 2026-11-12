import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/transactions'
import { presignGet } from '@/lib/r2'
import { billDbFail } from '@/lib/bills-server'

export const runtime = 'nodejs'

/** GET /api/bills/[id]/file — 302 ไปยังรูปบิล (presigned GET อายุ 1 ชม.) · เจ้าของ (R41 · §9) */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'BILL_NOT_FOUND' }, { status: 404 })
  const sb = await getSupabaseServer()
  const { data, error } = await sb.from('bills').select('object_key').eq('id', id).maybeSingle()
  if (error) return billDbFail('อ่านบิลไม่ได้', error)
  if (!data) return NextResponse.json({ error: 'BILL_NOT_FOUND' }, { status: 404 })
  return NextResponse.redirect(await presignGet(data.object_key), 302)
}
