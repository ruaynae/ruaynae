import { NextResponse } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { canRestore } from '@/lib/documents'
import { isUuid } from '@/lib/transactions'

export const runtime = 'nodejs'

/**
 * POST /api/documents/[id]/restore — ย้อนการยกเลิก กลับเป็น "ออกเลขแล้ว" แล้วแก้ไขต่อได้
 *
 * 🔴 เฉพาะใบที่ไม่เคยถึงมือลูกค้า (`canRestore`) · เลขที่ไม่เปลี่ยน ไม่มีการออกเลขใหม่
 * · เหตุผลที่ยกเลิกเดิมยังอยู่ใน `audit_log` (before ของการ update นี้)
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  const sb = await getSupabaseServer()
  const { data: doc, error: rErr } = await sb
    .from('documents')
    .select('id, status, sent_at, accepted_at, txn_id')
    .eq('id', id)
    .maybeSingle()
  if (rErr) {
    console.error('[documents] อ่านเอกสารไม่ได้', rErr.message)
    return NextResponse.json({ error: 'READ_FAILED' }, { status: 500 })
  }
  if (!doc) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  if (doc.status !== 'void') {
    return NextResponse.json({ error: 'DOC_NOT_VOID' }, { status: 409 })
  }
  if (!canRestore({ status: doc.status, sentAt: doc.sent_at, acceptedAt: doc.accepted_at, txnId: doc.txn_id })) {
    return NextResponse.json({ error: 'DOC_RESTORE_SENT' }, { status: 409 })
  }

  // `.eq('status','void')` ซ้ำอีกชั้น — สองแท็บกดพร้อมกันได้ผลเดียว · และ select กลับมา
  // นับ เพราะ RLS ที่ตัดเหลือ 0 แถวตอบ 200 เงียบ ๆ
  const { data: rows, error } = await sb
    .from('documents')
    .update({ status: 'issued', voided_at: null, void_reason: null })
    .eq('id', id)
    .eq('status', 'void')
    .select('id')
  if (error || !rows?.length) {
    console.error('[documents] ย้อนการยกเลิกไม่สำเร็จ', error?.message ?? '0 แถว')
    return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
