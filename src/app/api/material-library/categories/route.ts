import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { readJson } from '@/lib/plans-server'
import { CATALOG_LIMITS } from '@/lib/material-library'
import { catalogDbFail } from '@/lib/material-library-server'

export const runtime = 'nodejs'

const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : null)

/**
 * PATCH /api/material-library/categories — เปลี่ยนชื่อหมวด / ลบหมวด ของวัสดุในคลัง (เจ้าของ · 11 พ.ย. 2569)
 * body `{ from, to }` · `to` ว่าง = ลบหมวด (วัสดุทุกตัวในหมวดนั้นกลายเป็นไม่มีหมวด · ไม่ลบวัสดุ)
 * · หมวดคือข้อความที่ติดกับวัสดุ ไม่มีตารางหมวดแยก — แก้ทุกแถวที่มีหมวด `from` (รวมที่ซ่อนไว้) · เรียกจากปุ่มข้างตัวกรองหมวดหน้าคลังวัสดุ
 */
export async function PATCH(req: NextRequest) {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const body = await readJson(req)
  const from = clean(body?.from)
  const to = clean(body?.to)
  if (!from || to === null || from.length > CATALOG_LIMITS.category || to.length > CATALOG_LIMITS.category) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }
  if (from === to) return NextResponse.json({ ok: true, changed: 0 })

  const sb = await getSupabaseServer()
  const { data, error } = await sb.from('material_catalog').update({ category: to }).eq('category', from).select('id')
  if (error) return catalogDbFail('เปลี่ยนหมวดไม่ได้', error, 'SAVE_FAILED')
  return NextResponse.json({ ok: true, changed: data?.length ?? 0 })
}
