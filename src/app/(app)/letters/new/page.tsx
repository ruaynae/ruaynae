import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/transactions'
import { LETTER_COLUMNS, loadLetterFormContext, toFormLetter } from '@/lib/letters-page'
import { LetterForm } from '@/components/letters/letter-form'
import { DataError } from '@/components/ui/data-error'

export const metadata = { title: 'ออกหนังสือใหม่' }

/**
 * ออกหนังสือใหม่ · `?series=` เลือกชุดเลขไว้ให้ · `?from=<id>` ทำซ้ำจากฉบับเดิม
 * (เลขถัดไป · วันนี้ · ขยับ "ครั้งที่/งวดที่" ให้)
 */
export default async function NewLetterPage({
  searchParams,
}: {
  searchParams: Promise<{ series?: string; from?: string }>
}) {
  const sp = await searchParams
  const ctx = await loadLetterFormContext()
  if (ctx.failed) return <DataError message="โหลดข้อมูลหนังสือไม่สำเร็จ" />

  let source = null
  if (isUuid(sp.from)) {
    const sb = await getSupabaseServer()
    const { data, error } = await sb.from('letters').select(LETTER_COLUMNS).eq('id', sp.from).maybeSingle()
    if (error) console.error('[letters] อ่านฉบับต้นแบบไม่ได้', error.message)
    if (data) source = toFormLetter(data)
  }

  return (
    <LetterForm
      mode="new"
      series={ctx.series}
      entries={ctx.entries}
      contracts={ctx.contracts}
      letterhead={ctx.letterhead}
      logoUrl={ctx.logoUrl}
      today={ctx.today}
      initial={source}
      initialSeriesId={isUuid(sp.series) ? sp.series : null}
    />
  )
}
