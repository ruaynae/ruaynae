import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { deleteObject } from '@/lib/r2'
import { readJson } from '@/lib/plans-server'
import { isCatalogKey } from '@/lib/material-library'
import { catalogDbFail, claimUploads, consumeUploads, loadStamp } from '@/lib/material-library-server'

export const runtime = 'nodejs'

/** GET /api/material-library/stamp — ตราประทับปัจจุบัน `{ url }` (เจ้าของ) */
export async function GET() {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const sb = await getSupabaseServer()
  return NextResponse.json({ url: (await loadStamp(sb)).url })
}

/**
 * PUT /api/material-library/stamp — ตั้ง/เปลี่ยน/เอาตราประทับออก (เจ้าของ)
 * body `{ key }` (ไฟล์ที่เพิ่งอัป purpose `catalog`) หรือ `{ key: null }` = เอาออก · ไฟล์เดิมถูกลบจาก R2
 */
export async function PUT(req: NextRequest) {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const body = await readJson(req)
  if (!body || !('key' in body) || (body.key !== null && !isCatalogKey(body.key))) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }
  const key = body.key as string | null
  const sb = await getSupabaseServer()
  const before = await loadStamp(sb)
  if (before.key === key) return NextResponse.json({ ok: true })

  let intentIds: string[] = []
  if (key) {
    const claimed = await claimUploads(sb, [key])
    if (!claimed.ok) return claimed.res
    intentIds = claimed.intentIds
  }
  const { data, error } = await sb
    .from('material_library_settings')
    .upsert({ id: true, stamp_object_key: key })
    .select('stamp_object_key')
    .maybeSingle()
  if (error) return catalogDbFail('บันทึกตราประทับไม่ได้', error, 'SAVE_FAILED')
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  await consumeUploads(sb, intentIds)
  if (before.key) await deleteObject(before.key).catch((e) => console.error('[material-library] ลบตราประทับเดิมไม่ได้', e instanceof Error ? e.message : e))
  return NextResponse.json({ ok: true })
}
