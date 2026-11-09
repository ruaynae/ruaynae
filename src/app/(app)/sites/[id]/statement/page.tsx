import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { getBranding } from '@/lib/branding'
import { fmtDate, todayInBangkok } from '@/lib/format'
import { isUuid } from '@/lib/transactions'
import { ST_MAX_ROWS, stCategories, stMoney, stTotals, type StatementData, type StatementRow } from '@/lib/site-statement'
import { PageHeader } from '@/components/ui/page-header'
import { DataError } from '@/components/ui/data-error'
import { StatementActions } from '@/components/sites/statement-actions'

const ISO = /^\d{4}-\d{2}-\d{2}$/
const CHUNK = 1000
const PREVIEW = 30

type Search = { from?: string; to?: string }

/**
 * รายงานรายรับ-รายจ่ายรายโครงการ (PDF) — เจ้าของเท่านั้น · เฉพาะรายการที่อนุมัติแล้ว · ช่วงวันที่เลือกได้ (ไม่เลือก = ทั้งโครงการ)
 * · มือถือ = ปุ่มแชร์เข้า LINE · คอม = ปุ่มดาวน์โหลด · รายการดึงเป็นก้อนละ 1,000 (`.order()` + `.range()` · §7)
 */
export default async function StatementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const { id } = await params
  if (!isUuid(id)) notFound()
  const me = await getCurrentUser()
  if (me.role !== 'owner') redirect(`/sites/${id}`)
  const sp = await searchParams
  const from = ISO.test(sp.from ?? '') ? sp.from! : ''
  const to = ISO.test(sp.to ?? '') ? sp.to! : ''

  const sb = await getSupabaseServer()
  const { data: site, error: sErr } = await sb.from('sites').select('id, name, client_name').eq('id', id).maybeSingle()
  if (sErr) {
    console.error('[sites] อ่านโครงการไม่ได้', sErr.message)
    return <DataError message="โหลดข้อมูลโครงการไม่สำเร็จ" />
  }
  if (!site) notFound()

  type Raw = { kind: 'income' | 'expense'; amount: number; txn_date: string; note: string | null; income_kind: string | null; installment_no: number | null; categories: { name: string } | { name: string }[] | null }
  const raw: Raw[] = []
  let truncated = false
  for (let from_ = 0; from_ < ST_MAX_ROWS; from_ += CHUNK) {
    let q = sb
      .from('transactions')
      .select('kind, amount, txn_date, note, income_kind, installment_no, categories(name)')
      .eq('site_id', id)
      .eq('status', 'approved')
    if (from) q = q.gte('txn_date', from)
    if (to) q = q.lte('txn_date', to)
    const { data, error } = await q.order('txn_date', { ascending: true }).order('id', { ascending: true }).range(from_, from_ + CHUNK - 1)
    if (error) {
      console.error('[sites] อ่านรายการไม่ได้', error.message)
      return <DataError message="โหลดรายการรายรับ-รายจ่ายไม่สำเร็จ" />
    }
    raw.push(...((data ?? []) as unknown as Raw[]))
    if ((data ?? []).length < CHUNK) break
    if (from_ + CHUNK >= ST_MAX_ROWS) truncated = true
  }

  const catName = (c: Raw['categories']) => (Array.isArray(c) ? c[0]?.name : c?.name) ?? ''
  const rows: StatementRow[] = raw.map((r) => {
    const cat = catName(r.categories)
    const extra = r.kind === 'income' && r.installment_no ? ` (งวดที่ ${r.installment_no})` : ''
    const text = `${cat || 'ไม่ระบุหมวด'}${extra}${r.note?.trim() ? ` — ${r.note.trim()}` : ''}`
    return { date: fmtDate(r.txn_date), text, income: r.kind === 'income' ? Number(r.amount) : null, expense: r.kind === 'expense' ? Number(r.amount) : null }
  })
  const cats = stCategories(raw.map((r) => ({ kind: r.kind, category: catName(r.categories), amount: Number(r.amount) })))
  const branding = await getBranding()
  const range = from || to ? `${from ? fmtDate(from) : 'เริ่มต้น'} – ${to ? fmtDate(to) : 'ปัจจุบัน'}` : 'ทั้งโครงการ'
  const data: StatementData = {
    company: branding.companyName, siteName: site.name, client: site.client_name ?? '', range,
    printed: fmtDate(todayInBangkok()), rows, income: cats.income, expense: cats.expense, truncated,
  }
  const t = stTotals(data)
  const fileName = `รายรับรายจ่าย-${site.name}-${from || to ? `${from || 'เริ่ม'}_${to || 'ปัจจุบัน'}` : 'ทั้งโครงการ'}`.replace(/[\\/:*?"<>|\s]+/g, '-')

  return (
    <>
      <PageHeader title="รายงานรายรับ-รายจ่าย" subtitle={`${site.name} · ${range}`} backHref={`/sites/${id}`} action={<StatementActions data={data} fileName={fileName} />} />

      <form method="get" className="card-surface mb-4 flex flex-wrap items-end gap-3 p-4">
        <label className="block"><span className="label-base">ตั้งแต่วันที่</span>
          <input type="date" name="from" defaultValue={from} className="input-base" />
        </label>
        <label className="block"><span className="label-base">ถึงวันที่</span>
          <input type="date" name="to" defaultValue={to} className="input-base" />
        </label>
        <button type="submit" className="btn-secondary">ดูช่วงนี้</button>
        {(from || to) && <Link href={`/sites/${id}/statement`} className="btn-ghost">ทั้งโครงการ</Link>}
      </form>

      <section className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="card-surface p-4"><p className="text-sm text-muted-token">รายรับรวม</p><p className="text-xl font-bold text-ink tabular-nums">฿{stMoney(t.income)}</p></div>
        <div className="card-surface p-4"><p className="text-sm text-muted-token">รายจ่ายรวม</p><p className="text-xl font-bold text-ink tabular-nums">฿{stMoney(t.expense)}</p></div>
        <div className="card-surface p-4"><p className="text-sm text-muted-token">คงเหลือ (รับ − จ่าย)</p><p className={`text-xl font-bold tabular-nums ${t.balance < 0 ? 'text-urgent' : 'text-brand'}`}>{t.balance < 0 ? '-' : ''}฿{stMoney(Math.abs(t.balance))}</p></div>
      </section>

      <section className="card-surface mb-4 p-4">
        <h2 className="mb-2 text-base font-semibold text-ink">รายการ ({rows.length.toLocaleString('en-US')} รายการ)</h2>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-token">ไม่มีรายการที่อนุมัติแล้วในช่วงนี้</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {rows.slice(-PREVIEW).map((r, i) => (
              <li key={i} className="flex items-start gap-3 py-2 text-sm">
                <span className="w-24 shrink-0 text-muted-token">{r.date}</span>
                <span className="min-w-0 flex-1 break-words text-ink">{r.text}</span>
                <span className={`shrink-0 tabular-nums ${r.income != null ? 'text-brand' : 'text-urgent'}`}>{r.income != null ? `+${stMoney(r.income)}` : `-${stMoney(r.expense ?? 0)}`}</span>
              </li>
            ))}
          </ul>
        )}
        {rows.length > PREVIEW && <p className="mt-2 text-xs text-muted-token">แสดง {PREVIEW} รายการล่าสุด · รายการทั้งหมดอยู่ในไฟล์ PDF</p>}
        <p className="mt-3 text-xs text-muted-token">แสดงเฉพาะรายการที่อนุมัติแล้ว ไม่รวมค่าแรงรายวันที่ลงชื่อเข้าโครงการ{truncated ? ' · รายการเกินเพดาน แสดงไม่ครบ ใช้ช่วงวันที่ที่สั้นลง' : ''}</p>
      </section>
    </>
  )
}
