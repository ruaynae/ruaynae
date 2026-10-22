import { notFound } from 'next/navigation'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/transactions'
import { asLetterhead } from '@/lib/letters'
import { LETTER_COLUMNS, loadLetterFormContext, toFormLetter } from '@/lib/letters-page'
import { LetterForm } from '@/components/letters/letter-form'
import { DataError } from '@/components/ui/data-error'
import { loadLetterPhotos, withViewUrls } from '@/lib/letter-photos-server'

export const metadata = { title: 'หนังสือบริษัท' }

/**
 * หนังสือที่ลงทะเบียนแล้ว — ฟอร์มเดียวกับตอนออก (แก้ · ดาวน์โหลดซ้ำ · พิมพ์ · ทำซ้ำ · ลบ)
 *
 * 🔴 กระดาษใช้หัวกระดาษที่แช่แข็งไว้ในแถว (D4) ไม่ใช่ข้อมูลบริษัทปัจจุบัน
 * — ฉบับที่ส่งไปแล้วต้องออกมาเหมือนที่หน่วยงานถืออยู่
 */
export default async function LetterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const sb = await getSupabaseServer()
  const [ctx, { data: row, error }] = await Promise.all([
    loadLetterFormContext(),
    sb.from('letters').select(LETTER_COLUMNS).eq('id', id).maybeSingle(),
  ])
  if (error || ctx.failed) {
    if (error) console.error('[letters] อ่านหนังสือไม่ได้', error.message)
    return <DataError message="โหลดหนังสือไม่สำเร็จ" />
  }
  if (!row) notFound()

  const saved = await loadLetterPhotos(sb, id)
  const stored = asLetterhead(row.letterhead)
  return (
    <LetterForm
      mode="edit"
      series={ctx.series}
      entries={ctx.entries}
      contracts={ctx.contracts}
      letterhead={stored.companyName ? stored : ctx.letterhead}
      logoUrl={ctx.logoUrl}
      today={ctx.today}
      initial={toFormLetter(row)}
      initialSeriesId={null}
      initialPhotos={{ photos: await withViewUrls(saved.photos), title: saved.title, layout: saved.layout }}
    />
  )
}
