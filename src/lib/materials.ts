/**
 * ใบขอเบิกวัสดุจากร้าน (R18 · M1) — ชนิดข้อมูล + ข้อความของรหัส error ที่ RPC โยนออกมา
 * ไฟล์ล้วน (ไม่มี 'use client') ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และเบราว์เซอร์ (§17 ข้อ 25)
 */

export type MrStatus = 'open' | 'issued' | 'cancelled'
export const MR_STATUSES: MrStatus[] = ['open', 'issued', 'cancelled']
export const isMrStatus = (v: unknown): v is MrStatus =>
  typeof v === 'string' && (MR_STATUSES as string[]).includes(v)

export const MR_STATUS_LABEL: Record<MrStatus, string> = {
  open: 'รอจ่ายของ',
  issued: 'จ่ายของแล้ว',
  cancelled: 'ยกเลิกแล้ว',
}

export type MrLine = {
  variant_id: string
  qty: number
  name: string
  variant_name: string | null
  sku: string | null
  barcode: string | null
  track_stock: boolean
  in_stock: number | null
}

export type MrRow = {
  id: string
  request_no: string
  status: MrStatus
  note: string | null
  created_at: string
  issued_at: string | null
  cancelled_at: string | null
  site: string | null
  requested_by: string | null
  employee: string | null
  issued_by: string | null
  mine: boolean
  lines: MrLine[]
}

export type MrFeed = { total: number; rows: MrRow[] }

export type PosSearchItem = {
  variant_id: string
  name: string
  variant_name: string | null
  sku: string | null
  barcode: string | null
  category: string | null
  track_stock: boolean
  in_stock: number | null
}

/** รหัสที่ RPC โยน → ข้อความไทย · ตัวแปลงฝั่ง API ใช้ `mrErrorCode()` */
export const MR_MESSAGES: Record<string, string> = {
  FORBIDDEN: 'บัญชีนี้ทำรายการนี้ไม่ได้',
  MR_SITE_REQUIRED: 'เลือกโครงการก่อน',
  MR_SITE_FORBIDDEN: 'คุณไม่ได้ดูแลโครงการนี้',
  MR_EMPLOYEE_INVALID: 'ไม่พบชื่อช่างที่เลือก',
  MR_NOTE_TOO_LONG: 'หมายเหตุยาวเกินไป',
  MR_LINES_REQUIRED: 'เพิ่มสินค้าอย่างน้อยหนึ่งรายการ',
  MR_TOO_MANY_LINES: 'ใบเดียวใส่ได้ไม่เกิน 50 รายการ',
  MR_ITEM_INVALID: 'มีสินค้าที่ไม่อยู่ในร้านแล้ว — ลบออกแล้วเลือกใหม่',
  MR_QTY_INVALID: 'จำนวนต้องมากกว่า 0',
  MR_NOT_FOUND: 'ไม่พบใบขอเบิกนี้',
  MR_NOT_OPEN: 'ใบนี้ไม่ได้อยู่ในสถานะรอจ่ายแล้ว — โหลดหน้าใหม่',
}

const CODES = Object.keys(MR_MESSAGES)

/** ดึงรหัสจากข้อความ error ของ Postgres · ไม่รู้จัก = null */
export function mrErrorCode(message: string | undefined): string | null {
  if (!message) return null
  return CODES.find((c) => message.includes(c)) ?? null
}

export const mrMessage = (code: unknown, fallback: string) =>
  (typeof code === 'string' && MR_MESSAGES[code]) || fallback

/** ชื่อสินค้าที่แสดง — รวมตัวเลือก (สี/ขนาด) ถ้ามี */
export const itemLabel = (i: { name: string; variant_name: string | null }) =>
  i.variant_name ? `${i.name} (${i.variant_name})` : i.name

export const fmtQty = (n: number) =>
  Number.isInteger(n) ? n.toLocaleString('th-TH') : n.toLocaleString('th-TH', { maximumFractionDigits: 3 })
