/**
 * คำขอลงชื่อคนเข้าโครงการย้อนหลัง (24 ต.ค. 2569)
 *
 * 🔴 ไฟล์นี้ **ห้ามมี `'use client'`** — ทั้งหน้าเซิร์ฟเวอร์และกล่องฝั่งเบราว์เซอร์เรียกตัวเดียวกัน
 * (CLAUDE.md §17 ข้อ 25)
 *
 * "ย้อนหลัง" = วันที่ทำงานก่อนวันนี้ตามเวลาไทย · กติกาจริงอยู่ที่ trigger
 * `guard_attendance_backdate` — ตัวตรวจที่นี่แค่ให้หน้าจอบอกล่วงหน้า ไม่ใช่ด่าน
 */
export const BACKDATE_CODES = [
  'BACKDATE_NEEDS_APPROVAL',
  'DATE_NOT_PAST',
  'DATE_BUDDHIST_ERA',
  'WORK_UNITS_INVALID',
  'REASON_REQUIRED',
  'FORBIDDEN',
  'EMPLOYEE_NOT_FOUND',
  'EMPLOYEE_INACTIVE',
  'ALREADY_SIGNED_IN',
  'WORK_UNITS_EXCEEDED',
  'PAYROLL_CLOSED',
  'REQUEST_DUPLICATE',
  'REQUEST_DECIDED',
  'NOT_FOUND',
] as const
export type BackdateCode = (typeof BACKDATE_CODES)[number]

export const BACKDATE_MESSAGES: Record<string, string> = {
  BACKDATE_NEEDS_APPROVAL:
    'ลงชื่อ แก้ไข หรือลบย้อนหลังเองไม่ได้ — เลือกวันที่ย้อนหลังแล้วกด "ส่งคำขอ" ให้เจ้าของอนุมัติก่อน',
  DATE_NOT_PAST: 'วันนี้ลงชื่อได้เลย ไม่ต้องยื่นคำขอ',
  DATE_BUDDHIST_ERA: 'ปีที่กรอกเป็น พ.ศ. — กรุณาเลือกวันจากปฏิทิน',
  WORK_UNITS_INVALID: 'ลงได้เฉพาะเต็มวันหรือครึ่งวัน',
  REASON_REQUIRED: 'กรุณาบอกเหตุผลที่ต้องลงย้อนหลัง',
  FORBIDDEN: 'ไม่มีสิทธิ์ทำรายการนี้ — คุณอาจไม่ได้ดูแลโครงการนี้ในวันที่เลือก',
  EMPLOYEE_NOT_FOUND: 'ไม่พบคนงานคนนี้',
  EMPLOYEE_INACTIVE: 'คนงานคนนี้ถูกปิดใช้งานแล้ว',
  ALREADY_SIGNED_IN: 'คนนี้ถูกลงชื่อในโครงการนี้ของวันนั้นไปแล้ว',
  WORK_UNITS_EXCEEDED: 'วันนั้นคนนี้ถูกลงชื่อที่โครงการอื่นไปแล้ว รวมกันจะเกินหนึ่งวัน',
  PAYROLL_CLOSED: 'วันนั้นถูกจ่ายค่าแรงไปแล้ว ลงชื่อเพิ่มไม่ได้',
  REQUEST_DUPLICATE: 'มีคำขอของคนนี้ในวันนั้นรออนุมัติอยู่แล้ว',
  REQUEST_DECIDED: 'คำขอนี้ถูกตัดสินหรือยกเลิกไปแล้ว',
  NOT_FOUND: 'ไม่พบคำขอนี้ — อาจถูกยกเลิกไปแล้ว',
}

export const backdateError = (code?: string | null) =>
  BACKDATE_MESSAGES[code ?? ''] ?? 'ทำรายการไม่สำเร็จ กรุณาลองใหม่'

/** ดึงรหัสเหตุผลที่ฐานข้อมูลโยนออกมา (`CODE: ข้อความ`) */
export const backdateDbCode = (msg: string | null | undefined): BackdateCode | undefined =>
  BACKDATE_CODES.find((c) => (msg ?? '').includes(c))

export const MAX_BACKDATE_REASON = 500

export type BackdateStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'
export const BACKDATE_STATUS_LABEL: Record<BackdateStatus, string> = {
  pending: 'รออนุมัติ',
  approved: 'อนุมัติแล้ว',
  rejected: 'ไม่อนุมัติ',
  cancelled: 'ยกเลิกแล้ว',
}

/** วันที่นี้ต้องขออนุมัติไหม — เฉพาะคนที่ไม่ใช่เจ้าของ และวันก่อนวันนี้ (สตริง YYYY-MM-DD เทียบกันได้ตรง ๆ) */
export const needsBackdateApproval = (role: string, workDate: string, today: string) =>
  role !== 'owner' && workDate < today
