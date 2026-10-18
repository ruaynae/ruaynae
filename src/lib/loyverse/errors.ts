import 'server-only'

import { NextResponse } from 'next/server'
import { LoyverseError } from './client'

/** แปลง error ของ Loyverse เป็นคำตอบ HTTP ที่หน้าตั้งค่าแปลเป็นภาษาไทยได้ · ไม่ส่งข้อความดิบออกไป */
export function loyverseErrorResponse(e: unknown, tag: string): NextResponse {
  if (e instanceof LoyverseError) {
    if (e.code !== 'NO_TOKEN') console.error(`[loyverse] ${tag}`, e.code, e.status, e.message)
    const status = e.code === 'NO_TOKEN' ? 400 : 502
    return NextResponse.json({ error: e.code, status: e.status || undefined }, { status })
  }
  const msg = e instanceof Error ? e.message : ''
  if (msg === 'loyverse_no_items') return NextResponse.json({ error: 'NO_ITEMS' }, { status: 502 })
  console.error(`[loyverse] ${tag}`, msg)
  return NextResponse.json({ error: 'FAILED' }, { status: 500 })
}
