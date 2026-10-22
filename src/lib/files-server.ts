import 'server-only'
import { NextResponse } from 'next/server'

/** ตารางยังไม่ถูกสร้าง (ยังไม่รัน migration) → 503 `TABLE_MISSING` ให้หน้าจอบอกได้ตรง ๆ */
export const isFilesTableMissing = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === 'PGRST205' || e.code === '42P01')

export function filesDbFail(tag: string, e: { code?: string; message?: string }, code: string) {
  if (isFilesTableMissing(e)) return NextResponse.json({ error: 'TABLE_MISSING' }, { status: 503 })
  console.error(`[files] ${tag}`, e.message)
  return NextResponse.json({ error: code }, { status: 500 })
}
