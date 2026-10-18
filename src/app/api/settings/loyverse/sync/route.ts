import { NextResponse } from 'next/server'
import { loyverseErrorResponse } from '@/lib/loyverse/errors'
import { syncItems } from '@/lib/loyverse/items'
import { denyUnlessOwner } from '@/lib/loyverse/owner-guard'
import { getSupabaseServer } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 60

/** POST /api/settings/loyverse/sync — ดึงรายการสินค้า + คงเหลือของร้านที่เลือกเข้า `pos_items` */
export async function POST() {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  const sb = await getSupabaseServer()
  const { data: cfg, error } = await sb.from('pos_settings').select('store_id').eq('id', true).maybeSingle()
  if (error) {
    console.error('[loyverse-sync] อ่านค่าตั้งร้านไม่ได้', error.message)
    return NextResponse.json({ error: 'FAILED' }, { status: 500 })
  }
  if (!cfg?.store_id) return NextResponse.json({ error: 'STORE_NOT_SET' }, { status: 400 })

  try {
    return NextResponse.json({ ok: true, result: await syncItems(cfg.store_id) })
  } catch (e) {
    return loyverseErrorResponse(e, 'ซิงก์สินค้าไม่สำเร็จ')
  }
}
