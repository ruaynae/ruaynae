import 'server-only'
import { NextResponse } from 'next/server'
import type { getSupabaseServer } from '@/lib/supabase/server'
import { headObject, presignGet } from '@/lib/r2'
import { searchTerms } from '@/lib/search-core'
import { CATALOG_LIMITS, catalogMessage, type CatalogItem } from '@/lib/material-library'

type Sb = Awaited<ReturnType<typeof getSupabaseServer>>

/** ตาราง/คอลัมน์ยังไม่ถูกสร้าง (ยังไม่รัน migration `20261103090000_r27_material_library.sql`) */
export const isCatalogMissing = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === 'PGRST205' || e.code === '42P01' || e.code === '42703' || e.code === 'PGRST204')

export type CatalogItemView = CatalogItem & { thumbUrl: string }

/** ตอบข้อผิดพลาดของฐานข้อมูล: ลบหน้าที่หนังสือใช้อยู่ = 409 · ยังไม่รัน migration = 503 · อื่น ๆ = 500 */
export function catalogDbFail(tag: string, e: { code?: string; message?: string }, code: string) {
  if (e.message?.includes('CATALOG_IN_USE')) return NextResponse.json({ error: 'CATALOG_IN_USE' }, { status: 409 })
  if (isCatalogMissing(e)) return NextResponse.json({ error: 'CATALOG_TABLE_MISSING' }, { status: 503 })
  console.error(`[material-library] ${tag}`, e.message)
  return NextResponse.json({ error: code }, { status: 500 })
}

export { catalogMessage }

type Row = {
  id: string
  name: string
  category: string
  detail: string
  note: string
  is_active: boolean
  material_catalog_pages: { id: string; object_key: string; seq: number }[] | null
}

export const CATALOG_SELECT = 'id, name, category, detail, note, is_active, material_catalog_pages(id, object_key, seq)'

/** แถว → รายการ (หน้าเรียงตาม seq) + ลิงก์รูปหน้าแรก (presigned 1 ชม. · R2 ล่ม = ไม่มีลิงก์ ไม่ใช่หน้าพัง) */
export async function toCatalogView(r: Row): Promise<CatalogItemView> {
  const pages = [...(r.material_catalog_pages ?? [])].sort((a, b) => a.seq - b.seq).map((p) => ({ id: p.id, key: p.object_key, seq: p.seq }))
  const thumbUrl = pages[0] ? await presignGet(pages[0].key).catch(() => '') : ''
  return { id: r.id, name: r.name, category: r.category, detail: r.detail, note: r.note, isActive: r.is_active, pages, thumbUrl }
}

/**
 * รายการในคลัง — เรียงตามชื่อ · ค้นจากชื่อ · กรองหมวด
 * 🔴 `q` ผ่าน `searchTerms` (แยกคำ ตัดอักขระไวลด์การ์ด) แล้วต่อ `.ilike()` ทีละคำ (§7)
 */
export async function loadCatalog(
  sb: Sb,
  opts: { q?: string; category?: string; includeInactive?: boolean } = {},
): Promise<{ items: CatalogItemView[]; missing: boolean; failed: boolean }> {
  let query = sb.from('material_catalog').select(CATALOG_SELECT)
  if (!opts.includeInactive) query = query.eq('is_active', true)
  if (opts.category) query = query.eq('category', opts.category)
  // ค้นจากชื่อวัสดุ — ไม่ใช้ `.or()` กับช่องค้นหา (คอมมาในคำค้นกลายเป็นเงื่อนไขที่สอง · CLAUDE.md §7)
  for (const t of searchTerms(opts.q ?? '')) query = query.ilike('name', `%${t}%`)
  const { data, error } = await query.order('name', { ascending: true }).order('id').range(0, CATALOG_LIMITS.list - 1)
  if (error) {
    const missing = isCatalogMissing(error)
    if (!missing) console.error('[material-library] อ่านคลังไม่ได้', error.message)
    return { items: [], missing, failed: !missing }
  }
  return { items: await Promise.all(((data ?? []) as Row[]).map(toCatalogView)), missing: false, failed: false }
}

export async function loadCatalogItem(sb: Sb, id: string): Promise<CatalogItemView | null | 'error' | 'missing'> {
  const { data, error } = await sb.from('material_catalog').select(CATALOG_SELECT).eq('id', id).maybeSingle()
  if (error) return isCatalogMissing(error) ? 'missing' : 'error'
  return data ? toCatalogView(data as Row) : null
}

/** รูปตราประทับปัจจุบัน — ยังไม่รัน migration/ยังไม่ตั้ง = ไม่มี (ไม่ใช่หน้าพัง) */
export async function loadStamp(sb: Sb): Promise<{ key: string | null; url: string | null }> {
  const { data, error } = await sb.from('material_library_settings').select('stamp_object_key').eq('id', true).maybeSingle()
  if (error) {
    if (!isCatalogMissing(error)) console.error('[material-library] อ่านตราประทับไม่ได้', error.message)
    return { key: null, url: null }
  }
  const key = data?.stamp_object_key ?? null
  return { key, url: key ? await presignGet(key).catch(() => null) : null }
}

/**
 * ตรวจไฟล์ใหม่ที่เพิ่งอัปขึ้น R2: ต้องมี `upload_intents` ของคนนี้ที่ยังไม่ถูกใช้ และถาม R2 เองว่ามีจริงเท่าไร
 * 🔴 กันอ้างคีย์ของคนอื่น/คีย์ที่ไม่เคยอัป · RLS ของ upload_intents เห็นแค่ของตัวเอง
 */
export async function claimUploads(
  sb: Sb,
  keys: string[],
): Promise<{ ok: true; sizes: Map<string, number>; intentIds: string[] } | { ok: false; res: NextResponse }> {
  const sizes = new Map<string, number>()
  const intentIds: string[] = []
  for (const key of keys) {
    const { data: intent, error } = await sb.from('upload_intents').select('id').eq('object_key', key).is('consumed_at', null).maybeSingle()
    if (error) return { ok: false, res: catalogDbFail('อ่าน upload_intents ไม่ได้', error, 'SAVE_FAILED') }
    if (!intent) return { ok: false, res: NextResponse.json({ error: 'INTENT_NOT_FOUND' }, { status: 404 }) }
    const head = await headObject(key)
    if (!head || head.size <= 0) return { ok: false, res: NextResponse.json({ error: 'FILE_NOT_UPLOADED' }, { status: 422 }) }
    sizes.set(key, head.size)
    intentIds.push(intent.id)
  }
  return { ok: true, sizes, intentIds }
}

export async function consumeUploads(sb: Sb, intentIds: string[]) {
  if (!intentIds.length) return
  const { error } = await sb.from('upload_intents').update({ consumed_at: new Date().toISOString() }).in('id', intentIds)
  if (error) console.error('[material-library] ปิด upload_intents ไม่สำเร็จ', error.message)
}
