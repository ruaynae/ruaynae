import Link from 'next/link'
import { ChevronRight, Mail, Plus, Settings } from 'lucide-react'
import { getSupabaseServer } from '@/lib/supabase/server'
import { PAGE_SIZE } from '@/lib/constants'
import { fmtDate } from '@/lib/format'
import { searchTerms } from '@/lib/search-core'
import { isUuid } from '@/lib/transactions'
import { formatLetterNo } from '@/lib/letters'
import { PageHeader } from '@/components/ui/page-header'
import { DataError } from '@/components/ui/data-error'
import { EmptyState } from '@/components/ui/states'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { LetterImportButton } from '@/components/letters/letter-import-button'

export const metadata = { title: 'หนังสือบริษัท' }

type Search = { series?: string; q?: string; after?: string }

/**
 * ทะเบียนหนังสือส่ง (R19) — ใหม่สุดก่อน · แยกตามชุดเลข (โครงการ) · ค้นจากเรื่อง
 * keyset ด้วย (letter_date desc, seq desc, id desc) — วันเดียวกันเรียงตามเลขหนังสือ · offset ลึก ๆ ช้าและแถวซ้ำได้ (§7)
 */
export default async function LettersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams
  const seriesId = isUuid(sp.series) ? sp.series : null
  const q = (sp.q ?? '').slice(0, 60)
  const terms = searchTerms(q)

  const sb = await getSupabaseServer()

  let list = sb
    .from('letters')
    .select('id, seq, year_ce, letter_date, subject, series_id, letter_series(prefix, label)')
  if (seriesId) list = list.eq('series_id', seriesId)
  // 🔴 escape แล้วค่อยยัดเข้า ilike — คอมมาในช่องค้นหาจะกลายเป็นเงื่อนไขที่สอง (§7)
  for (const t of terms) list = list.ilike('subject', `%${t}%`)
  if (sp.after) {
    const [d, n, id] = sp.after.split('|')
    if (/^\d{4}-\d{2}-\d{2}$/.test(d ?? '') && /^\d{1,9}$/.test(n ?? '') && isUuid(id)) {
      list = list.or(`letter_date.lt.${d},and(letter_date.eq.${d},seq.lt.${n}),and(letter_date.eq.${d},seq.eq.${n},id.lt.${id})`)
    }
  }

  const [listRes, seriesRes] = await Promise.all([
    list.order('letter_date', { ascending: false }).order('seq', { ascending: false }).order('id', { ascending: false }).range(0, PAGE_SIZE),
    sb.from('letter_series').select('id, label, prefix, is_active').order('label', { ascending: true }).range(0, 199),
  ])

  if (listRes.error) {
    console.error('[letters] อ่านทะเบียนไม่ได้', listRes.error.message)
    return <DataError message="โหลดทะเบียนหนังสือไม่สำเร็จ" />
  }

  const series = seriesRes.data ?? []
  const rows = listRes.data ?? []
  const hasMore = rows.length > PAGE_SIZE
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  const last = page[page.length - 1]
  const current = series.find((s) => s.id === seriesId)

  const href = (next: Partial<Search>) => {
    const p = new URLSearchParams()
    const merged = { series: seriesId ?? undefined, q: q || undefined, ...next }
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v)
    const s = p.toString()
    return s ? `/letters?${s}` : '/letters'
  }

  return (
    <>
      <PageHeader
        title="หนังสือบริษัท"
        subtitle="ทะเบียนหนังสือส่ง · ออกหนังสือถึงหน่วยงานจากแบบที่ใช้บ่อย ได้ไฟล์ Word ตามแบบฟอร์มของห้าง"
        action={
          <>
            <Link
              href={current ? `/letters/new?series=${current.id}` : '/letters/new'}
              className="btn-primary"
            >
              <Plus className="size-4" /> ออกหนังสือใหม่
            </Link>
            <LetterImportButton />
            <Link href="/settings/letters" className="btn-secondary">
              <Settings className="size-4" /> ชุดเลขหนังสือ
            </Link>
          </>
        }
      />

      {series.length === 0 && (
        <Link
          href="/settings/letters"
          className="mb-3 flex items-center gap-2.5 rounded-lg border border-urgent-ring bg-urgent-bg px-3 py-2.5 transition-colors duration-100 hover:border-urgent"
        >
          <Mail className="size-4.5 shrink-0 text-urgent" strokeWidth={1.8} />
          <span className="min-w-0 text-sm text-urgent">
            ยังไม่มีชุดเลขหนังสือ — แตะเพื่อตั้ง (คำนำหน้าเลขที่ เรียน สัญญา) หรือกด &ldquo;นำเข้าไฟล์สำรอง&rdquo;
            เพื่อดึงหนังสือเก่าเข้ามาพร้อมชุดเลข
          </span>
        </Link>
      )}

      {series.length > 1 && (
        <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1 no-scrollbar sm:flex-wrap sm:overflow-visible sm:pb-0">
          {[{ id: '', label: 'ทุกชุด', prefix: '' }, ...series].map((s) => {
            const on = (s.id || null) === seriesId
            return (
              <Link
                key={s.id || 'all'}
                href={href({ series: s.id || undefined, after: undefined })}
                className={`shrink-0 whitespace-nowrap rounded-md px-3.5 py-2 text-sm font-semibold transition-colors ${
                  on ? 'bg-brand-solid text-white' : 'border border-line bg-surface text-ink-2 hover:border-brand'
                }`}
              >
                {s.label}{s.prefix ? ` (${s.prefix})` : ''}
              </Link>
            )
          })}
        </div>
      )}

      <ListToolbar
        basePath="/letters"
        q={q}
        filters={[]}
        activeFilter="all"
        placeholder="ค้นหาจากเรื่อง…"
        extra={seriesId ? { series: seriesId } : {}}
      />

      {page.length === 0 ? (
        <EmptyState
          icon={Mail}
          message={
            q
              ? 'ไม่พบหนังสือที่ตรงกับคำค้น ลองเปลี่ยนคำค้น'
              : 'ยังไม่มีหนังสือในทะเบียน — กด “ออกหนังสือใหม่” หรือนำเข้าไฟล์สำรองของหนังสือเก่า'
          }
          action={
            q ? undefined : (
              <Link href="/letters/new" className="btn-primary">
                <Plus className="size-4" /> ออกหนังสือใหม่
              </Link>
            )
          }
        />
      ) : (
        <div className="panel">
          <ul>
            {page.map((l) => {
              const prefix = l.letter_series?.prefix ?? ''
              const no = formatLetterNo(prefix, l.seq, l.year_ce ?? Number(l.letter_date.slice(0, 4)))
              return (
                <li key={l.id} className="border-b border-line-soft last:border-b-0">
                  <Link
                    href={`/letters/${l.id}`}
                    className="flex items-center gap-3 px-3.5 py-3 transition-colors hover:bg-surface-2 md:px-4"
                  >
                    <span className="w-24 shrink-0 font-semibold tnum text-ink">{no}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">{l.subject}</span>
                      <span className="block truncate text-xs text-muted-token">
                        {fmtDate(l.letter_date)}
                        {!seriesId && series.length > 1 && l.letter_series?.label ? ` · ${l.letter_series.label}` : ''}
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-token" />
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {hasMore && last && (
        <div className="mt-3 text-center">
          <Link href={href({ after: `${last.letter_date}|${last.seq}|${last.id}` })} className="btn-secondary">
            โหลดเพิ่ม
          </Link>
        </div>
      )}
    </>
  )
}
