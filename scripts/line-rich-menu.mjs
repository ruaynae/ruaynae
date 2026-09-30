#!/usr/bin/env node
/**
 * line-rich-menu.mjs — สร้างเมนูล่างของแชท LINE ใหม่ (6 ช่อง) โดยไม่ต้องล็อกอินหน้าเว็บ
 *
 * ทำสิ่งเดียวกับปุ่ม "สร้างเมนูล่าง" ที่ /settings/line ทุกประการ — ใช้โค้ดชุดเดียวกัน
 * (src/lib/line/bot/rich-menu.ts + client.ts) ผ่าน jiti · token อ่านจาก Vault ด้วย service role
 *
 *   node scripts/line-rich-menu.mjs --preview   วาดรูปเมนูลงไฟล์อย่างเดียว ไม่แตะ LINE
 *   node scripts/line-rich-menu.mjs --confirm   สร้างและตั้งเป็นเมนูเริ่มต้นของทุกคนในแชท
 *
 * 🔴 --confirm เปลี่ยนเมนูที่ผู้ใช้ LINE จริงเห็นทันที · รันหลัง deploy โค้ดที่รู้จักปุ่มใหม่แล้วเท่านั้น
 *    ไม่งั้นกดปุ่มใหม่แล้วบอทตอบว่าไม่รู้จัก
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'

const ORIGIN = 'https://ruaynae.vercel.app'
const root = join(fileURLToPath(import.meta.url), '..', '..')

for (const line of readFileSync(join(root, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].trim()
}
// ห้ามเข้าโหมดปลอมโดยไม่ตั้งใจ — สคริปต์นี้มีไว้แตะ LINE จริงเท่านั้น
delete process.env.LINE_API_FAKE

const jiti = createJiti(import.meta.url, {
  alias: { '@': join(root, 'src'), 'server-only': join(root, 'scripts', 'server-only-stub.cjs') },
})
const { richMenuDefinition, richMenuImage } = await jiti.import(join(root, 'src/lib/line/bot/rich-menu.ts'))

const png = await richMenuImage()
const mode = process.argv[2]

if (mode === '--preview') {
  const out = join(root, 'rich-menu-preview.png')
  writeFileSync(out, png)
  console.log(`✅ วาดเมนูแล้ว → ${out} (ยังไม่ได้ส่งเข้า LINE)`)
} else if (mode === '--confirm') {
  const { createDefaultRichMenu } = await jiti.import(join(root, 'src/lib/line/client.ts'))
  const id = await createDefaultRichMenu(richMenuDefinition(ORIGIN), { bytes: png, type: 'image/png' })
  console.log(`✅ สร้างเมนูล่างแล้ว ${id} · ตั้งเป็นเมนูเริ่มต้นของทุกคนแล้ว · ปุ่ม "เปิดเว็บ" → ${ORIGIN}`)
} else {
  console.log('ใช้: node scripts/line-rich-menu.mjs --preview | --confirm')
  process.exitCode = 1
}
