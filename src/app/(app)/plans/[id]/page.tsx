import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { DataError } from '@/components/ui/data-error'
import { SavedPlanView } from '@/components/plans/saved-plan-view'
import { loadPlan } from '@/lib/plans-server'

export const metadata = { title: 'แผนงานก่อสร้าง' }

/** แผนงานที่บันทึกไว้ — กรอกผลงานรายงวด · S-Curve แผนเทียบจริง · ดาวน์โหลด Excel (R20i) */
export default async function SavedPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await loadPlan(id, true)
  if (r.state === 'not_found') notFound()
  if (r.state !== 'ok') {
    return (
      <>
        <PageHeader title="แผนงานก่อสร้าง" backHref="/plans" />
        <DataError message={r.state === 'missing' ? 'ยังไม่ได้ติดตั้งตารางแผนงานในฐานข้อมูล' : 'โหลดแผนงานไม่สำเร็จ'} />
      </>
    )
  }
  return (
    <>
      <PageHeader title={r.plan.name} subtitle={r.plan.project.owner || undefined} backHref="/plans" />
      <SavedPlanView plan={r.plan} sites={r.sites} />
    </>
  )
}
