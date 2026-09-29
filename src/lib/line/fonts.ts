import 'server-only'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

let cache:
  | { name: string; data: ArrayBuffer; weight: 400 | 600 | 700; style: 'normal' }[]
  | undefined

export async function sarabun() {
  if (cache) return cache
  const dir = join(process.cwd(), 'public', 'fonts')
  const load = async (file: string) => {
    const b = await readFile(join(dir, file))
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
  }
  cache = [
    { name: 'Sarabun', data: await load('Sarabun-Regular.ttf'), weight: 400, style: 'normal' },
    { name: 'Sarabun', data: await load('Sarabun-SemiBold.ttf'), weight: 600, style: 'normal' },
    { name: 'Sarabun', data: await load('Sarabun-Bold.ttf'), weight: 700, style: 'normal' },
  ]
  return cache
}
