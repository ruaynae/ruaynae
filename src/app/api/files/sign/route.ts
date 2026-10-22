import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner, getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { objectKey, presignPut } from '@/lib/r2'
import { FILE_MAX_BYTES, extOf, fileTypeOf } from '@/lib/files'
import { readJson } from '@/lib/plans-server'

export const runtime = 'nodejs'

/** ไฟล์ใหญ่บนเน็ตมือถือใช้เวลานาน — ลิงก์อัปโหลดอายุ 2 ชม. แล้ว sweep-orphans กวาดถ้าไม่ถูกบันทึก */
const TTL_SECONDS = 2 * 60 * 60

/**
 * POST /api/files/sign — ขอลิงก์อัปโหลดไฟล์เข้าคลังเอกสาร (เจ้าของเท่านั้น · ปุ่ม "อัปโหลดเอกสาร")
 * body `{ fileName, byteSize }` → `{ key, url, contentType }`
 * · ชนิดไฟล์ตัดสินจากนามสกุล และเซิร์ฟเวอร์กำหนด content-type ให้ — เบราว์เซอร์ต้อง PUT ด้วยค่านี้
 * · 🔴 บันทึก `upload_intents` ก่อนคืนลิงก์ (thumb_key = object_key) — ไฟล์ที่อัปแล้วไม่ได้บันทึกถูกกวาดทิ้ง
 */
export async function POST(req: NextRequest) {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const body = await readJson(req)
  const fileName = typeof body?.fileName === 'string' ? body.fileName : ''
  const byteSize = Number(body?.byteSize ?? NaN)
  const t = fileTypeOf(fileName)
  if (!t) return NextResponse.json({ error: 'UNSUPPORTED_TYPE' }, { status: 415 })
  if (!Number.isFinite(byteSize) || byteSize <= 0) return NextResponse.json({ error: 'FILE_EMPTY' }, { status: 400 })
  if (byteSize > FILE_MAX_BYTES) return NextResponse.json({ error: 'FILE_TOO_LARGE' }, { status: 413 })

  const me = await getCurrentUser()
  const key = objectKey('files', extOf(fileName))
  const sb = await getSupabaseServer()
  const { error } = await sb.from('upload_intents').insert({
    object_key: key,
    thumb_key: key,
    created_by: me.id,
    site_id: null,
    expires_at: new Date(Date.now() + TTL_SECONDS * 1000).toISOString(),
  })
  if (error) {
    console.error('[files] บันทึก upload_intents ไม่ได้', error.message)
    return NextResponse.json({ error: 'INTENT_FAILED' }, { status: 500 })
  }
  return NextResponse.json({ key, url: await presignPut(key, t.type, TTL_SECONDS), contentType: t.type })
}
