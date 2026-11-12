import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { readJson } from '@/lib/plans-server'
import { claimUploads, consumeUploads } from '@/lib/material-library-server'
import { billDbFail } from '@/lib/bills-server'

export const runtime = 'nodejs'

const MAX_FILES = 50
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

/**
 * POST /api/bills — ลงทะเบียนบิลที่เพิ่งอัปเข้า R2 (`/api/uploads/sign` purpose `bill`) · เจ้าของเท่านั้น (R41)
 * body `{ files: [{ key, contentType, fileName, pageNo? }] }` (≤ 50 ต่อครั้ง) → `{ ids }` ตามลำดับที่ส่ง
 * · ยังไม่อ่านด้วย AI — หน้าจอเรียก `POST /api/bills/[id]/read` ทีละใบต่อ (โควตาแบบฟรีจำกัดต่อนาที)
 */
export async function POST(req: NextRequest) {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const body = await readJson(req)
  const list = Array.isArray(body?.files) ? (body.files as unknown[]) : null
  if (!list || !list.length || list.length > MAX_FILES) return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  const files: { key: string; contentType: string; fileName: string; pageNo: number | null }[] = []
  for (const f of list) {
    const o = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>
    const key = typeof o.key === 'string' && /^bills\/[\w-]+\.(jpg|png|webp)$/.test(o.key) ? o.key : null
    const contentType = typeof o.contentType === 'string' && TYPES.has(o.contentType) ? o.contentType : null
    if (!key || !contentType) return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
    const pageNo = Number.isInteger(o.pageNo) && (o.pageNo as number) >= 1 && (o.pageNo as number) <= 999 ? (o.pageNo as number) : null
    files.push({ key, contentType, fileName: typeof o.fileName === 'string' ? o.fileName.slice(0, 300) : '', pageNo })
  }
  const sb = await getSupabaseServer()
  const claimed = await claimUploads(sb, files.map((f) => f.key))
  if (!claimed.ok) return claimed.res
  const { data, error } = await sb
    .from('bills')
    .insert(files.map((f) => ({
      object_key: f.key, content_type: f.contentType, byte_size: claimed.sizes.get(f.key) ?? 1,
      file_name: f.fileName, page_no: f.pageNo, source: 'web',
    })))
    .select('id, object_key')
  if (error) return billDbFail('บันทึกบิลไม่ได้', error)
  await consumeUploads(sb, claimed.intentIds)
  const byKey = new Map((data ?? []).map((r) => [r.object_key, r.id]))
  return NextResponse.json({ ok: true, ids: files.map((f) => byKey.get(f.key) ?? null) }, { status: 201 })
}
