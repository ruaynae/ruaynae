/** ข้อความภาษาไทยของรหัส error จาก /api/settings/loyverse/* — ใช้ร่วมกันทุกปุ่มในหน้านี้ */
export const LV_MESSAGES: Record<string, string> = {
  NO_TOKEN: 'ยังไม่ได้ตั้งโทเคน',
  TOKEN_REJECTED: 'Loyverse ไม่รับโทเคนนี้ — อาจถูกลบหรือหมดอายุ สร้างใหม่ใน Back Office แล้ววางอีกครั้ง',
  FORBIDDEN: 'โทเคนนี้ไม่มีสิทธิ์อ่านข้อมูลส่วนนี้ของ Loyverse',
  RATE_LIMITED: 'เรียก Loyverse ถี่เกินไป รอสักครู่แล้วลองใหม่',
  NOT_FOUND: 'Loyverse ไม่พบข้อมูลที่ขอ',
  NETWORK: 'ติดต่อ Loyverse ไม่ได้ ลองใหม่อีกครั้ง',
  HTTP: 'Loyverse ตอบกลับผิดปกติ ลองใหม่อีกครั้ง',
  NO_ITEMS: 'ไม่พบสินค้าในร้านที่เลือก — ตรวจว่าเลือกร้านถูก',
  STORE_NOT_SET: 'เลือกร้านและบันทึกก่อน',
  STORE_NOT_FOUND: 'ไม่พบร้านนี้ใน Loyverse แล้ว กดทดสอบใหม่',
  PAYMENT_NOT_FOUND: 'ไม่พบวิธีชำระเงินนี้ใน Loyverse แล้ว กดทดสอบใหม่',
  CONFIG_EMPTY: 'เลือกทั้งร้านและวิธีชำระเงินก่อนบันทึก',
}

export const lvMessage = (code: unknown, fallback: string) =>
  (typeof code === 'string' && LV_MESSAGES[code]) || fallback
