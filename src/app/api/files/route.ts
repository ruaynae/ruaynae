import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner, getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { headObject } from '@/lib/r2'
import { FILE_MAX_BYTES, cleanFileName, fileTypeOf, metaRow, parseFileMeta } from '@/lib/files'
import { filesDbFail } from '@/lib/files-server'
import { readJson } from '@/lib/plans-server'

export const runtime = 'nodejs'

/**
 * POST /api/files — บันทึกไฟล์ที่อัปขึ้น R2 แล้วเข้าคลังเอกสาร (เจ้าของเท่านั้น · หลัง PUT สำเร็จ)
 * body `{ objectKey, fileName, category, title, siteId?, docNo?, docDate?, note? }`
 * · 🔴 ต้องมี `upload_intents` ของคนนี้ที่ยังไม่ถูกใช้ (กันอ้างคีย์ของคนอื่น) และถาม R2 เองว่าไฟล์มีจริงเท่าไร
 */
export async function POST(req: NextRequest) {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const body = await readJson(req)
  if (!body || typeof body.objectKey !== 'string' || typeof body.fileName !== 'string') {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }
  const meta = parseFileMeta(body)
  if (!meta.ok) return NextResponse.json({ error: meta.error }, { status: 422 })
  const fileName = cleanFileName(body.fileName)
  const t = fileTypeOf(fileName)
  if (!fileName || !t) return NextResponse.json({ error: 'UNSUPPORTED_TYPE' }, { status: 415 })

  const sb = await getSupabaseServer()
  const { data: intent, error: iErr } = await sb
    .from('upload_intents')
    .select('id, object_key')
    .eq('object_key', body.objectKey)
    .is('consumed_at', null)
    .maybeSingle()
  if (iErr) {
    console.error('[files] อ่าน upload_intents ไม่ได้', iErr.message)
    return NextResponse.json({ error: 'SAVE_FAILED' }, { status: 500 })
  }
  if (!intent || !intent.object_key.startsWith('files/')) return NextResponse.json({ error: 'INTENT_NOT_FOUND' }, { status: 404 })

  const head = await headObject(intent.object_key)
  if (!head || head.size <= 0) return NextResponse.json({ error: 'FILE_NOT_UPLOADED' }, { status: 422 })
  if (head.size > FILE_MAX_BYTES) return NextResponse.json({ error: 'FILE_TOO_LARGE' }, { status: 413 })

  const me = await getCurrentUser()
  const { data, error } = await sb
    .from('project_files')
    .insert({
      ...metaRow(meta.value),
      file_name: fileName,
      object_key: intent.object_key,
      content_type: t.type,
      byte_size: head.size,
      created_by: me.id,
    })
    .select('id')
    .maybeSingle()
  if (error) {
    if (error.code === '23503') return NextResponse.json({ error: 'SITE_NOT_FOUND' }, { status: 422 })
    return filesDbFail('บันทึกเอกสารไม่สำเร็จ', error, 'SAVE_FAILED')
  }
  if (!data) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  // ปิดความตั้งใจ — ไม่งั้นตัวกวาดลบไฟล์ที่ใช้อยู่ทิ้งเมื่อหมดอายุ
  const { error: cErr } = await sb.from('upload_intents').update({ consumed_at: new Date().toISOString() }).eq('id', intent.id)
  if (cErr) console.error('[files] ปิด upload_intents ไม่สำเร็จ', cErr.message)
  return NextResponse.json({ ok: true, id: data.id }, { status: 201 })
}
