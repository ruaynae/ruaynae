import { redirect } from 'next/navigation'
import { DataError } from '@/components/ui/data-error'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/states'
import { getCurrentUser } from '@/lib/auth/current-user'
import { PAGE_SIZE } from '@/lib/constants'
import { getSupabaseServer } from '@/lib/supabase/server'
import { RequestForm } from './request-form'

export const metadata = { title: 'คีย์ใบขอเบิกวัสดุ' }

/** ฟอร์มใบขอเบิกวัสดุ (R18) — โครงการที่เห็นถูกกรองด้วย RLS ของ `sites` (หัวหน้าเห็นเฉพาะที่ดูแล) */
export default async function NewMaterialRequestPage() {
  const me = await getCurrentUser()
  if (me.role === 'cashier') redirect('/pickup')
  const sb = await getSupabaseServer()
  const [sites, emps, synced] = await Promise.all([
    sb
      .from('sites')
      .select('id, name')
      .in('status', ['active', 'planning', 'paused'])
      .order('name', { ascending: true })
      .range(0, PAGE_SIZE - 1),
    sb
      .from('employees')
      .select('id, full_name')
      .eq('is_active', true)
      .order('full_name', { ascending: true })
      .range(0, 499),
    sb.rpc('pos_item_search', { p_q: '', p_limit: 1 }),
  ])

  const header = <PageHeader title="คีย์ใบขอเบิกวัสดุ" backHref="/materials" className="mb-0" />
  const failed = sites.error ?? emps.error ?? synced.error
  if (failed) {
    console.error('[materials-new] โหลดไม่ได้', failed.message)
    return (
      <div className="space-y-4">
        {header}
        <DataError message="โหลดฟอร์มไม่สำเร็จ" />
      </div>
    )
  }
  const hasItems = Array.isArray(synced.data) && synced.data.length > 0

  return (
    <div className="space-y-4">
      {header}
      {(sites.data ?? []).length === 0 ? (
        <EmptyState
          message={
            me.role === 'owner'
              ? 'ยังไม่มีโครงการที่เปิดอยู่ — สร้างโครงการก่อน'
              : 'คุณยังไม่ได้ดูแลโครงการไหน — ให้เจ้าของเพิ่มคุณเป็นหัวหน้าโครงการก่อน'
          }
        />
      ) : !hasItems ? (
        <EmptyState
          message={
            me.role === 'owner'
              ? 'ยังไม่มีรายการสินค้าในระบบ — ไปที่ ตั้งค่า → ร้านวัสดุ (Loyverse) แล้วกดดึงสินค้า'
              : 'ยังไม่มีรายการสินค้าของร้านในระบบ — แจ้งเจ้าของให้ดึงสินค้าจาก Loyverse ก่อน'
          }
        />
      ) : (
        <RequestForm
          sites={(sites.data ?? []).map((s) => ({ id: s.id, name: s.name }))}
          employees={(emps.data ?? []).map((e) => ({ id: e.id, name: e.full_name }))}
        />
      )}
    </div>
  )
}
