import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { deleteObject, presignGet } from '@/lib/r2'
import { readJson } from '@/lib/plans-server'
import { isUuid } from '@/lib/transactions'
import type { Database } from '@/lib/database.types'
import { CATALOG_LIMITS, isCatalogKey, parseCatalogMeta } from '@/lib/material-library'
import { catalogDbFail, claimUploads, consumeUploads, loadCatalogItem } from '@/lib/material-library-server'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

/** GET /api/material-library/[id] — วัสดุ 1 รายการ + หน้าแค็ตตาล็อกพร้อมลิงก์ดู (presigned 1 ชม.) */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'CATALOG_NOT_FOUND' }, { status: 404 })
  const sb = await getSupabaseServer()
  const item = await loadCatalogItem(sb, id)
  if (item === 'missing') return NextResponse.json({ error: 'CATALOG_TABLE_MISSING' }, { status: 503 })
  if (item === 'error') return NextResponse.json({ error: 'LOAD_FAILED' }, { status: 500 })
  if (!item) return NextResponse.json({ error: 'CATALOG_NOT_FOUND' }, { status: 404 })
  const pages = await Promise.all(item.pages.map(async (p) => ({ ...p, url: await presignGet(p.key).catch(() => '') })))
  return NextResponse.json({ item: { ...item, pages } })
}

/**
 * PATCH /api/material-library/[id] — แก้วัสดุ (เจ้าของ)
 * body: `name/category/detail/note` (ส่งมาทั้งชุดเมื่อแก้ข้อมูล) · `isActive` (ซ่อน/แสดง) · `pages: [{ key }]` = รายการหน้าทั้งชุดตามลำดับใหม่
 * · คีย์ใหม่ = ไฟล์ที่เพิ่งอัป (ต้องมี upload_intents) · คีย์เดิม = คงไว้/เรียงใหม่ · ที่หายไป = ลบ
 * · 🔴 หน้าที่หนังสือยังใช้อยู่ลบไม่ได้ (trigger → 409 `CATALOG_IN_USE`) — การลบเป็นคำสั่งเดียว ล้ม = ไม่มีหน้าไหนถูกลบ
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'CATALOG_NOT_FOUND' }, { status: 404 })
  const body = await readJson(req)
  if (!body) return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })

  const patch: Database['public']['Tables']['material_catalog']['Update'] = {}
  if ('name' in body) {
    const meta = parseCatalogMeta(body)
    if (!meta.ok) return NextResponse.json({ error: meta.error }, { status: 422 })
    Object.assign(patch, meta.value)
  }
  if ('isActive' in body) {
    if (typeof body.isActive !== 'boolean') return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
    patch.is_active = body.isActive
  }
  let keys: string[] | null = null
  if ('pages' in body) {
    const list = Array.isArray(body.pages) ? body.pages : null
    if (!list) return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
    if (list.length > CATALOG_LIMITS.pages) return NextResponse.json({ error: 'CATALOG_PAGES_TOO_MANY' }, { status: 422 })
    const ks = list.map((p) => (p && typeof p === 'object' ? (p as { key?: unknown }).key : null))
    if (!ks.every(isCatalogKey) || new Set(ks).size !== ks.length) return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
    keys = ks
  }
  if (!Object.keys(patch).length && !keys) return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })

  const sb = await getSupabaseServer()
  const { data: exists, error: eErr } = await sb.from('material_catalog').select('id').eq('id', id).maybeSingle()
  if (eErr) return catalogDbFail('อ่านวัสดุไม่ได้', eErr, 'SAVE_FAILED')
  if (!exists) return NextResponse.json({ error: 'CATALOG_NOT_FOUND' }, { status: 404 })

  let removedKeys: string[] = []
  let intentIds: string[] = []
  if (keys) {
    const { data: cur, error: cErr } = await sb.from('material_catalog_pages').select('id, object_key, seq').eq('item_id', id).order('seq').range(0, 998)
    if (cErr) return catalogDbFail('อ่านหน้าแค็ตตาล็อกไม่ได้', cErr, 'SAVE_FAILED')
    const existing = cur ?? []
    const have = new Set(existing.map((p) => p.object_key))
    const want = new Set(keys)
    const fresh = keys.filter((k) => !have.has(k))
    const removed = existing.filter((p) => !want.has(p.object_key))

    const claimed = await claimUploads(sb, fresh)
    if (!claimed.ok) return claimed.res
    intentIds = claimed.intentIds

    if (removed.length) {
      const { error } = await sb.from('material_catalog_pages').delete().in('id', removed.map((p) => p.id))
      if (error) return catalogDbFail('ลบหน้าแค็ตตาล็อกไม่ได้', error, 'SAVE_FAILED')
      removedKeys = removed.map((p) => p.object_key)
    }

    // เรียงลำดับใหม่: (item_id, seq) ต้องไม่ชนกันระหว่างทาง → ย้ายแถวที่ลำดับเปลี่ยนไปพักที่ 500+ ก่อน แล้วค่อยวางตำแหน่งจริง
    const target = new Map(keys.map((k, i) => [k, i + 1]))
    const moving = existing.filter((p) => want.has(p.object_key) && target.get(p.object_key) !== p.seq)
    for (const p of moving) {
      const { error } = await sb.from('material_catalog_pages').update({ seq: 500 + (target.get(p.object_key) ?? 0) }).eq('id', p.id)
      if (error) return catalogDbFail('เรียงหน้าแค็ตตาล็อกไม่ได้', error, 'SAVE_FAILED')
    }
    for (const p of moving) {
      const { error } = await sb.from('material_catalog_pages').update({ seq: target.get(p.object_key) ?? p.seq }).eq('id', p.id)
      if (error) return catalogDbFail('เรียงหน้าแค็ตตาล็อกไม่ได้', error, 'SAVE_FAILED')
    }
    if (fresh.length) {
      const { error } = await sb.from('material_catalog_pages').insert(
        fresh.map((key) => ({ item_id: id, seq: target.get(key) ?? 1, object_key: key, byte_size: claimed.sizes.get(key) ?? 0 })),
      )
      if (error) return catalogDbFail('บันทึกหน้าแค็ตตาล็อกไม่ได้', error, 'SAVE_FAILED')
    }
  }

  if (Object.keys(patch).length) {
    const { data, error } = await sb.from('material_catalog').update(patch).eq('id', id).select('id').maybeSingle()
    if (error) return catalogDbFail('แก้วัสดุไม่ได้', error, 'SAVE_FAILED')
    if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  } else {
    // แก้แต่หน้า — ขยับเวลาแก้ไขให้ตรงความจริง
    await sb.from('material_catalog').update({ updated_at: new Date().toISOString() }).eq('id', id)
  }
  await consumeUploads(sb, intentIds)
  // แถวหายแล้ว ไฟล์ค้างแค่กินที่ จึง log อย่างเดียว
  for (const k of removedKeys) await deleteObject(k).catch((e) => console.error('[material-library] ลบไฟล์ไม่ได้', k, e instanceof Error ? e.message : e))
  return NextResponse.json({ ok: true })
}

/** DELETE /api/material-library/[id] — ลบวัสดุพร้อมแค็ตตาล็อก (เจ้าของ) · มีหนังสือใช้อยู่ = 409 `CATALOG_IN_USE` (ซ่อนแทน) */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'CATALOG_NOT_FOUND' }, { status: 404 })
  const sb = await getSupabaseServer()
  const { data: pages, error: pErr } = await sb.from('material_catalog_pages').select('object_key').eq('item_id', id).range(0, 998)
  if (pErr) return catalogDbFail('อ่านหน้าแค็ตตาล็อกไม่ได้', pErr, 'DELETE_FAILED')
  const { data, error } = await sb.from('material_catalog').delete().eq('id', id).select('id')
  if (error) return catalogDbFail('ลบวัสดุไม่ได้', error, 'DELETE_FAILED')
  if (!data?.length) return NextResponse.json({ error: 'CATALOG_NOT_FOUND' }, { status: 404 })
  for (const p of pages ?? []) {
    await deleteObject(p.object_key).catch((e) => console.error('[material-library] ลบไฟล์ไม่ได้', p.object_key, e instanceof Error ? e.message : e))
  }
  return NextResponse.json({ ok: true })
}
