import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { deleteObject, presignGetFile } from '@/lib/r2'
import { isUuid } from '@/lib/transactions'
import { fileTypeOf, metaRow, parseFileMeta } from '@/lib/files'
import { filesDbFail } from '@/lib/files-server'
import { readJson } from '@/lib/plans-server'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

/**
 * GET /api/files/[id] — เปิดไฟล์ (ปุ่ม "เปิด") · `?download=1` = ดาวน์โหลด (ปุ่ม "ดาวน์โหลด")
 * ตอบ 302 ไป presigned GET อายุ 1 ชม. · 🔴 R2 ไม่มี RLS — สิทธิ์ตัดสินด้วยการอ่านแถวผ่าน RLS ที่นี่
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  const sb = await getSupabaseServer()
  const { data, error } = await sb.from('project_files').select('object_key, file_name, content_type').eq('id', id).maybeSingle()
  if (error) return filesDbFail('อ่านเอกสารไม่ได้', error, 'READ_FAILED')
  if (!data) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  const t = fileTypeOf(data.file_name)
  const inline = new URL(req.url).searchParams.get('download') !== '1' && t?.inline === true
  return NextResponse.redirect(await presignGetFile(data.object_key, data.file_name, t?.type ?? 'application/octet-stream', inline), 302)
}

/** PATCH /api/files/[id] — แก้ข้อมูลประกอบ (กล่อง "แก้ไข") · ไฟล์เองเปลี่ยนไม่ได้ (guard ที่ฐานข้อมูล) */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  const body = await readJson(req)
  if (!body) return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  const meta = parseFileMeta(body)
  if (!meta.ok) return NextResponse.json({ error: meta.error }, { status: 422 })
  const sb = await getSupabaseServer()
  const { data, error } = await sb.from('project_files').update(metaRow(meta.value)).eq('id', id).select('id').maybeSingle()
  if (error) {
    if (error.code === '23503') return NextResponse.json({ error: 'SITE_NOT_FOUND' }, { status: 422 })
    return filesDbFail('แก้เอกสารไม่สำเร็จ', error, 'UPDATE_FAILED')
  }
  // 0 แถว = ไม่มีแถวนี้ หรือ RLS ปฏิเสธ — ไม่ใช่ "สำเร็จ" (§17 ข้อ 18)
  if (!data) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

/** DELETE /api/files/[id] — ลบเอกสาร (ปุ่ม "ลบ" + กล่องยืนยัน) · ลบแถวก่อน แล้วค่อยลบไฟล์ใน R2 */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  const sb = await getSupabaseServer()
  const { data, error } = await sb.from('project_files').delete().eq('id', id).select('object_key')
  if (error) return filesDbFail('ลบเอกสารไม่สำเร็จ', error, 'DELETE_FAILED')
  if (!data?.length) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  try {
    await deleteObject(data[0].object_key)
  } catch (e) {
    // แถวหายแล้ว ไฟล์ค้างใน R2 แค่กินที่ — ไม่ใช่ความผิดของผู้ใช้ แต่ต้องเห็นใน log
    console.error('[files] ลบไฟล์ใน R2 ไม่สำเร็จ', data[0].object_key, e instanceof Error ? e.message : e)
  }
  return NextResponse.json({ ok: true })
}
