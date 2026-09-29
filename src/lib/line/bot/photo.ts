import 'server-only'

import { PutObjectCommand } from '@aws-sdk/client-s3'
import sharp from 'sharp'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { attachSlips, type Slip } from '@/lib/attachments'
import { IMAGE } from '@/lib/constants'
import { getContent } from '@/lib/line/client'
import { objectKey, r2, r2Bucket } from '@/lib/r2'

// รูปบิลจากแชทผ่าน Vercel ได้ (CLAUDE.md §9 ข้อยกเว้น) — ดึงจาก LINE แล้วบีบเหมือนฝั่งเว็บ

const INTENT_TTL_MS = 24 * 60 * 60 * 1000
const MAX_INPUT_BYTES = 12 * 1024 * 1024

/** ดึงรูปจาก LINE → WebP 1600 + thumb 320 → R2 · จดเจตนาอัปไว้ให้ตัวกวาดรู้ว่ามีเจ้าของ */
export async function storeLineImage(messageId: string, ownerProfileId: string): Promise<Slip> {
  const raw = await getContent(messageId)
  if (raw.byteLength > MAX_INPUT_BYTES) throw new Error('IMAGE_TOO_LARGE')

  const base = sharp(Buffer.from(raw), { failOn: 'none' }).rotate()
  const [full, thumb] = await Promise.all([
    base
      .clone()
      .resize({ width: IMAGE.full.maxWidthOrHeight, height: IMAGE.full.maxWidthOrHeight, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer(),
    base
      .clone()
      .resize({ width: IMAGE.thumb.maxWidthOrHeight, height: IMAGE.thumb.maxWidthOrHeight, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 70 })
      .toBuffer(),
  ])

  const slip: Slip = { objectKey: objectKey('slips', 'webp'), thumbKey: objectKey('slips/thumb', 'webp') }

  // 🔴 จดเจตนาก่อนอัป — ถ้าอัปแล้วโปรเซสตาย ตัวกวาดจะลบไฟล์กำพร้านี้เมื่อหมดอายุ
  const { error: iErr } = await getSupabaseAdmin()
    .from('upload_intents')
    .insert({
      object_key: slip.objectKey,
      thumb_key: slip.thumbKey,
      created_by: ownerProfileId,
      expires_at: new Date(Date.now() + INTENT_TTL_MS).toISOString(),
    })
  if (iErr) throw new Error(`upload_intents: ${iErr.message}`)

  const put = (key: string, body: Buffer) =>
    r2().send(
      new PutObjectCommand({
        Bucket: r2Bucket(),
        Key: key,
        Body: body,
        ContentType: IMAGE.type,
      }),
    )
  await Promise.all([put(slip.objectKey, full), put(slip.thumbKey, thumb)])
  return slip
}

/** ผูกรูปที่อัปแล้วเข้ากับรายการ · คืน true เมื่อสำเร็จครบ */
export async function attachToTransaction(transactionId: string, slips: Slip[]): Promise<boolean> {
  if (slips.length === 0) return true
  const res = await attachSlips(
    getSupabaseAdmin() as unknown as Parameters<typeof attachSlips>[0],
    transactionId,
    slips,
  )
  return !res.error
}
