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

/** ตราประทับ: กว้างกี่ส่วนของรูป · ห่างขอบกี่ส่วน — ต้องตรงกับ `.lt-stamp` ใน globals.css (24% · 3%) */
export const STAMP_WIDTH = 0.24
export const STAMP_MARGIN = 0.03

/**
 * รูปแนบท้ายหนังสือ → JPEG 1600px พร้อมใส่ลง Word
 * · `stamp` = ไบต์รูปตราประทับบริษัท (R27) — ประทับมุมขวาล่างด้วย multiply: พื้นขาวของตราที่สแกนมาไม่บังหน้าแค็ตตาล็อก
 */
export async function normalizePhoto(bytes: ArrayBuffer, stamp?: Uint8Array | null): Promise<DocxImage> {
  const base = await sharp(Buffer.from(bytes))
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .png()
    .toBuffer({ resolveWithObject: true })
  let img = sharp(base.data)
  if (stamp?.length) {
    const st = await sharp(Buffer.from(stamp))
      .resize({ width: Math.max(16, Math.round(base.info.width * STAMP_WIDTH)) })
      .png()
      .toBuffer({ resolveWithObject: true })
    img = img.composite([{
      input: st.data,
      blend: 'multiply',
      left: Math.max(0, base.info.width - st.info.width - Math.round(base.info.width * STAMP_MARGIN)),
      top: Math.max(0, base.info.height - st.info.height - Math.round(base.info.height * STAMP_MARGIN)),
    }])
  }
  const { data, info } = await img.jpeg({ quality: 82 }).toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}
