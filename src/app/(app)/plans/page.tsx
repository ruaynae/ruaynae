import { PageHeader } from '@/components/ui/page-header'
import { PlansTabs } from '@/components/plans/plans-tabs'

export const metadata = { title: 'แผนงานก่อสร้าง' }

/**
 * อัปโหลด BOQ → แผนงานรายสัปดาห์ + S-Curve → ไฟล์ Excel · แล้วอัปโหลดไฟล์เดิมที่กรอก % แล้วเสร็จ
 * กลับมาดูแผนเทียบจริง (`?tab=track`) — คำนวณในเบราว์เซอร์ทั้งหมด
 */
export default async function PlansPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams
  return (
    <>
      <PageHeader title="แผนงานก่อสร้าง" subtitle="สร้างแผนงานจาก BOQ · ติดตามผลงานจริงเทียบแผน (S-Curve)" />
      <PlansTabs initial={tab === 'track' ? 'track' : 'build'} />
    </>
  )
}
