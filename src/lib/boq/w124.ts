/**
 * เกณฑ์ประเมินผลการทำงานตามหนังสือกรมบัญชีกลาง ด่วนที่สุด ที่ กค (กวจ) 0405.2/ว 124 ลงวันที่ 1 มี.ค. 2566
 * ข้อ 2.2 "แนวทางการประเมินผลการทำงานและการบอกเลิกสัญญา" — ส่วนคำนวณล้วน ใช้ทั้งไฟล์ Excel และหน้าเว็บ
 *
 *   2.2.1  เวลาเกิน 1 ใน 2  · ผลงานสะสมไม่ถึง 25%
 *   2.2.2  เวลาเกิน 1 ใน 2  · (1) ผลงานไม่ถึง 50% ของแผน และ (2) ผลงานสะสมไม่ถึง 50%
 *   2.2.3  เวลาเกิน 3 ใน 4  · ผลงานสะสมไม่ถึง 65%
 *   2.2.4  ครบกำหนดส่งมอบ   · ผลงานสะสมน้อยกว่า 85%
 *   (2.2.5 ค่าปรับเกิน 10% ของวงเงิน — ระบบไม่มีข้อมูลค่าปรับ จึงไม่ประเมิน)
 *
 * 🔴 หนังสือเทียบ "ผลงานรายเดือน" กับแผนรายเดือนในข้อ 2.2.2 (1) — แบบฟอร์มนี้กรอกรายสัปดาห์
 *    จึงเทียบผลงานสะสม ณ สิ้นสัปดาห์กับครึ่งหนึ่งของแผนสะสม ณ วันเดียวกัน
 * · ผลงานคิดด้วยน้ำหนักค่างานต้นทุน — ฐานเดียวกับ S-Curve
 * · เส้นเทา "แผนงานตาม ว.124" (ผ่าน 25% · 65% · จบ 100%) อยู่ที่ `w124Curve()` ใน core.ts
 * · หนังสือไม่ใช้ข้อ 2.2.1–2.2.5 กับงานก่อสร้างบำรุงทาง
 */

import type { ProgressReport, W124Check } from './progress-core'

export type W124Rule = {
  clause: string
  /** สัดส่วนของระยะเวลาสัญญา — 1 = วันครบกำหนดส่งมอบ */
  frac: number
  /** ผลงานสะสมขั้นต่ำ */
  min: number
  /** ข้อ 2.2.2: ต้องต่ำกว่าครึ่งหนึ่งของแผนด้วยจึงนับว่าไม่ผ่าน */
  halfPlan?: boolean
  when: string
  rule: string
}

export const W124: W124Rule[] = [
  { clause: '2.2.1', frac: 0.5, min: 0.25, when: 'เวลาเกิน 1 ใน 2', rule: 'ผลงานสะสมต้องถึง 25%' },
  { clause: '2.2.2', frac: 0.5, min: 0.5, halfPlan: true, when: 'เวลาเกิน 1 ใน 2', rule: 'ผลงานต้องถึงครึ่งหนึ่งของแผน หรือสะสมถึง 50%' },
  { clause: '2.2.3', frac: 0.75, min: 0.65, when: 'เวลาเกิน 3 ใน 4', rule: 'ผลงานสะสมต้องถึง 65%' },
  { clause: '2.2.4', frac: 1, min: 0.85, when: 'ครบกำหนดส่งมอบ', rule: 'ผลงานสะสมต้องถึง 85%' },
]

/**
 * วันที่ตรวจ นับจากวันเริ่มสัญญา (0 = วันเริ่ม) — วันแรกที่เวลาที่ใช้ไป "เกิน" สัดส่วน
 * (ใช้ไป o + 1 วัน > วัน × สัดส่วน) · ครบกำหนด = วันสุดท้ายของสัญญา
 * 🔴 สูตรเดียวกับ Excel: `$C$2+INT($D$5*frac)` และ `$C$4`
 */
export const w124Offset = (days: number, frac: number) => (frac >= 1 ? days - 1 : Math.floor(days * frac))

export type W124State = 'pending' | 'pass' | 'fail'

/**
 * ผลประเมินหนึ่งข้อ
 * @param reached ถึงวันตรวจแล้วหรือยัง (ข้อมูล ณ วันที่ ≥ วันตรวจ)
 * @param actual ผลงานสะสมของสัปดาห์ล่าสุดที่จบไม่เกินวันตรวจ (ไม่มี = 0)
 * @param plan แผนสะสม ณ สิ้นสัปดาห์เดียวกัน (ใช้เฉพาะข้อ 2.2.2 · null = ไม่มี)
 */
export function w124State(r: W124Rule, reached: boolean, actual: number, plan: number | null): W124State {
  const ok = actual >= r.min || (r.halfPlan === true && plan != null && actual >= plan / 2)
  if (ok) return 'pass'
  return reached ? 'fail' : 'pending'
}

export const W124_LABEL: Record<W124State, string> = {
  pass: 'ผ่านเกณฑ์',
  pending: 'ยังไม่ถึงวันตรวจ',
  fail: 'ต่ำกว่าเกณฑ์',
}

const DAY = 864e5
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`)

/**
 * เติมผลประเมินลงรายงาน — สูตรเดียวกับตารางในชีตสรุป: ผลงาน ณ วันตรวจ = สัปดาห์ล่าสุดที่กรอกและจบไม่เกินวันตรวจ
 * · ถึงวันตรวจแล้วหรือยังเทียบกับ "ข้อมูล ณ วันที่" ของไฟล์
 */
export function withW124(r: ProgressReport): ProgressReport {
  if (!r.w124Enabled || !r.start || !r.days) return r
  const start = utc(r.start)
  const asOf = utc(r.asOf)
  const w124: W124Check[] = W124.map((rule) => {
    const t = start + w124Offset(r.days!, rule.frac) * DAY
    const at = r.installments.filter((p) => p.date != null && utc(p.date) <= t).pop()
    const actual = at?.actual ?? 0
    return {
      clause: rule.clause, when: rule.when, rule: rule.rule, min: rule.min,
      date: new Date(t).toISOString().slice(0, 10), x: ((t - start) / DAY + 1) / 7,
      actual, period: at?.no ?? null, state: w124State(rule, asOf >= t, actual, at?.plan ?? null),
    }
  })
  return { ...r, w124 }
}
