/**
 * สูตรและรูปข้อมูลของการจ่ายค่าแรง (R15) — ไฟล์ล้วน ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และเบราว์เซอร์
 *
 * 🔴 สูตรจริงอยู่ในฐานข้อมูล (`close_payroll_run`) · ที่นี่คือสำเนาสำหรับ **โชว์ก่อนกด**
 * แล้วส่งยอดที่โชว์ไปเป็น `expected` · ฐานข้อมูลคำนวณเองอีกรอบ ถ้าไม่ตรง = ปฏิเสธ
 * (`BALANCE_CHANGED`) — สำเนาที่ผิดจึงทำให้จ่ายไม่ได้ ไม่ใช่จ่ายผิดยอด
 */

/**
 * เงินสดที่ยื่นให้ = ก้อนที่หักได้ − หักเบิก (หักได้ไม่เกินก้อน)
 * ก้อนที่หักได้ = ค่าแรงค้าง + เงินที่ออกก่อน + โบนัส (คำตอบเจ้าของข้อ 2 · 29 ก.ย. 2569)
 */
export function payNet(p: { accrued: number; owed: number; bonus: number; advanced: number }) {
  const pool = p.accrued + p.owed + p.bonus
  const deducted = Math.min(pool, Math.max(0, p.advanced))
  return { pool, deducted, net: round2(pool - deducted) }
}

export const round2 = (n: number) => Math.round(n * 100) / 100

/** ตรวจช่องโบนัส · ว่าง = 0 · คืน `null` ถ้าไม่ใช่ตัวเลขที่ใช้ได้ */
export function parseBonus(raw: string): number | null {
  const s = raw.replace(/,/g, '').trim()
  if (s === '') return 0
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) return null
  return round2(n)
}

// ── breakdown (สำเนาตอนจ่าย) ──────────────────────────────────────────
export type SlipAdjustment = { name: string; kind: 'add' | 'deduct'; times: number; total: number; dates: string[] }
export type SlipAdvance = { id: string; date: string; amount: number; taken: number }
export type SlipOwed = {
  id: string
  kind: 'reimburse' | 'bonus'
  date: string
  amount: number
  category: string | null
  site: string | null
  note: string | null
}
export type SlipBreakdown = {
  base: { units: number; amount: number }
  adjustments: SlipAdjustment[]
  advances: SlipAdvance[]
  owed: SlipOwed[]
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0)) || 0
const str = (v: unknown) => (typeof v === 'string' ? v : null)
const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []

/**
 * อ่าน `payroll_lines.breakdown` แบบไม่เชื่อรูป — `null` = จ่ายก่อน R15 (ไม่มีรายละเอียด)
 * 🔴 ห้ามเดาตัวเลขแทนแถวเก่า ใบสรุปต้องบอกว่า "ไม่มีรายละเอียด" ไม่ใช่โชว์ศูนย์
 */
export function parseBreakdown(raw: unknown): SlipBreakdown | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const base = (o.base ?? {}) as Record<string, unknown>
  return {
    base: { units: num(base.units), amount: num(base.amount) },
    adjustments: arr(o.adjustments).map((a) => ({
      name: str(a.name) ?? 'ไม่มีชื่อ',
      kind: a.kind === 'deduct' ? 'deduct' : 'add',
      times: num(a.times),
      total: num(a.total),
      dates: Array.isArray(a.dates) ? a.dates.filter((d): d is string => typeof d === 'string') : [],
    })),
    advances: arr(o.advances).map((a) => ({
      id: str(a.id) ?? '',
      date: str(a.date) ?? '',
      amount: num(a.amount),
      taken: num(a.taken),
    })),
    owed: arr(o.owed).map((a) => ({
      id: str(a.id) ?? '',
      kind: a.kind === 'bonus' ? 'bonus' : 'reimburse',
      date: str(a.date) ?? '',
      amount: num(a.amount),
      category: str(a.category),
      site: str(a.site),
      note: str(a.note),
    })),
  }
}

/** รหัสจาก API จ่ายค่าแรง → ข้อความภาษาคน (ใช้ทั้งกล่องจ่ายรายคนและจ่ายทุกคน) */
export const PAY_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
  FORBIDDEN: 'เฉพาะเจ้าของเท่านั้นที่ทำได้',
  EMPLOYEE_REQUIRED: 'กรุณาเลือกคนงาน',
  NOTHING_TO_PAY: 'คนนี้ไม่มียอดค้างจ่าย',
  NOT_FOUND: 'ไม่พบคนงานคนนี้',
  BONUS_INVALID: 'ยอดโบนัสไม่ถูกต้อง',
  BALANCE_CHANGED: 'ยอดเปลี่ยนระหว่างที่เปิดหน้าจอ (มีคนลงชื่อหรืออนุมัติแทรกเข้ามา) — ปิดกล่องแล้วเปิดใหม่เพื่อดูยอดล่าสุด',
  PAY_FAILED: 'จ่ายไม่สำเร็จ กรุณาลองใหม่',
}
export const payError = (code?: string) => PAY_MESSAGES[code ?? ''] ?? 'ทำรายการไม่สำเร็จ กรุณาลองใหม่'

/** รหัสที่ RPC จ่ายเงินโยนมา → รหัสของ API + HTTP status */
export function payErrorCode(msg: string): { code: string; status: number } {
  for (const [code, status] of [
    ['BALANCE_CHANGED', 409], ['NOTHING_TO_PAY', 409], ['BONUS_INVALID', 400],
    ['EMPLOYEE_REQUIRED', 400], ['NOT_FOUND', 404],
  ] as const) {
    if (msg.includes(code)) return { code, status }
  }
  if (/FORBIDDEN|row-level security/i.test(msg)) return { code: 'FORBIDDEN', status: 403 }
  return { code: 'PAY_FAILED', status: 500 }
}

/** ชื่อคนที่ทำให้ "จ่ายทุกคน" ล้ม — RPC ต่อท้ายข้อความด้วย `[ชื่อ]` */
export const failedName = (msg: string) => msg.match(/\[([^\]]+)\]\s*$/)?.[1] ?? null

/** วันที่ไทยของ timestamp (`closed_at`) ในรูป `YYYY-MM-DD` — ใช้เป็นคีย์ของใบสรุป */
export function bangkokDateOf(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso))
}
