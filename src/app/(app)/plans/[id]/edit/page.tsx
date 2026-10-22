import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { DataError } from '@/components/ui/data-error'
import { PlanBuilder } from '@/components/plans/plan-builder'
import { loadPlan } from '@/lib/plans-server'

export const metadata = { title: 'แก้แผนงานก่อสร้าง' }

/**
 * แก้แผนงานที่บันทึกไว้ — ข้อมูลสัญญา วันเริ่ม/สิ้นสุด ลำดับงาน จำนวนงวด
 * · ผลงานที่กรอกไว้อยู่ต่อ (คีย์รายการไม่เลื่อน) · ลดจำนวนงวด = ผลงานของงวดที่เกินถูกตัดทิ้ง
 */
export default async function EditPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await loadPlan(id, false)
  if (r.state === 'not_found') notFound()
  if (r.state !== 'ok') {
    return (
      <>
        <PageHeader title="แก้แผนงาน" backHref={`/plans/${id}`} />
        <DataError message="โหลดแผนงานไม่สำเร็จ" />
      </>
    )
  }
  return (
    <>
      <PageHeader
        title="แก้แผนงาน"
        subtitle={`${r.plan.name} · ผลงานที่กรอกไว้ไม่หาย · ลดจำนวนงวด = ผลงานของงวดที่เกินถูกตัดทิ้ง`}
        backHref={`/plans/${id}`}
      />
      <PlanBuilder saved={r.plan} />
    </>
  )
}
