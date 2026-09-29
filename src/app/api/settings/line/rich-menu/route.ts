import { NextResponse } from 'next/server'
import { createDefaultRichMenu, LineHttpError } from '@/lib/line/client'
import { lineToken } from '@/lib/line/config'
import { denyUnlessLineOwner } from '@/lib/line/owner-guard'
import { richMenuDefinition, richMenuImage } from '@/lib/line/bot/rich-menu'

export const runtime = 'nodejs'
export const maxDuration = 60

/** POST /api/settings/line/rich-menu — สร้างเมนูล่างของแชท 4 ช่อง แล้วตั้งเป็นเมนูเริ่มต้น */
export async function POST() {
  const denied = await denyUnlessLineOwner()
  if (denied) return denied

  if (!(await lineToken())) return NextResponse.json({ error: 'NO_TOKEN' }, { status: 409 })

  try {
    const id = await createDefaultRichMenu(richMenuDefinition, {
      bytes: await richMenuImage(),
      type: 'image/png',
    })
    return NextResponse.json({ ok: true, id })
  } catch (e) {
    const status = e instanceof LineHttpError ? e.status : 0
    console.error('[line-richmenu] สร้างเมนูไม่สำเร็จ', status, e instanceof Error ? e.message : '')
    return NextResponse.json({ error: status === 401 ? 'TOKEN_REJECTED' : 'CREATE_FAILED' }, { status: 502 })
  }
}
