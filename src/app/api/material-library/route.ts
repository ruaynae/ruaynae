import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner, getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { readJson } from '@/lib/plans-server'
import { CATALOG_LIMITS, isCatalogKey, parseCatalogMeta } from '@/lib/material-library'
import { catalogDbFail, claimUploads, consumeUploads, loadCatalog } from '@/lib/material-library-server'

export const runtime = 'nodejs'

/**
 * GET /api/material-library?q=&category=&all=1 — รายการในคลัง (เจ้าของ · ปุ่ม "เลือกจากคลัง" ในหนังสือ)
 * `all=1` รวมที่ซ่อนไว้ · หน้าแรกของรายการ 500 รายการ เรียงตามชื่อ
 */
export async function GET(req: NextRequest) {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const sp = req.nextUrl.searchParams
  const sb = await getSupabaseServer()
  const r = await loadCatalog(sb, {
    q: (sp.get('q') ?? '').slice(0, 60),
    category: (sp.get('category') ?? '').slice(0, CATALOG_LIMITS.category) || undefined,
    includeInactive: sp.get('all') === '1',
  })
  if (r.missing) return NextResponse.json({ error: 'CATALOG_TABLE_MISSING' }, { status: 503 })
  if (r.failed) return NextResponse.json({ error: 'LOAD_FAILED' }, { status: 500 })
  return NextResponse.json({ items: r.items })
}

/**
 * POST /api/material-library — เพิ่มวัสดุเข้าคลัง (เจ้าของ)
 * body `{ name, category?, detail?, note?, pages?: [{ key }] }` — `key` มาจาก POST /api/uploads/sign (purpose `catalog`) หลัง PUT สำเร็จ
 */
export async function POST(req: NextRequest) {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const body = await readJson(req)
  if (!body) return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  const meta = parseCatalogMeta(body)
  if (!meta.ok) return NextResponse.json({ error: meta.error }, { status: 422 })

  const list = body.pages === undefined ? [] : Array.isArray(body.pages) ? body.pages : null
  if (!list) return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  if (list.length > CATALOG_LIMITS.pages) return NextResponse.json({ error: 'CATALOG_PAGES_TOO_MANY' }, { status: 422 })
  const keys = list.map((p) => (p && typeof p === 'object' ? (p as { key?: unknown }).key : null))
  if (!keys.every(isCatalogKey) || new Set(keys).size !== keys.length) return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })

  const sb = await getSupabaseServer()
  const claimed = await claimUploads(sb, keys)
  if (!claimed.ok) return claimed.res

  const me = await getCurrentUser()
  const { data: item, error } = await sb
    .from('material_catalog')
    .insert({ ...meta.value, created_by: me.id })
    .select('id')
    .maybeSingle()
  if (error) return catalogDbFail('เพิ่มวัสดุไม่ได้', error, 'SAVE_FAILED')
  if (!item) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  if (keys.length) {
    const { error: pErr } = await sb.from('material_catalog_pages').insert(
      keys.map((key, i) => ({ item_id: item.id, seq: i + 1, object_key: key, byte_size: claimed.sizes.get(key) ?? 0 })),
    )
    if (pErr) {
      // ไม่ทิ้งวัสดุที่ไม่มีแค็ตตาล็อกไว้ครึ่งทาง — ผู้ใช้กดบันทึกใหม่ได้ (ไฟล์ที่อัปแล้วยังอยู่ใน intents ที่ยังไม่ถูกใช้)
      await sb.from('material_catalog').delete().eq('id', item.id)
      return catalogDbFail('บันทึกหน้าแค็ตตาล็อกไม่ได้', pErr, 'SAVE_FAILED')
    }
  }
  await consumeUploads(sb, claimed.intentIds)
  return NextResponse.json({ ok: true, id: item.id }, { status: 201 })
}
