import 'server-only'

import { join } from 'node:path'
import sharp from 'sharp'

// วาดรูปที่บอทส่ง (เมนูล่าง · ใบสรุปค่าแรง) ด้วย sharp + Pango
// 🔴 ไม่ใช้ next/og: ตัววาดของมันไม่จัดตำแหน่งสระบน+วรรณยุกต์ซ้อนกัน
// "เบี้ยเลี้ยง" ออกมาเป็นไม้โททับสระอี · Pango จัดภาษาไทยถูก (HarfBuzz)

const FONT_DIR = join(process.cwd(), 'public', 'fonts')

// ต้องตั้งก่อน sharp วาดตัวหนังสือครั้งแรก — Vercel ไม่มี config ของ fontconfig ให้
if (process.platform === 'linux' && !process.env.FONTCONFIG_FILE) {
  process.env.FONTCONFIG_FILE = join(FONT_DIR, 'fonts.conf')
}
const FONT = {
  regular: join(FONT_DIR, 'Sarabun-Regular.ttf'),
  bold: join(FONT_DIR, 'Sarabun-Bold.ttf'),
}

export type Weight = keyof typeof FONT

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export type TextOpts = {
  size: number
  color: string
  weight?: Weight
  width?: number
  /** ด้านที่วางตัวค้ำความสูงที่มองไม่เห็น · ข้อความชิดขวาใช้ 'start' ขอบขวาจะตรงเป๊ะ */
  strut?: 'start' | 'end'
}
export type Rendered = { input: Buffer; width: number; height: number }

// 🔴 รูปที่ Pango คืนมาถูกตัดพอดีหมึก — "฿520" เตี้ยกว่า "เบี้ยเลี้ยง" ข้อความสองฝั่งของแถวเดียวกัน
// จึงไม่อยู่บนเส้นเดียวกัน · ใส่ตัวอักษรที่สูงสุด/ลึกสุดแบบโปร่งใสไว้ทุกก้อน ความสูงจะเท่ากันหมด
const STRUT = '<span alpha="1">ปั้ฏุ</span>'

/** ข้อความหนึ่งก้อน → รูปโปร่ง · `width` = ตัดบรรทัดเมื่อยาวเกิน */
export async function textImage(body: string, o: TextOpts): Promise<Rendered> {
  const weight = o.weight ?? 'regular'
  const inner = o.strut === 'start' ? `${STRUT}${escape(body)}` : `${escape(body)}${STRUT}`
  const img = sharp({
    text: {
      text: `<span foreground="${o.color}" size="${Math.round(o.size * 1024)}">${inner}</span>`,
      font: weight === 'bold' ? 'Sarabun Bold' : 'Sarabun',
      fontfile: FONT[weight],
      rgba: true,
      dpi: 72,
      ...(o.width ? { width: o.width, wrap: 'word-char' as const } : {}),
    },
  })
  const { data, info } = await img.png().toBuffer({ resolveWithObject: true })
  return { input: data, width: info.width, height: info.height }
}

export type Layer = { input: Buffer; top: number; left: number }

/** พื้น + กล่องสี่เหลี่ยม (SVG ไม่มีตัวหนังสือ) + ชั้นตัวหนังสือ → PNG */
export async function compose(
  width: number,
  height: number,
  background: string,
  boxes: { x: number; y: number; w: number; h: number; fill: string; r?: number }[],
  layers: Layer[],
): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${boxes
    .map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${b.r ?? 0}" fill="${b.fill}"/>`)
    .join('')}</svg>`
  return sharp({ create: { width, height, channels: 4, background } })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }, ...layers])
    .png()
    .toBuffer()
}

/** รูปเล็กสำหรับ previewImageUrl (LINE รับไม่เกิน 1 MB) */
export function preview(png: Buffer, width = 360): Promise<Buffer> {
  return sharp(png).resize({ width }).jpeg({ quality: 80 }).toBuffer()
}
