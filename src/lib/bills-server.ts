import 'server-only'
import { NextResponse } from 'next/server'
import type { getSupabaseServer } from '@/lib/supabase/server'
import { autoPick, rankCandidates, type Candidate, type MatchTxn } from '@/lib/bill-match'

type Sb = Awaited<ReturnType<typeof getSupabaseServer>>

/**
 * R41 · ระบบตรวจบิล — ฝั่งเซิร์ฟเวอร์: กองรายจ่ายที่ยังต้องมีบิล + จับคู่อัตโนมัติ
 * 🔴 ทุก query ลิสต์มี order + range (§7) · ตารางยังไม่มี (ยังไม่รัน migration) = 503 `BILL_TABLE_MISSING`
 */

export const DEFAULT_CHECK_FROM = '2026-11-01'
const CHUNK = 1000
const MAX_POOL = 5000

export const isBillMissing = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === 'PGRST205' || e.code === '42P01' || e.code === '42703' || e.code === 'PGRST204' || e.code === 'PGRST200')

export function billDbFail(tag: string, e: { code?: string; message?: string }, code = 'SAVE_FAILED') {
  if (isBillMissing(e)) return NextResponse.json({ error: 'BILL_TABLE_MISSING' }, { status: 503 })
  console.error(`[bills] ${tag}`, e.message)
  return NextResponse.json({ error: code }, { status: 500 })
}

/** วันที่เริ่มตรวจบิล (`app_settings.bill_check_from`) — อ่านไม่ได้ = ค่าตั้งต้น 1 พ.ย. 2569 */
export async function loadCheckFrom(sb: Sb): Promise<string> {
  const { data, error } = await sb.from('app_settings').select('bill_check_from').maybeSingle()
  if (error) return DEFAULT_CHECK_FROM
  return (data as { bill_check_from?: string } | null)?.bill_check_from ?? DEFAULT_CHECK_FROM
}

export type PoolTxn = MatchTxn & {
  /** ยอดเต็มของรายจ่าย (`amount` ของ MatchTxn = ยอดที่ยังไม่มีบิลรองรับ) */
  total: number
  note: string
  category: string
  site: string
  status: string
  billNotRequired: boolean
  categoryRequired: boolean
  /** ผลรวมยอดของบิลที่ผูกแล้ว */
  matched: number
  billCount: number
}

type RawTxn = {
  id: string
  amount: number
  txn_date: string
  note: string | null
  status: string
  bill_not_required: boolean
  categories: { name: string; bill_required: boolean } | { name: string; bill_required: boolean }[] | null
  sites: { name: string } | { name: string }[] | null
  bill_matches: { bills: { amount: number | null } | { amount: number | null }[] | null }[] | null
}
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

/**
 * รายจ่ายตั้งแต่วันเริ่มตรวจ (อนุมัติแล้ว + รออนุมัติ · ไม่รวมที่ตีกลับ) พร้อมยอดบิลที่ผูกแล้ว
 * · `amount` ที่ใช้จับคู่ = ยอดที่ยังไม่มีบิลรองรับ (โอนครั้งเดียวจ่ายหลายบิล: ผูกบิลแรกแล้ว ใบถัดไปเทียบกับยอดที่เหลือ)
 */
export async function loadTxnPool(sb: Sb, from: string): Promise<{ ok: true; rows: PoolTxn[]; truncated: boolean } | { ok: false; error: { code?: string; message?: string } }> {
  const rows: PoolTxn[] = []
  let truncated = false
  for (let at = 0; at < MAX_POOL; at += CHUNK) {
    const { data, error } = await sb
      .from('transactions')
      .select('id, amount, txn_date, note, status, bill_not_required, categories(name, bill_required), sites(name), bill_matches(bills(amount))')
      .eq('kind', 'expense')
      .in('status', ['approved', 'pending'])
      .gte('txn_date', from)
      .order('txn_date', { ascending: true })
      .order('id', { ascending: true })
      .range(at, at + CHUNK - 1)
    if (error) return { ok: false, error }
    for (const r of (data ?? []) as unknown as RawTxn[]) {
      const cat = one(r.categories)
      const matches = r.bill_matches ?? []
      const matched = Math.round(matches.reduce((s, m) => s + Number(one(m.bills)?.amount ?? 0), 0) * 100) / 100
      const total = Number(r.amount)
      const site = one(r.sites)?.name ?? ''
      rows.push({
        id: r.id, total, amount: Math.round((total - matched) * 100) / 100, date: r.txn_date,
        text: [r.note ?? '', cat?.name ?? '', site].join(' '),
        note: r.note ?? '', category: cat?.name ?? '', site, status: r.status,
        billNotRequired: r.bill_not_required, categoryRequired: cat?.bill_required !== false,
        matched, billCount: matches.length,
      })
    }
    if ((data ?? []).length < CHUNK) break
    if (at + CHUNK >= MAX_POOL) truncated = true
  }
  return { ok: true, rows, truncated }
}

/** ต้องมีบิล และยังไม่ครบ (ยังไม่มีบิล หรือยอดบิลรวมยังไม่ถึงยอดโอน) */
export const needsBill = (t: PoolTxn) => !t.billNotRequired && t.categoryRequired && t.amount > 0.005

export type BillForMatch = { id: string; amount: number | null; bill_date: string | null; vendor: string | null }

/** ผู้สมัครของบิลหนึ่งใบ (เฉพาะรายจ่ายที่ยังต้องมีบิล) */
export function candidatesFor(bill: BillForMatch, pool: readonly PoolTxn[]): Candidate[] {
  return rankCandidates({ amount: bill.amount, date: bill.bill_date, vendor: bill.vendor }, pool.filter(needsBill))
}

/**
 * จับคู่อัตโนมัติเมื่อชัดเจน (`autoPick`) — คืน txnId ที่ผูกให้ หรือ null
 * · บิลที่ผูกแล้ว/ข้ามแล้วไม่แตะ · มีบิลอื่นที่ยังไม่จับคู่ยอดเท่ากัน = ไม่จับ (ให้เจ้าของเลือก)
 */
export async function autoMatch(sb: Sb, bill: BillForMatch & { ignored: boolean }): Promise<string | null> {
  if (bill.ignored || bill.amount == null) return null
  const { data: has, error: hErr } = await sb.from('bill_matches').select('transaction_id').eq('bill_id', bill.id).range(0, 0)
  if (hErr || (has ?? []).length) return null
  const from = await loadCheckFrom(sb)
  const pool = await loadTxnPool(sb, from)
  if (!pool.ok) return null
  const ranked = candidatesFor(bill, pool.rows)
  // บิลอื่นที่ยอดเท่ากันพอดีและยังไม่ได้จับคู่ = คู่แข่ง
  const { data: twins, error: tErr } = await sb
    .from('bills').select('id, bill_matches(transaction_id)')
    .eq('amount', bill.amount).eq('ignored', false).neq('id', bill.id)
    .order('id').range(0, 49)
  if (tErr) return null
  const rivals = ((twins ?? []) as { bill_matches: unknown[] | null }[]).filter((t) => !(t.bill_matches ?? []).length).length
  const pick = autoPick(ranked, rivals)
  if (!pick) return null
  const { error } = await sb.from('bill_matches').insert({ bill_id: bill.id, transaction_id: pick, matched_by: 'auto' })
  if (error) {
    console.error('[bills] จับคู่อัตโนมัติไม่ได้', error.message)
    return null
  }
  return pick
}
