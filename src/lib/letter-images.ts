import 'server-only'

import { GetObjectCommand } from '@aws-sdk/client-s3'
import sharp from 'sharp'
import { r2, r2Bucket } from '@/lib/r2'
import type { DocxImage } from '@/lib/letter-docx'

/**
 * รูปของไฟล์ Word หนังสือบริษัท (R19)
 *
 * 🔴 แปลงทุกรูปผ่าน `sharp` ก่อนยัดเข้าไฟล์ — โลโก้ที่ตั้งไว้ใน `/settings`
 * อาจเป็น WebP ซึ่ง Word รุ่นเก่าเปิดไม่ได้ (ขึ้นกรอบแดง "ไม่สามารถแสดงรูปได้")
 * · โลโก้ → PNG (คงพื้นโปร่งใส) · รูปแนบ → JPEG 1600px หมุนตาม EXIF แล้ว
 */

/** โลโก้จาก R2 · อ่านไม่ได้ = ไม่มีโลโก้ ไม่ใช่ทำให้ทั้งไฟล์พัง (R19-API-07) */
export async function loadLogo(objectKey: string | null | undefined): Promise<DocxImage | null> {
  if (!objectKey) return null
  try {
    const res = await r2().send(new GetObjectCommand({ Bucket: r2Bucket(), Key: objectKey }))
    const bytes = await res.Body?.transformToByteArray()
    if (!bytes?.length) return null
    const { data, info } = await sharp(Buffer.from(bytes))
      .resize({ width: 600, height: 600, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true })
    return { data, width: info.width, height: info.height }
  } catch (e) {
    console.error('[letters] อ่านโลโก้ไม่ได้ ออกหนังสือโดยไม่มีโลโก้', e instanceof Error ? e.message : e)
    return null
  }
}

/** รูปแนบท้ายที่ส่งมากับคำขอ — ไม่เก็บที่ไหน ใช้สร้างไฟล์ครั้งนี้ครั้งเดียว (D9) */
export async function normalizePhoto(bytes: ArrayBuffer): Promise<DocxImage> {
  const { data, info } = await sharp(Buffer.from(bytes))
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 82 })
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}
