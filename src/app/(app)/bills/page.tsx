import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { fmtDate } from '@/lib/format'
import { isBillMissing, loadCheckFrom, loadTxnPool, needsBill } from '@/lib/bills-server'
import { PageHeader } from '@/components/ui/page-header'
import { DataError } from '@/components/ui/data-error'
import { BillsClient, type BillRow, type UnbilledRow } from '@/components/bills/bills-client'

const LIST = 200
type Search = { tab?: string; f?: string }

/**
 * R41 · ตรวจบิล — อัปโหลดบิล/ใบเสร็จจากผู้ขาย (รูปหรือ PDF ทีละหลายไฟล์) → AI อ่าน → จับคู่กับรายจ่าย
 * แท็บ "ค่าใช้จ่ายที่ยังไม่ได้บิล" = รายจ่ายตั้งแต่วันเริ่มตรวจที่ยังไม่มีบิลรองรับครบยอด · เจ้าของเท่านั้น
 * 🔴 ไม่มี loading.tsx ใน segment นี้ — redirect ของคนที่ไม่ใช่เจ้าของต้องได้รหัสสถานะจริง (§17 ข้อ 6)
 */
export default async function BillsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await getCurrentUser()
  if (me.role !== 'owner') redirect('/')
  const sp = await searchParams
  const tab = sp.tab === 'unbilled' ? 'unbilled' : 'bills'
  const filter = ['open', 'matched', 'ignored', 'pending'].includes(sp.f ?? '') ? (sp.f as string) : 'all'
  const sb = await getSupabaseServer()

  const { data, error } = await sb
    .from('bills')
    .select('id, file_name, page_no, vendor, vendor_tax_id, bill_no, bill_date, amount, vat_amount, read_status, ignored, note, created_at, source, bill_matches(transaction_id, matched_by)')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(0, LIST - 1)
  if (error && isBillMissing(error)) {
    return (
      <>
        <PageHeader title="ตรวจบิล" subtitle="จ่ายเงินแล้ว ได้บิลกลับมาหรือยัง" />
        <div className="panel p-5 text-sm text-ink-2">
          <p className="font-semibold text-ink">ยังไม่ได้ติดตั้งระบบตรวจบิลในฐานข้อมูล</p>
          <p className="mt-1">รัน migration <code>supabase/migrations/20261112090000_bills.sql</code> ใน Supabase SQL Editor แล้วรีเฟรชหน้านี้</p>
        </div>
      </>
    )
  }
  if (error) {
    console.error('[bills] อ่านรายการบิลไม่ได้', error.message)
    return <DataError message="โหลดรายการบิลไม่สำเร็จ" />
  }
  const checkFrom = await loadCheckFrom(sb)
  const pool = await loadTxnPool(sb, checkFrom)
  if (!pool.ok) {
    console.error('[bills] อ่านรายจ่ายไม่ได้', pool.error.message)
    return <DataError message="โหลดรายจ่ายไม่สำเร็จ" />
  }

  type Raw = Omit<BillRow, 'matches'> & { bill_matches: { transaction_id: string; matched_by: string }[] | null }
  const bills: BillRow[] = ((data ?? []) as unknown as Raw[]).map(({ bill_matches, ...b }) => ({
    ...b,
    amount: b.amount == null ? null : Number(b.amount),
    vat_amount: b.vat_amount == null ? null : Number(b.vat_amount),
    matches: bill_matches ?? [],
  }))
  const unbilled: UnbilledRow[] = pool.rows.filter(needsBill).map((t) => ({
    id: t.id, date: t.date, total: t.total, remaining: t.amount, note: t.note, category: t.category, site: t.site, status: t.status, billCount: t.billCount,
  }))

  return (
    <>
      <PageHeader title="ตรวจบิล" subtitle={`จ่ายเงินแล้ว ได้บิลกลับมาหรือยัง · เริ่มตรวจตั้งแต่ ${fmtDate(checkFrom)}`} />
      <nav className="mb-4 flex gap-2" aria-label="แท็บตรวจบิล">
        <Link href="/bills" className={tab === 'bills' ? 'btn-primary' : 'btn-secondary'}>บิลที่อัปโหลด</Link>
        <Link href="/bills?tab=unbilled" className={tab === 'unbilled' ? 'btn-primary' : 'btn-secondary'}>
          ยังไม่ได้บิล ({unbilled.length.toLocaleString('en-US')})
        </Link>
      </nav>
      <BillsClient tab={tab} filter={filter} bills={bills} unbilled={unbilled} truncated={pool.truncated} listCap={LIST} />
    </>
  )
}
