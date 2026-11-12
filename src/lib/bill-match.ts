/**
 * R41 · จับคู่บิลกับรายจ่าย — ให้คะแนนผู้สมัคร (ไฟล์ล้วน · ไม่มี import — unit test รันด้วย node ตรง ๆ)
 *
 * คะแนน = ยอดเงิน 60% (ตรงถึงสตางค์ = เต็ม · ใกล้เคียงไม่เกิน 1% หรือ ฿1 = บางส่วน) + วันที่ 25% + ชื่อผู้ขาย 15%
 * · วันที่บิลห่างจากวันโอนได้ −45 … +60 วัน (บิลมาก่อนโอนกรณีเครดิต · มาทีหลังกรณีร้านส่งตามมา) · เกินนั้นไม่ใช่ผู้สมัคร
 * · จับคู่อัตโนมัติเฉพาะ "คู่ชัดเจน": ยอดตรงเป๊ะ มีผู้สมัครยอดตรงรายเดียว วันที่ห่างไม่เกิน 30 วัน (หรือบิลไม่มีวันที่)
 *   และไม่มีบิลอื่นที่ยังไม่จับคู่ซึ่งยอดเท่ากันแย่งรายจ่ายเดียวกัน — ที่เหลือให้เจ้าของเลือกเอง (ยกเลิกคู่ได้เสมอ)
 * · โอนครั้งเดียวจ่ายหลายบิล / บิลเดียวจ่ายหลายครั้ง = เจ้าของเลือกเองบนจอ (มีตัวรวมยอดให้เทียบ) — ไม่จับให้อัตโนมัติ
 */

export type MatchBill = { amount: number | null; date: string | null; vendor: string | null }
export type MatchTxn = { id: string; amount: number; date: string; text: string }
export type Candidate = { txnId: string; score: number; exact: boolean; days: number | null; name: number }

export const DAY_MIN = -45
export const DAY_MAX = 60
export const AUTO_MAX_DAYS = 30
export const AUTO_MIN_SCORE = 0.7

const STOP = /(บริษัท|บจก\.?|จำกัด|\(มหาชน\)|มหาชน|ห้างหุ้นส่วนจำกัด|ห้างหุ้นส่วน|หจก\.?|ร้าน|สาขา(ที่)?\s*\S*|สำนักงานใหญ่|co\.?,?\s*ltd\.?|company|limited|ltd\.?)/gi

/** ทำชื่อให้เทียบกันได้ — ตัดคำนำหน้านิติบุคคล/สาขา เว้นวรรค เครื่องหมาย */
export const normName = (s: string) => s.toLowerCase().replace(STOP, ' ').replace(/[^\p{L}\p{N}]+/gu, '')

const bigrams = (s: string) => {
  const out: string[] = []
  for (let i = 0; i < s.length - 1; i += 1) out.push(s.slice(i, i + 2))
  return out
}

/** ความคล้ายของชื่อผู้ขายกับข้อความของรายจ่าย (หมายเหตุ/ผู้รับจากสลิป/หมวด) 0–1 · อยู่ในกันและกัน = 1 */
export function nameSimilarity(vendor: string | null, text: string): number {
  if (!vendor) return 0
  const a = normName(vendor)
  const b = normName(text)
  if (a.length < 2 || b.length < 2) return 0
  if (b.includes(a) || (b.length >= 4 && a.includes(b))) return 1
  const A = bigrams(a)
  const B = new Map<string, number>()
  for (const g of bigrams(b)) B.set(g, (B.get(g) ?? 0) + 1)
  let hit = 0
  for (const g of A) {
    const n = B.get(g) ?? 0
    if (n > 0) { hit += 1; B.set(g, n - 1) }
  }
  // วัดเทียบกับชื่อผู้ขาย (ข้อความของรายจ่ายยาวกว่ามาก ถ้าหารรวมคะแนนจะต่ำเกินจริง)
  return A.length ? hit / A.length : 0
}

const dayDiff = (bill: string, txn: string) => Math.round((Date.parse(`${bill}T00:00:00Z`) - Date.parse(`${txn}T00:00:00Z`)) / 86_400_000)

/** คะแนนของรายจ่ายหนึ่งใบสำหรับบิลนี้ · ไม่ใช่ผู้สมัคร = null */
export function scoreTxn(bill: MatchBill, txn: MatchTxn): Candidate | null {
  if (bill.amount == null || !(bill.amount > 0)) return null
  const diff = Math.abs(bill.amount - txn.amount)
  const exact = diff < 0.005
  const near = diff <= Math.max(1, bill.amount * 0.01)
  if (!exact && !near) return null
  const days = bill.date ? dayDiff(bill.date, txn.date) : null
  if (days !== null && (days < DAY_MIN || days > DAY_MAX)) return null
  const dateScore = days === null ? 0.5 : Math.max(0, 1 - Math.abs(days) / 45)
  const name = nameSimilarity(bill.vendor, txn.text)
  const score = (exact ? 1 : 0.5) * 0.6 + dateScore * 0.25 + name * 0.15
  return { txnId: txn.id, score: Math.round(score * 1000) / 1000, exact, days, name: Math.round(name * 100) / 100 }
}

/** ผู้สมัครเรียงคะแนนมากไปน้อย (สูงสุด `limit`) */
export function rankCandidates(bill: MatchBill, txns: readonly MatchTxn[], limit = 8): Candidate[] {
  return txns
    .map((t) => scoreTxn(bill, t))
    .filter((c): c is Candidate => c !== null)
    .sort((a, b) => b.score - a.score || Math.abs(a.days ?? 99) - Math.abs(b.days ?? 99))
    .slice(0, limit)
}

/**
 * คู่ชัดเจนที่จับให้อัตโนมัติได้ · `rivals` = จำนวนบิลอื่นที่ยังไม่จับคู่ซึ่งยอดเท่ากับบิลนี้พอดี (แย่งรายจ่ายเดียวกันได้)
 * คืน txnId หรือ null
 */
export function autoPick(ranked: readonly Candidate[], rivals: number): string | null {
  if (rivals > 0) return null
  const exact = ranked.filter((c) => c.exact)
  if (exact.length !== 1) return null
  const c = exact[0]
  if (c.days !== null && Math.abs(c.days) > AUTO_MAX_DAYS) return null
  return c.score >= AUTO_MIN_SCORE ? c.txnId : null
}

/** ผลรวมยอดบิลที่ผูกกับรายจ่ายหนึ่งใบ เทียบยอดโอน — ไว้บอกบนจอว่าครบไหม (โอนครั้งเดียวจ่ายหลายบิล) */
export function coverage(txnAmount: number, billAmounts: readonly (number | null)[]): { sum: number; diff: number; complete: boolean } {
  const sum = Math.round(billAmounts.reduce<number>((s, a) => s + (a ?? 0), 0) * 100) / 100
  const diff = Math.round((txnAmount - sum) * 100) / 100
  return { sum, diff, complete: Math.abs(diff) < 0.005 }
}
