import 'server-only'

import type { RichMenuArea } from '@/lib/line/client'
import { compose, textImage, type Layer } from '@/lib/line/render'
import { MENU_LABEL } from './copy'

// เมนูล่างของแชท: 6 ช่อง 3×2 · ขนาดตามข้อกำหนดของ LINE (2500×1686)

const W = 2500
const H = 1686
const COLS = 3
const ROWS = 2
const GAP = 8

type Tile = { title: string; sub: string; color: string } & (
  | { key: string; uri?: undefined }
  | { key?: undefined; uri: true }
)

const TILES: Tile[] = [
  { key: 'exp', title: MENU_LABEL.exp, sub: 'พิมพ์ยอด ส่งรูปบิล', color: '#1d4ed8' },
  { key: 'att', title: MENU_LABEL.att, sub: 'ดูแต่ละโครงการ', color: '#0f766e' },
  { key: 'apr', title: MENU_LABEL.apr, sub: 'ใบเบิก · รายจ่าย', color: '#b45309' },
  { key: 'allow', title: MENU_LABEL.allow, sub: 'ให้ทีละคน', color: '#6d28d9' },
  { key: 'wage', title: MENU_LABEL.wage, sub: 'เลือกคน ดูใบสรุป', color: '#be123c' },
  { uri: true, title: 'เปิดเว็บ', sub: 'ดูทุกอย่างในระบบ', color: '#334155' },
]

function cell(i: number) {
  const col = i % COLS
  const row = Math.floor(i / COLS)
  const x = Math.round((col * W) / COLS)
  const y = Math.round((row * H) / ROWS)
  return { x, y, w: Math.round(((col + 1) * W) / COLS) - x, h: Math.round(((row + 1) * H) / ROWS) - y }
}

/** `origin` = ที่อยู่เว็บของช่อง "เปิดเว็บ" (https เท่านั้น — LINE ปฏิเสธ http) */
export function richMenuDefinition(origin: string) {
  return {
    name: 'เมนูเจ้าของ',
    chatBarText: 'เมนู',
    size: { width: W, height: H },
    areas: TILES.map((t, i): RichMenuArea => {
      const { x, y, w, h } = cell(i)
      return {
        bounds: { x, y, width: w, height: h },
        action: t.uri
          ? { type: 'uri', label: t.title, uri: origin }
          : { type: 'postback', label: t.title, data: `m=${t.key}`, displayText: t.title },
      }
    }),
  }
}

export async function richMenuImage(): Promise<Uint8Array> {
  const layers: Layer[] = []
  for (const [i, t] of TILES.entries()) {
    const c = cell(i)
    const title = await textImage(t.title, { size: 128, color: '#ffffff', weight: 'bold' })
    const sub = await textImage(t.sub, { size: 70, color: '#ffffff' })
    const gap = 24
    const top = c.y + Math.round((c.h - title.height - gap - sub.height) / 2)
    layers.push(
      { input: title.input, top, left: c.x + Math.round((c.w - title.width) / 2) },
      { input: sub.input, top: top + title.height + gap, left: c.x + Math.round((c.w - sub.width) / 2) },
    )
  }
  const png = await compose(
    W,
    H,
    '#ffffff',
    TILES.map((t, i) => {
      const c = cell(i)
      return { x: c.x + GAP / 2, y: c.y + GAP / 2, w: c.w - GAP, h: c.h - GAP, fill: t.color }
    }),
    layers,
  )
  return new Uint8Array(png)
}
