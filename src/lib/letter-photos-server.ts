import 'server-only'
import type { getSupabaseServer } from '@/lib/supabase/server'
import { presignGet } from '@/lib/r2'

type Sb = Awaited<ReturnType<typeof getSupabaseServer>>

export type StoredLetterPhoto = { key: string; caption: string }
export type StoredLetterPhotos = { photos: StoredLetterPhoto[]; title: string; layout: '1' | '2'; missing: boolean }

/** ตาราง/คอลัมน์ยังไม่ถูกสร้าง (ยังไม่รัน migration `20261023120000_letter_photos.sql`) */
export const isLetterPhotosMissing = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === 'PGRST205' || e.code === '42P01' || e.code === '42703' || e.code === 'PGRST204')

/**
 * รูปแนบที่เก็บไว้กับหนังสือ — อ่านแยก query จากตัวหนังสือ
 * · ยังไม่รัน migration = ไม่มีรูป (`missing: true`) ไม่ใช่หน้าพัง
 */
export async function loadLetterPhotos(sb: Sb, letterId: string): Promise<StoredLetterPhotos> {
  const [rows, meta] = await Promise.all([
    sb.from('letter_photos').select('object_key, caption, seq').eq('letter_id', letterId).order('seq').range(0, 11),
    sb.from('letters').select('photo_title, photo_layout').eq('id', letterId).maybeSingle(),
  ])
  if (rows.error || meta.error) {
    const e = rows.error ?? meta.error
    if (!isLetterPhotosMissing(e)) console.error('[letters] อ่านรูปแนบไม่ได้', e?.message)
    return { photos: [], title: '', layout: '1', missing: isLetterPhotosMissing(e) }
  }
  return {
    photos: (rows.data ?? []).map((r) => ({ key: r.object_key, caption: r.caption })),
    title: meta.data?.photo_title ?? '',
    layout: meta.data?.photo_layout === '2' ? '2' : '1',
    missing: false,
  }
}

/** รูปพร้อมลิงก์ดู (presigned 1 ชม.) สำหรับฟอร์ม — R2 ล่ม = ไม่มีลิงก์ ไม่ใช่หน้าพัง */
export async function withViewUrls(photos: StoredLetterPhoto[]) {
  return Promise.all(photos.map(async (p) => ({ ...p, url: await presignGet(p.key).catch(() => '') })))
}
