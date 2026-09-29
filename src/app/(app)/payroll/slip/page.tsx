import Link from 'next/link'
import { FileText, LayoutGrid, Table2 } from 'lucide-react'
import { getSupabaseServer } from '@/lib/supabase/server'
import { getBranding } from '@/lib/branding'
import { fmtBaht, fmtDate, fmtDateLong, todayInBangkok } from '@/lib/format'
import { bangkokDateOf, parseBreakdown, type SlipBreakdown } from '@/lib/payroll'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/states'
import { DataError } from '@/components/ui/data-error'
import { SlipPrintButton } from './print-button'

export const metadata = { title: 'ใบสรุปวันจ่ายค่าแรง' }

type Search = { date?: string; view?: string }

/** หนึ่งคนในใบสรุป (หนึ่งบรรทัดจ่าย) */
type SlipLine = {
  key: string
  full_name: string
  job_title: string | null
  days: number
  accrued: number
  reimbursed: number
  bonus: number
  advance_deducted: number
  net_paid: number
  /** null = จ่ายก่อนระบบเก็บรายละเอียด (ก่อน R15) */
  detail: SlipBreakdown | null
}

const ISO = /^\d{4}-\d{2}-\d{2}$/
/** วันถัดไป — ขอบบนของช่วงเวลาที่ปิดรอบ (เวลาไทย) */
const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

/**
 * ใบสรุปวันจ่ายค่าแรง (R15) — เจ้าของส่งให้ทุกคนว่าได้กี่แรง เบี้ยเท่าไหร่ เบิกไปเท่าไหร่
 * ออกเงินให้ก่อนเท่าไหร่ และรับสุทธิเท่าไหร่
 *
 * 🔴 ตัวเลขทุกช่องอ่านจาก **สำเนาที่เก็บไว้ตอนกดจ่าย** (`payroll_lines.breakdown`)
 * ไม่คำนวณใหม่ · แก้ชื่อรายการปรับหรือเรตค่าแรงทีหลัง ใบของวันที่จ่ายไปแล้วต้องไม่เปลี่ยน
 * · วันที่ = วันที่กดจ่าย **ตามเวลาไทย** (จ่ายตอน 06:30 ต้องอยู่วันนั้น ไม่ใช่เมื่อวานของ UTC)
 * · สิทธิ์: `payroll/layout.tsx` ครอบด้วย OwnerOnly แล้ว (นอก Suspense — §17 ข้อ 6)
 */
export default async function PayslipPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams
  const view = sp.view === 'cards' ? 'cards' : 'table'
  const sb = await getSupabaseServer()
  const today = todayInBangkok()

  // วันที่ที่มีการจ่าย — ตัวเลือกด้านบน · 200 รอบล่าสุดพอสำหรับเลือกย้อนหลัง
  const { data: recent, error: recentErr } = await sb
    .from('payroll_runs')
    .select('closed_at')
    .eq('status', 'closed')
    .not('closed_at', 'is', null)
    .order('closed_at', { ascending: false })
    .range(0, 199)
  if (recentErr) {
    console.error('[slip] อ่านวันที่จ่ายไม่ได้', recentErr.message)
    return <DataError message="โหลดใบสรุปไม่สำเร็จ" />
  }
  const payDays = [...new Set((recent ?? []).map((r) => bangkokDateOf(r.closed_at as string)))]

  // 🔴 ปี พ.ศ. ใน URL (`2569-09-29`) ถูกรูปแบบแต่ผิดไป 543 ปี — ปฏิเสธ ไม่ใช่ค้นเงียบ ๆ
  const requested = sp.date && ISO.test(sp.date) && Number(sp.date.slice(0, 4)) < 2400 ? sp.date : null
  const badDate = Boolean(sp.date) && !requested
  const date = requested ?? payDays[0] ?? today

  const { data: runs, error } = badDate
    ? { data: [], error: null }
    : await sb
        .from('payroll_runs')
        .select(`
          id, closed_at,
          payroll_lines(id, days, accrued, reimbursed, bonus, advance_deducted, net_paid, breakdown,
                        employees(full_name, job_title))
        `)
        .eq('status', 'closed')
        .gte('closed_at', `${date}T00:00:00+07:00`)
        .lt('closed_at', `${nextDay(date)}T00:00:00+07:00`)
        .order('closed_at', { ascending: true })
        .range(0, 999)
  if (error) {
    console.error('[slip] อ่านใบสรุปไม่ได้', error.message)
    return <DataError message="โหลดใบสรุปไม่สำเร็จ" />
  }

  const lines: SlipLine[] = (runs ?? [])
    .flatMap((r) => r.payroll_lines ?? [])
    .map((l) => ({
      key: l.id,
      full_name: l.employees?.full_name ?? 'ไม่ทราบชื่อ',
      job_title: l.employees?.job_title ?? null,
      days: Number(l.days),
      accrued: Number(l.accrued),
      reimbursed: Number(l.reimbursed),
      bonus: Number(l.bonus),
      advance_deducted: Number(l.advance_deducted),
      net_paid: Number(l.net_paid),
      detail: parseBreakdown(l.breakdown),
    }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'th'))

  const { companyName } = await getBranding()
  const viewHref = (v: 'table' | 'cards') => `/payroll/slip?date=${date}${v === 'cards' ? '&view=cards' : ''}`

  return (
    <>
      <PageHeader
        title="ใบสรุปวันจ่ายค่าแรง"
        subtitle="ส่งให้คนงานดูว่าได้กี่แรง เบี้ยเท่าไหร่ หักเบิกเท่าไหร่ และรับสุทธิเท่าไหร่"
        backHref="/payroll"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {/* เลือกวัน — ฟอร์ม GET ไม่มี state ฝั่ง client · วันที่มีการจ่ายขึ้นก่อน */}
            <form action="/payroll/slip" method="get" className="flex gap-2">
              {view === 'cards' && <input type="hidden" name="view" value="cards" />}
              <select name="date" defaultValue={date} aria-label="วันที่จ่าย" className="input-base w-auto min-w-44 py-2">
                {!payDays.includes(date) && <option value={date}>{fmtDate(date)}</option>}
                {payDays.map((d) => (
                  <option key={d} value={d}>{fmtDate(d)}</option>
                ))}
              </select>
              <button type="submit" className="btn-secondary shrink-0 px-4 py-2">ดู</button>
            </form>
            <div className="flex gap-1.5">
              {(
                [
                  { key: 'table', label: 'ตารางรวม', icon: Table2 },
                  { key: 'cards', label: 'ใบรายคน', icon: LayoutGrid },
                ] as const
              ).map((t) => (
                <Link
                  key={t.key}
                  href={viewHref(t.key)}
                  aria-current={view === t.key ? 'true' : undefined}
                  className={`inline-flex items-center gap-1.5 rounded-sm border px-3 py-2 text-sm font-medium transition-colors duration-100 ${
                    view === t.key
                      ? 'border-ink bg-ink text-canvas'
                      : 'border-line-strong bg-surface text-ink-2 hover:border-ink-2 hover:text-ink'
                  }`}
                >
                  <t.icon className="size-4" />
                  {t.label}
                </Link>
              ))}
            </div>
            {lines.length > 0 && <SlipPrintButton />}
          </div>
        }
      />

      {lines.length === 0 ? (
        <EmptyState
          icon={FileText}
          message={
            badDate
              ? 'วันที่ในลิงก์ไม่ถูกต้อง — เลือกวันจากกล่องด้านบน'
              : `ไม่มีการจ่ายค่าแรงในวันที่ ${fmtDate(date)} — กดจ่ายที่หน้าค่าแรงก่อน แล้วใบสรุปจะขึ้นที่นี่`
          }
        />
      ) : (
        <div className="paper rounded-lg border border-line bg-surface p-3 md:p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div className="min-w-0">
              <div className="truncate text-base font-bold text-ink">{companyName}</div>
              <div className="text-sm text-ink-2">สรุปการจ่ายค่าแรง · {fmtDateLong(date)}</div>
            </div>
            <div className="text-sm text-muted-token tnum">
              {lines.length} คน · รวมจ่าย {fmtBaht(lines.reduce((s, l) => s + l.net_paid, 0))}
            </div>
          </div>
          {view === 'cards' ? <SlipCards lines={lines} date={date} /> : <SlipTable lines={lines} />}
        </div>
      )}
    </>
  )
}

// ── ตารางรวม ────────────────────────────────────────────────────────────
function SlipTable({ lines }: { lines: SlipLine[] }) {
  // คอลัมน์รายการปรับ = ชื่อที่มีจริงในวันนั้น · บวกก่อน หักทีหลัง
  const names = (kind: 'add' | 'deduct') =>
    [...new Set(lines.flatMap((l) => (l.detail?.adjustments ?? []).filter((a) => a.kind === kind).map((a) => a.name)))]
  const adds = names('add')
  const deducts = names('deduct')
  const hasOwed = lines.some((l) => l.reimbursed > 0)
  const hasBonus = lines.some((l) => l.bonus > 0)
  const adjOf = (l: SlipLine, name: string, kind: 'add' | 'deduct') =>
    l.detail?.adjustments.find((a) => a.name === name && a.kind === kind)
  const sum = (f: (l: SlipLine) => number) => lines.reduce((s, l) => s + f(l), 0)
  const legacy = lines.some((l) => !l.detail)

  const money = (n: number | null | undefined, sign = '') =>
    n === null || n === undefined ? '—' : n === 0 ? '–' : sign + fmtBaht(n)

  return (
    <>
      {/* ตารางกว้างเลื่อนในกล่องของตัวเอง ไม่ดันทั้งหน้า (§17 ข้อ 7) */}
      <div className="-mx-3 overflow-x-auto md:mx-0">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-semibold text-muted-token">
              <th className="px-2 py-2">ชื่อ</th>
              <th className="px-2 py-2 text-right">แรง</th>
              <th className="px-2 py-2 text-right">ค่าจ้าง</th>
              {adds.map((n) => <th key={'a' + n} className="px-2 py-2 text-right">{n}</th>)}
              {deducts.map((n) => <th key={'d' + n} className="px-2 py-2 text-right">{n}</th>)}
              <th className="px-2 py-2 text-right">ค่าแรงรวม</th>
              {hasOwed && <th className="px-2 py-2 text-right">ออกเงินก่อน</th>}
              {hasBonus && <th className="px-2 py-2 text-right">โบนัส</th>}
              <th className="px-2 py-2 text-right">หักเบิก</th>
              <th className="px-2 py-2 text-right">รับสุทธิ</th>
            </tr>
          </thead>
          <tbody className="tnum">
            {lines.map((l) => (
              <tr key={l.key} className="border-b border-line-soft">
                <td className="px-2 py-2 font-medium text-ink">
                  {l.full_name}
                  {!l.detail && <span className="text-xs text-muted-token"> *</span>}
                </td>
                <td className="px-2 py-2 text-right">{l.days || '–'}</td>
                <td className="px-2 py-2 text-right">{money(l.detail?.base.amount)}</td>
                {adds.map((n) => {
                  const a = adjOf(l, n, 'add')
                  return (
                    <td key={'a' + n} className="px-2 py-2 text-right">
                      {!l.detail ? '—' : a ? <>{fmtBaht(a.total)} <span className="text-xs text-muted-token">×{a.times}</span></> : '–'}
                    </td>
                  )
                })}
                {deducts.map((n) => {
                  const a = adjOf(l, n, 'deduct')
                  return (
                    <td key={'d' + n} className="px-2 py-2 text-right text-urgent">
                      {!l.detail ? '—' : a ? <>−{fmtBaht(a.total)} <span className="text-xs text-muted-token">×{a.times}</span></> : '–'}
                    </td>
                  )
                })}
                <td className="px-2 py-2 text-right font-semibold">{money(l.accrued)}</td>
                {hasOwed && <td className="px-2 py-2 text-right">{money(l.reimbursed, '+')}</td>}
                {hasBonus && <td className="px-2 py-2 text-right">{money(l.bonus, '+')}</td>}
                <td className="px-2 py-2 text-right text-muted-token">{money(l.advance_deducted, '−')}</td>
                <td className="px-2 py-2 text-right text-base font-bold text-income">{fmtBaht(l.net_paid)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="tnum">
            <tr className="border-t-2 border-line font-semibold">
              <td className="px-2 py-2">รวม</td>
              <td className="px-2 py-2 text-right">{sum((l) => l.days)}</td>
              <td className="px-2 py-2 text-right">{legacy ? '—' : fmtBaht(sum((l) => l.detail?.base.amount ?? 0))}</td>
              {adds.map((n) => (
                <td key={'a' + n} className="px-2 py-2 text-right">
                  {fmtBaht(sum((l) => adjOf(l, n, 'add')?.total ?? 0))}
                </td>
              ))}
              {deducts.map((n) => (
                <td key={'d' + n} className="px-2 py-2 text-right text-urgent">
                  −{fmtBaht(sum((l) => adjOf(l, n, 'deduct')?.total ?? 0))}
                </td>
              ))}
              <td className="px-2 py-2 text-right">{fmtBaht(sum((l) => l.accrued))}</td>
              {hasOwed && <td className="px-2 py-2 text-right">+{fmtBaht(sum((l) => l.reimbursed))}</td>}
              {hasBonus && <td className="px-2 py-2 text-right">+{fmtBaht(sum((l) => l.bonus))}</td>}
              <td className="px-2 py-2 text-right text-muted-token">−{fmtBaht(sum((l) => l.advance_deducted))}</td>
              <td className="px-2 py-2 text-right text-base font-bold text-income">{fmtBaht(sum((l) => l.net_paid))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-token">
        ออกเงินก่อน = เงินที่คนงานจ่ายแทนบริษัทไปก่อน (คืนให้ ไม่ใช่ค่าแรง) · หักเบิกได้ไม่เกินยอดที่ได้รับในวันนี้
        ส่วนที่เหลือหักรอบหน้า
        {legacy && ' · * จ่ายก่อนระบบเก็บรายละเอียด แสดงเฉพาะยอดรวม'}
      </p>
    </>
  )
}

// ── ใบรายคน — ขนาดพอดีจอมือถือ แคปแล้วส่งได้ทันที ─────────────────────
function SlipCards({ lines, date }: { lines: SlipLine[]; date: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {lines.map((l) => (
        <article
          key={l.key}
          className="min-w-0 rounded-lg border border-line p-3.5 [break-inside:avoid]"
        >
          <header className="flex items-baseline justify-between gap-2 border-b border-line-soft pb-2">
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold text-ink">{l.full_name}</h2>
              <p className="truncate text-xs text-muted-token">{l.job_title ?? 'ไม่ได้ระบุตำแหน่ง'}</p>
            </div>
            <span className="shrink-0 text-xs text-muted-token">จ่าย {fmtDate(date)}</span>
          </header>

          <dl className="mt-2 space-y-1 text-sm tnum">
            {l.detail ? (
              <>
                <Row label={`ค่าจ้าง ${l.detail.base.units} แรง`} value={fmtBaht(l.detail.base.amount)} />
                {l.detail.adjustments.map((a) => (
                  <div key={a.kind + a.name}>
                    <Row
                      label={`${a.name} ×${a.times}`}
                      value={(a.kind === 'add' ? '+ ' : '− ') + fmtBaht(a.total)}
                      tone={a.kind === 'add' ? 'income' : 'urgent'}
                    />
                    {/* วันที่ได้เบี้ย — ให้คนงานเทียบเองได้ว่าครบวันไหม (R15-A-SLIP-06) */}
                    <p className="text-[11px] leading-4 text-muted-token">
                      {a.dates.map((d) => fmtDate(d)).join(', ')}
                    </p>
                  </div>
                ))}
              </>
            ) : (
              <p className="text-xs text-muted-token">จ่ายก่อนระบบเก็บรายละเอียด — แสดงเฉพาะยอดรวม ({l.days} แรง)</p>
            )}
            <Row label="ค่าแรงรวม" value={fmtBaht(l.accrued)} strong border />

            {l.reimbursed > 0 && (
              <div>
                <Row label="คืนเงินที่ออกให้ก่อน" value={'+ ' + fmtBaht(l.reimbursed)} tone="income" />
                {(l.detail?.owed ?? []).filter((o) => o.kind === 'reimburse').map((o) => (
                  <p key={o.id} className="truncate text-[11px] leading-4 text-muted-token">
                    {fmtDate(o.date)} · {o.note || o.category || 'รายจ่าย'} · {fmtBaht(o.amount)}
                  </p>
                ))}
              </div>
            )}
            {l.bonus > 0 && <Row label="โบนัส" value={'+ ' + fmtBaht(l.bonus)} tone="income" />}
            {l.advance_deducted > 0 && (
              <div>
                <Row label="หักเบิกล่วงหน้า" value={'− ' + fmtBaht(l.advance_deducted)} tone="muted" />
                {(l.detail?.advances ?? []).map((a) => (
                  <p key={a.id} className="text-[11px] leading-4 text-muted-token">
                    เบิก {fmtDate(a.date)} {fmtBaht(a.amount)}
                    {a.taken < a.amount ? ` · หักรอบนี้ ${fmtBaht(a.taken)} เหลือ ${fmtBaht(a.amount - a.taken)}` : ''}
                  </p>
                ))}
              </div>
            )}
          </dl>

          <div className="mt-2 flex items-baseline justify-between gap-2 border-t border-line pt-2">
            <span className="font-medium text-ink">รับสุทธิ</span>
            <span className="text-xl font-bold tnum text-income">{fmtBaht(l.net_paid)}</span>
          </div>
        </article>
      ))}
    </div>
  )
}

function Row({
  label,
  value,
  tone = 'default',
  strong = false,
  border = false,
}: {
  label: string
  value: string
  tone?: 'default' | 'income' | 'urgent' | 'muted'
  strong?: boolean
  border?: boolean
}) {
  const color =
    tone === 'income' ? 'text-income' : tone === 'urgent' ? 'text-urgent' : tone === 'muted' ? 'text-muted-token' : 'text-ink'
  return (
    <div className={'flex items-baseline justify-between gap-3' + (border ? ' border-t border-line-soft pt-1' : '')}>
      <dt className="min-w-0 truncate text-ink-2">{label}</dt>
      <dd className={'shrink-0 ' + color + (strong ? ' font-semibold' : '')}>{value}</dd>
    </div>
  )
}
