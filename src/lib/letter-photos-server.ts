import 'server-only'
import type { getSupabaseServer } from '@/lib/supabase/server'
import { presignGet } from '@/lib/r2'
import { LETTER_LIMITS, photoLayoutOf, type PhotoLayout } from '@/lib/letters'

type Sb = Awaited<ReturnType<typeof getSupabaseServer>>

export type StoredLetterPhoto = { key: string; caption: string; heading: string; stamped: boolean; asPage: boolean }
export type StoredLetterPhotos = { photos: StoredLetterPhoto[]; title: string; layout: PhotoLayout; missing: boolean }

/** ตาราง/คอลัมน์ยังไม่ถูกสร้าง (ยังไม่รัน migration `20261023120000_letter_photos.sql`) */
export const isLetterPhotosMissing = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === 'PGRST205' || e.code === '42P01' || e.code === '42703' || e.code === 'PGRST204')

/**
 * รูปแนบที่เก็บไว้กับหนังสือ — อ่านแยก query จากตัวหนังสือ
 * · ยังไม่รัน migration = ไม่มีรูป (`missing: true`) ไม่ใช่หน้าพัง
 */
export async function loadLetterPhotos(sb: Sb, letterId: string): Promise<StoredLetterPhotos> {
  // 🔴 คอลัมน์ `stamped` มาจาก migration R27 — ยังไม่รันต้องไม่ทำให้รูปเดิมหาย: อ่านแบบมีคอลัมน์ก่อน ไม่มีค่อยอ่านแบบเดิม
  const read = (cols: string) =>
    sb.from('letter_photos').select(cols).eq('letter_id', letterId).order('seq').range(0, LETTER_LIMITS.photos - 1)
  // ลองคอลัมน์ใหม่สุดก่อน (heading · 4 พ.ย. 2569) แล้วถอยทีละขั้นถ้ายังไม่รัน migration
  const noCol = (e: { code?: string } | null) => e?.code === '42703' || e?.code === 'PGRST204'
  let rows = await read('object_key, caption, seq, stamped, heading, as_page')
  if (noCol(rows.error)) rows = await read('object_key, caption, seq, stamped, heading')
  if (noCol(rows.error)) rows = await read('object_key, caption, seq, stamped')
  if (noCol(rows.error)) rows = await read('object_key, caption, seq')
  const meta = await sb.from('letters').select('photo_title, photo_layout').eq('id', letterId).maybeSingle()
  if (rows.error || meta.error) {
    const e = rows.error ?? meta.error
    if (!isLetterPhotosMissing(e)) console.error('[letters] อ่านรูปแนบไม่ได้', e?.message)
    return { photos: [], title: '', layout: '1', missing: isLetterPhotosMissing(e) }
  }
  const list = (rows.data ?? []) as unknown as { object_key: string; caption: string; heading?: string; stamped?: boolean; as_page?: boolean }[]
  return {
    photos: list.map((r) => ({ key: r.object_key, caption: r.caption, heading: r.heading ?? '', stamped: r.stamped === true, asPage: r.as_page === true })),
    title: meta.data?.photo_title ?? '',
    layout: photoLayoutOf(meta.data?.photo_layout),
    missing: false,
  }
}

/** รูปพร้อมลิงก์ดู (presigned 1 ชม.) สำหรับฟอร์ม — R2 ล่ม = ไม่มีลิงก์ ไม่ใช่หน้าพัง */
export async function withViewUrls(photos: StoredLetterPhoto[]) {
  return Promise.all(photos.map(async (p) => ({ ...p, url: await presignGet(p.key).catch(() => '') })))
}
