import 'server-only'

import { NextResponse } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'

/** ด่านของ route ตั้งค่า LINE — เจ้าของเท่านั้น · คืน null = ผ่าน */
export async function denyUnlessLineOwner(): Promise<NextResponse | null> {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })
  if (me.role !== 'owner') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  return null
}
