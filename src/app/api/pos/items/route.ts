import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * GET /api/pos/items?q= — ค้นหาสินค้าจากสำเนา Loyverse สำหรับฟอร์มใบขอเบิก (R18)
 * 🔴 ไม่มีทุน/ราคาในคำตอบ — RPC `pos_item_search` เลือกคอลัมน์ให้เอง (หัวหน้าโครงการห้ามเห็นทุน)
 */
export async function GET(req: NextRequest) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 80)
  const sb = await getSupabaseServer()
  const { data, error } = await sb.rpc('pos_item_search', { p_q: q, p_limit: 20 })
  if (error) {
    if (error.message.includes('FORBIDDEN')) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
    console.error('[pos-items] ค้นหาไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'FAILED' }, { status: 500 })
  }
  return NextResponse.json({ items: data ?? [] })
}
