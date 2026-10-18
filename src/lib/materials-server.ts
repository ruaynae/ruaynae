import 'server-only'

import { NextResponse } from 'next/server'
import { mrErrorCode } from './materials'

/** แปลง error ของ RPC ใบขอเบิกเป็นคำตอบ JSON · ไม่ส่งข้อความดิบของฐานข้อมูลออกไป */
export function mrErrorResponse(message: string, tag: string): NextResponse {
  const code = mrErrorCode(message)
  if (code === 'FORBIDDEN') return NextResponse.json({ error: code }, { status: 403 })
  if (code === 'MR_NOT_FOUND') return NextResponse.json({ error: code }, { status: 404 })
  if (code === 'MR_NOT_OPEN') return NextResponse.json({ error: code }, { status: 409 })
  if (code) return NextResponse.json({ error: code }, { status: 400 })
  console.error(`[materials] ${tag}`, message)
  return NextResponse.json({ error: 'FAILED' }, { status: 500 })
}
