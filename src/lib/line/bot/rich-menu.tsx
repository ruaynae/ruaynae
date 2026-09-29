import 'server-only'

import { ImageResponse } from 'next/og'
import { sarabun } from '@/lib/line/fonts'
import type { RichMenuArea } from '@/lib/line/client'
import { MENU_LABEL } from './copy'

// เมนูล่างของแชท: 4 ช่อง 2×2 · ขนาดตามข้อกำหนดของ LINE (2500×1686)

const W = 2500
const H = 1686

const TILES = [
  { key: 'exp', title: MENU_LABEL.exp, sub: 'พิมพ์ยอด ส่งรูปบิล', color: '#1d4ed8' },
  { key: 'att', title: MENU_LABEL.att, sub: 'ดูแต่ละโครงการ', color: '#0f766e' },
  { key: 'apr', title: MENU_LABEL.apr, sub: 'ใบเบิก · รายจ่าย', color: '#b45309' },
  { key: 'allow', title: MENU_LABEL.allow, sub: 'ให้ทีละคน', color: '#6d28d9' },
] as const

export const richMenuDefinition = {
  name: 'เมนูเจ้าของ',
  chatBarText: 'เมนู',
  size: { width: W, height: H },
  areas: TILES.map((t, i): RichMenuArea => ({
    bounds: {
      x: (i % 2) * (W / 2),
      y: Math.floor(i / 2) * (H / 2),
      width: W / 2,
      height: H / 2,
    },
    action: { type: 'postback', label: t.title, data: `m=${t.key}`, displayText: t.title },
  })),
}

export async function richMenuImage(): Promise<Uint8Array> {
  const res = new ImageResponse(
    (
      <div style={{ display: 'flex', flexWrap: 'wrap', width: W, height: H, background: '#ffffff' }}>
        {TILES.map((t) => (
          <div
            key={t.key}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              width: W / 2,
              height: H / 2,
              background: t.color,
              color: '#ffffff',
              border: '6px solid #ffffff',
              fontFamily: 'Sarabun',
            }}
          >
            <div style={{ display: 'flex', fontSize: 190, fontWeight: 700 }}>{t.title}</div>
            <div style={{ display: 'flex', fontSize: 100, fontWeight: 400, marginTop: 30, opacity: 0.92 }}>
              {t.sub}
            </div>
          </div>
        ))}
      </div>
    ),
    { width: W, height: H, fonts: await sarabun() },
  )
  return new Uint8Array(await res.arrayBuffer())
}
