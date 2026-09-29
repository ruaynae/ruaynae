#!/usr/bin/env node
/**
 * supabase-mcp.mjs — ตัวเปิด Supabase MCP ที่ผูกกับโปรเจ็คนี้ผ่าน .env.local ของ repo
 *
 * ทำไมไม่ใส่ `${SUPABASE_PROJECT_REF}` ใน .mcp.json ตรง ๆ: ตัวแปรนั้นถูกแทนค่า
 * จาก **เชลล์ที่เปิดโปรแกรม** · เปิดจาก VS Code / เทอร์มินัลใหม่ = ได้สตริงดิบ
 * `${SUPABASE_PROJECT_REF}` แล้ว `get_project_url` ก็ยังตอบกลับมาโดยไม่มี error
 * (เจอจริง 29 ก.ย. 2569)
 *
 * 🔴 ค่าใน .env.local ชนะตัวแปรของเชลล์เสมอ — เครื่องอาจมี SUPABASE_ACCESS_TOKEN
 * ของโปรเจ็คอื่นค้างอยู่ (ดู scripts/db.mjs)
 * · อ่านอย่างเดียว (`--read-only`) · เขียนฐานข้อมูลใช้ `node scripts/db.mjs file <migration>`
 * · token ส่งทาง env ไม่ใช่ argv (argv โผล่ในรายการ process ของเครื่อง)
 */
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = Object.fromEntries(
  readFileSync(join(root, '.env.local'), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
)

const REF = env.SUPABASE_PROJECT_REF
const TOKEN = env.SUPABASE_ACCESS_TOKEN
const hostRef = (env.NEXT_PUBLIC_SUPABASE_URL ?? '').match(/^https:\/\/([a-z0-9]{20})\.supabase\.co/)?.[1]
if (!REF || !TOKEN || hostRef !== REF) {
  process.stderr.write(`supabase-mcp: เป้าหมายไม่ตรง (PROJECT_REF=${REF} · URL=${hostRef}) — ไม่เปิด\n`)
  process.exit(1)
}

const child = spawn(
  'npx',
  ['-y', '@supabase/mcp-server-supabase@0.13.0', '--read-only', `--project-ref=${REF}`],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: TOKEN },
  },
)
child.on('exit', (code) => process.exit(code ?? 0))
