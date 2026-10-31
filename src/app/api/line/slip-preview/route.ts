import { GetObjectCommand } from '@aws-sdk/client-s3'
import { NextResponse, type NextRequest } from 'next/server'
import sharp from 'sharp'
import { slipPreviewOk } from '@/lib/line/slip-preview'
import { r2, r2Bucket } from '@/lib/r2'

export const runtime = 'nodejs'

/**
 * GET /api/line/slip-preview?k=&e=&s= — รูปสลิปสำหรับการ์ดยืนยันในแชท LINE
 *
 * LINE แสดงรูปใน Flex ได้เฉพาะ JPEG/PNG แต่สลิปเก็บเป็น WebP → แปลงตอนขอ (ไม่เก็บสำเนาเพิ่มใน R2)
 * ไม่มีคุกกี้ (LINE เป็นคนดึง) → ตรวจลายเซ็นในลิงก์แทน · ลายเซ็นผิด/หมดอายุ = 404 ไม่บอกเหตุผล
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const k = q.get('k') ?? ''
  if (!slipPreviewOk(k, q.get('e') ?? '', q.get('s') ?? '')) {
    return new NextResponse(null, { status: 404 })
  }
  try {
    const obj = await r2().send(new GetObjectCommand({ Bucket: r2Bucket(), Key: k }))
    const bytes = await obj.Body?.transformToByteArray()
    if (!bytes) return new NextResponse(null, { status: 404 })
    const jpeg = await sharp(Buffer.from(bytes))
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer()
    return new NextResponse(new Uint8Array(jpeg), {
      headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=604800' },
    })
  } catch (e) {
    console.error('[line] slip-preview ไม่สำเร็จ', (e as Error).name)
    return new NextResponse(null, { status: 404 })
  }
}
