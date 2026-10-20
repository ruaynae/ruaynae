import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { PAGE_SIZE } from '@/lib/constants'
import { currentLetterhead } from '@/lib/letters-server'
import { DataError } from '@/components/ui/data-error'
import { LetterSeriesClient, type SeriesRow } from './letters-client'

export const metadata = { title: 'ชุดเลขหนังสือ' }

/**
 * ชุดเลขหนังสือบริษัท (R19 · D5) — หนึ่งชุดต่อโครงการที่ออกหนังสือ
 * คำนำหน้าเลขที่ · เรียน · สัญญาข้อ 1 · ย่อหน้าแนะนำ · ตำแหน่งใต้ลายเซ็น
 *
 * 🔴 แก้ตรงนี้มีผลกับ **ฉบับถัดไป** เท่านั้น — หนังสือที่ลงทะเบียนแล้วถือสำเนาของตัวเอง
 * · ไม่มี `loading.tsx` ในโฟลเดอร์นี้โดยตั้งใจ — `redirect()` ในหน้าจะได้เด้งจริง (§17 ข้อ 6)
 */
export default async function LetterSeriesSettingsPage() {
  const me = await getCurrentUser()
  // ซ่อนเมนูอย่างเดียวไม่พอ — คนพิมพ์ URL ตรงได้ ต้องกันที่หน้าเองด้วย
  if (me.role !== 'owner') redirect('/settings')

  const sb = await getSupabaseServer()
  const [seriesRes, sitesRes, letterhead] = await Promise.all([
    sb
      .from('letter_series')
      .select('id, label, prefix, site_id, recipient, contract_ref, intro, signer_title, is_active')
      .order('label', { ascending: true })
      .range(0, 199),
    sb.from('sites').select('id, name').order('name', { ascending: true }).range(0, PAGE_SIZE * 4 - 1),
    currentLetterhead(),
  ])
  if (seriesRes.error) {
    console.error('[settings/letters] อ่านชุดเลขไม่ได้', seriesRes.error.message)
    return <DataError message="โหลดชุดเลขหนังสือไม่สำเร็จ" />
  }

  // จำนวนหนังสือต่อชุด — นับในฐานข้อมูล (§7) ใช้บอกว่าชุดไหนลบได้
  const counts = await Promise.all(
    (seriesRes.data ?? []).map(async (s) => {
      const { count } = await sb.from('letters').select('id', { count: 'exact', head: true }).eq('series_id', s.id)
      return count ?? 0
    }),
  )

  const rows: SeriesRow[] = (seriesRes.data ?? []).map((s, i) => ({
    id: s.id,
    label: s.label,
    prefix: s.prefix,
    siteId: s.site_id,
    recipient: s.recipient,
    contractRef: s.contract_ref,
    intro: s.intro,
    signerTitle: s.signer_title,
    isActive: s.is_active,
    letters: counts[i],
  }))

  return (
    <LetterSeriesClient
      rows={rows}
      sites={sitesRes.data ?? []}
      letterhead={letterhead}
    />
  )
}
