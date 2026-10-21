import { PageHeader } from '@/components/ui/page-header'
import { PlanBuilder } from '@/components/plans/plan-builder'

export const metadata = { title: 'แผนงานก่อสร้าง' }

/** อัปโหลด BOQ → แผนงานก่อสร้างรายสัปดาห์ + S-Curve → ไฟล์ Excel (คำนวณในเบราว์เซอร์ทั้งหมด) */
export default function PlansPage() {
  return (
    <>
      <PageHeader title="แผนงานก่อสร้าง" subtitle="อัปโหลด BOQ แล้วได้แผนงานรายสัปดาห์พร้อม S-Curve เป็นไฟล์ Excel" />
      <PlanBuilder />
    </>
  )
}
