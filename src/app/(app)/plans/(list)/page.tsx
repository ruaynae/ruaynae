import { PageHeader } from '@/components/ui/page-header'
import { PlansTabs } from '@/components/plans/plans-tabs'
import { SavedPlanList, type SavedPlanSummary } from '@/components/plans/saved-plan-list'
import { DomesticSavedList, type SavedDomesticSummary } from '@/components/plans/domestic-saved-list'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isTableMissing } from '@/lib/plans-server'

export const metadata = { title: 'แผนงานก่อสร้าง' }

const TABS = ['saved', 'build', 'track', 'domestic'] as const
type Tab = (typeof TABS)[number]

/**
 * แผนงานที่บันทึกไว้ (R20i) · สร้างแผนงานจาก BOQ · ติดตามผลงานจากไฟล์ (`?tab=track`)
 * · ลิสต์อ่านฝั่งเซิร์ฟเวอร์ (order + range — §7) · ตารางยังไม่ถูกสร้าง = บอกให้รัน migration ไม่ใช่หน้าพัง
 */
export default async function PlansPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams
  const sb = await getSupabaseServer()
  const [{ data, error }, dom] = await Promise.all([
    sb
      .from('construction_plans')
      .select('id, name, start_date, days, updated_at, site:sites(name)')
      .order('updated_at', { ascending: false })
      .order('id', { ascending: false })
      .range(0, 199),
    // ไม่ select `model` — ลิสต์ไม่ต้องใช้ และมันคือก้อนใหญ่สุดของแถว
    sb
      .from('domestic_plans')
      .select('id, name, source_file, updated_at, site:sites(name)')
      .order('updated_at', { ascending: false })
      .order('id', { ascending: false })
      .range(0, 199),
  ])
  if (error && !isTableMissing(error)) console.error('[plans] อ่านรายการแผนงานไม่ได้', error.message)
  if (dom.error && !isTableMissing(dom.error)) console.error('[plans] อ่านรายการแผนการใช้วัสดุไม่ได้', dom.error.message)
  const domestic: SavedDomesticSummary[] = (dom.data ?? []).map((r) => ({
    id: r.id, name: r.name, sourceFile: r.source_file, updatedAt: r.updated_at, siteName: r.site?.name ?? null,
  }))

  const plans: SavedPlanSummary[] = (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    start: r.start_date,
    days: r.days,
    updatedAt: r.updated_at,
    siteName: r.site?.name ?? null,
  }))
  const initial: Tab = TABS.includes(tab as Tab) ? (tab as Tab) : plans.length ? 'saved' : 'build'

  return (
    <>
      <PageHeader title="แผนงานก่อสร้าง" subtitle="สร้างแผนงานจาก BOQ · บันทึกไว้ในเว็บ · กรอกผลงานรายงวดเทียบแผน (S-Curve)" />
      <PlansTabs
        initial={initial}
        saved={
          <SavedPlanList
            plans={plans}
            state={error ? (isTableMissing(error) ? 'missing' : 'error') : 'ok'}
          />
        }
        domesticSaved={
          <DomesticSavedList plans={domestic} state={dom.error ? (isTableMissing(dom.error) ? 'missing' : 'error') : 'ok'} />
        }
      />
    </>
  )
}
