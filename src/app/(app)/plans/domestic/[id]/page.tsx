import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { DataError } from '@/components/ui/data-error'
import { DomesticBuilder } from '@/components/plans/domestic-builder'
import { loadDomestic } from '@/lib/plans-server'

export const metadata = { title: 'แผนการใช้วัสดุในประเทศ' }

/** แผนการใช้พัสดุ/เหล็กในประเทศที่บันทึกไว้ (R22b) — ติ๊กเหล็ก/นำเข้าต่อ · ดาวน์โหลด Excel · ผูกโครงการ */
export default async function SavedDomesticPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await loadDomestic(id)
  if (r.state === 'not_found') notFound()
  if (r.state !== 'ok') {
    return (
      <>
        <PageHeader title="แผนการใช้วัสดุในประเทศ" backHref="/plans?tab=domestic" />
        <DataError message={r.state === 'missing' ? 'ยังไม่ได้ติดตั้งตารางแผนการใช้วัสดุในฐานข้อมูล' : 'โหลดแผนไม่สำเร็จ'} />
      </>
    )
  }
  return (
    <>
      <PageHeader title={r.plan.name} subtitle="แผนการใช้พัสดุ/เหล็กที่ผลิตภายในประเทศ" backHref="/plans?tab=domestic" />
      <DomesticBuilder saved={r.plan} sites={r.sites} />
    </>
  )
}
