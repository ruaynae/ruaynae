import 'server-only'

import { PutObjectCommand } from '@aws-sdk/client-s3'
import sharp from 'sharp'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { getContent } from '@/lib/line/client'
import { deleteObject, objectKey, r2, r2Bucket } from '@/lib/r2'
import { readBill } from '@/lib/slip-ai/gemini'
import { todayInBangkok } from '@/lib/format'
import { autoMatch, candidatesFor, loadCheckFrom, loadTxnPool } from '@/lib/bills-server'
import { send, setState } from '../api'
import { menuItems, text, type QuickItem } from '../messages'
import type { Turn } from '../types'
import { baht, thaiDate } from '../util'

/**
 * R41 B2 · ส่งบิลทาง LINE — เจ้าของกด "ส่งบิล" (หรือพิมพ์ "บิล") แล้วส่งรูปบิลทีละรูปหรือหลายรูปพร้อมกัน
 * · รูปละหนึ่งบิล → R2 `bills/…` (ผ่าน Vercel ได้ · ข้อยกเว้น §9) → AI อ่าน → จับคู่อัตโนมัติเมื่อชัดเจน → ตอบกลับทีละรูป
 * · รูปหลายรูปมาเป็นหลาย webhook พร้อมกัน — แต่ละรูปเป็นแถวของตัวเอง ไม่แตะ payload ของเซสชัน (§17 ข้อ 35)
 * · อยู่ในโหมดนี้จนพิมพ์ "เสร็จ"/"ยกเลิก" หรือเงียบเกิน 30 นาที · ส่งรูปนอกโหมด = ไปทางคีย์รายจ่ายเหมือนเดิม
 * 🔴 เขียนด้วย service role (บอทไม่มีเซสชันเว็บ) แล้วระบุ `created_by` = เจ้าของที่ผูก LINE นี้เอง
 */

type Admin = Parameters<typeof autoMatch>[0]
const admin = () => getSupabaseAdmin() as unknown as Admin
const MAX_INPUT_BYTES = 12 * 1024 * 1024

const doneItems = (): QuickItem[] => [{ label: 'เสร็จแล้ว', text: 'เสร็จ' }, ...menuItems()]

export async function startBills(turn: Turn) {
  await setState(turn, 'bill_mode')
  return send(turn, [
    text(
      'ส่งรูปบิล / ใบเสร็จ / ใบกำกับภาษี ได้เลย ทีละรูปหรือหลายรูปพร้อมกัน (1 รูป = 1 บิล)\nระบบอ่านแล้วจับคู่กับรายจ่ายที่คีย์ไว้ให้ · ส่งครบแล้วพิมพ์ "เสร็จ"',
      doneItems(),
    ),
  ])
}

export async function finishBills(turn: Turn) {
  await setState(turn, 'idle')
  return send(turn, [text('ปิดโหมดส่งบิลแล้ว · ดูบิลที่ยังไม่จับคู่และรายจ่ายที่ยังไม่ได้บิลที่เว็บ เมนู "ตรวจบิล"', menuItems())])
}

export function onText(turn: Turn, body: string) {
  if (/^(เสร็จ|เสร็จแล้ว|จบ|พอ)$/.test(body)) return finishBills(turn)
  return send(turn, [text('อยู่ในโหมดส่งบิล — ส่งรูปบิลได้เลย หรือพิมพ์ "เสร็จ" เมื่อส่งครบ', doneItems())])
}

/** รูปหนึ่งรูป = บิลหนึ่งใบ · ตอบกลับผลอ่าน + คู่ที่จับได้ */
export async function addBill(turn: Turn, messageId: string, ownerProfileId: string) {
  // ต่ออายุโหมด — ส่งรูปต่อเนื่องเกิน 30 นาทีก็ยังอยู่ในโหมดนี้
  await setState(turn, 'bill_mode')

  const raw = await getContent(messageId)
  if (raw.byteLength > MAX_INPUT_BYTES) return send(turn, [text('รูปนี้ใหญ่เกินไป ลองส่งใหม่เป็นรูปขนาดปกติ', doneItems())])
  const image = await sharp(Buffer.from(raw), { failOn: 'none' }).rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()

  const key = objectKey('bills', 'webp')
  await r2().send(new PutObjectCommand({ Bucket: r2Bucket(), Key: key, Body: image, ContentType: 'image/webp' }))
  const sb = admin()
  const { data: bill, error } = await sb
    .from('bills')
    .insert({ object_key: key, content_type: 'image/webp', byte_size: image.byteLength, file_name: 'รูปจาก LINE', source: 'line', created_by: ownerProfileId })
    .select('id')
    .maybeSingle()
  if (error || !bill) {
    await deleteObject(key).catch(() => undefined)
    if (error && /bills|PGRST205|42P01/.test(`${error.code} ${error.message}`)) {
      return send(turn, [text('ยังไม่ได้ติดตั้งระบบตรวจบิล — ให้เจ้าของรัน migration 20261112090000_bills.sql ก่อน', menuItems())])
    }
    throw new Error(`bills: ${error?.message ?? 'insert'}`)
  }

  const r = await readBill(image, 'image/webp', todayInBangkok())
  if (!r.ok) {
    if (r.reason === 'UNREADABLE') await sb.from('bills').update({ read_status: 'failed' }).eq('id', bill.id)
    const why = r.reason === 'OFF' || r.reason === 'KEY_REJECTED' ? 'ยังไม่ได้ตั้งคีย์ AI'
      : r.reason === 'QUOTA' ? 'โควตา AI วันนี้หมด'
      : r.reason === 'UNREADABLE' ? 'AI อ่านบิลนี้ไม่ได้' : 'AI ขัดข้อง'
    return send(turn, [text(`เก็บบิลแล้ว แต่${why} — กรอกยอด/ผูกรายจ่ายเองที่เว็บ เมนู "ตรวจบิล"`, doneItems())])
  }

  const v = r.read
  const { data: saved, error: uErr } = await sb
    .from('bills')
    .update({ vendor: v.vendor, vendor_tax_id: v.taxId, bill_no: v.billNo, bill_date: v.date, amount: v.amount, vat_amount: v.vat, read_status: 'read' })
    .eq('id', bill.id)
    .select('id, amount, bill_date, vendor, ignored')
    .maybeSingle()
  if (uErr) throw new Error(`bills: ${uErr.message}`)

  const head = [
    `บิล: ${v.vendor ?? 'ไม่ทราบผู้ขาย'}`,
    v.amount != null ? `ยอด ${baht(v.amount)}` : 'อ่านยอดไม่ได้',
    v.date ? `วันที่ ${thaiDate(v.date)}` : null,
    v.billNo ? `เลขที่ ${v.billNo}` : null,
  ].filter(Boolean).join(' · ')

  const matched = saved ? await autoMatch(sb, saved) : null
  if (matched) {
    const { data: t } = await sb.from('transactions').select('txn_date, note, amount').eq('id', matched).maybeSingle()
    const line = t ? `${thaiDate(t.txn_date)} ${t.note ? `· ${t.note.slice(0, 60)} ` : ''}· ${baht(Number(t.amount))}` : ''
    return send(turn, [text(`${head}\nจับคู่กับรายจ่ายแล้ว: ${line}`, doneItems())])
  }

  // ยังไม่จับคู่ — บอกว่ามีตัวเลือกกี่รายการให้ไปเลือกที่เว็บ
  let hint = 'ไม่เจอรายจ่ายที่ยอดตรง — อาจยังไม่ได้คีย์รายจ่ายนี้'
  if (saved && v.amount != null) {
    const pool = await loadTxnPool(sb, await loadCheckFrom(sb))
    if (pool.ok) {
      const n = candidatesFor(saved, pool.rows).length
      if (n) hint = `มีรายจ่ายที่น่าจะใช่ ${n} รายการ — เลือกผูกที่เว็บ เมนู "ตรวจบิล"`
    }
  }
  return send(turn, [text(`${head}\n${hint}`, doneItems())])
}
