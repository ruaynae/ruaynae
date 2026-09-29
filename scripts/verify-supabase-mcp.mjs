#!/usr/bin/env node
/**
 * verify-supabase-mcp.mjs — พิสูจน์ว่า MCP ที่ .mcp.json เปิด "ผูกกับโปรเจ็คนี้จริง"
 *
 * "tool ตอบได้" ≠ "ผูกถูกโปรเจ็ค" · ตัวนี้คุย JSON-RPC กับตัวเปิดตัวเดียวกับที่
 * .mcp.json ใช้ แล้วเทียบ ref ที่ได้จาก `get_project_url` กับ .env.local
 * · ปฏิเสธ URL ที่มี `${` (ตัวแปรไม่ถูกแทนค่า) ก่อนเทียบ
 */
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
)
const expected = env.SUPABASE_PROJECT_REF

const child = spawn('node', ['scripts/supabase-mcp.mjs'], { stdio: ['pipe', 'pipe', 'inherit'] })
let buf = ''
const waiters = new Map()
child.stdout.on('data', (d) => {
  buf += d
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (!line) continue
    try {
      const msg = JSON.parse(line)
      waiters.get(msg.id)?.(msg)
    } catch {}
  }
})
const send = (id, method, params) =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`หมดเวลารอ ${method}`)), 90_000)
    waiters.set(id, (m) => (clearTimeout(t), res(m)))
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })

let ok = false
try {
  await send(1, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'verify-supabase-mcp', version: '1' },
  })
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  const r = await send(2, 'tools/call', { name: 'get_project_url', arguments: {} })
  const text = r.result?.content?.[0]?.text ?? JSON.stringify(r)
  const url = text.match(/https:\/\/[^\s"]+/)?.[0] ?? ''
  const ref = url.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co/)?.[1]
  if (url.includes('${')) console.log(`❌ URL ยังมีตัวแปรดิบ: ${url}`)
  else if (ref !== expected) console.log(`❌ ผูกผิดโปรเจ็ค: ได้ ${ref ?? url} · ต้องเป็น ${expected}`)
  else {
    ok = true
    console.log(`✅ MCP ผูกกับ ${ref} ตรงกับ .env.local`)
  }
} catch (e) {
  console.log(`❌ ${e.message}`)
} finally {
  child.kill()
  process.exit(ok ? 0 : 1)
}
