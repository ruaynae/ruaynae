import { PackageCheck } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AutoRefresh } from '@/components/materials/auto-refresh'
import { RequestAction } from '@/components/materials/request-action'
import { RequestCard } from '@/components/materials/request-card'
import { DataError } from '@/components/ui/data-error'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/states'
import { getCurrentUser } from '@/lib/auth/current-user'
import type { MrFeed } from '@/lib/materials'
import { getSupabaseServer } from '@/lib/supabase/server'

const PAGE = 40

/**
 * หน้าจอแคชเชียร์ร้าน (R18 · M1) — `open` = ใบที่ช่างจะมารับ (เก่าก่อน) · `issued` = จ่ายแล้ว (ใหม่ก่อน)
 * เจ้าของเปิดดูได้ · หัวหน้าโครงการถูกส่งไปหน้าใบของตัวเอง
 */
export async function PickupList({ status }: { status: 'open' | 'issued' }) {
  const me = await getCurrentUser()
  if (me.role === 'site_supervisor') redirect('/materials')

  const sb = await getSupabaseServer()
  const { data, error } = await sb.rpc('material_requests_feed', { p_status: status, p_limit: PAGE, p_offset: 0 })
  const open = status === 'open'

  const header = (
    <PageHeader
      title={open ? 'ใบเบิกรอจ่าย' : 'ใบเบิกที่จ่ายแล้ว'}
      subtitle={
        open
          ? 'ช่างบอกเลขใบ → หยิบของตามรายการ → ออกบิลใน Loyverse (หมายเหตุ = เลขใบ · จ่ายด้วย "เบิกใช้งาน") → กดจ่ายของแล้ว'
          : 'ใบที่แคชเชียร์กดจ่ายของแล้ว ล่าสุดอยู่บนสุด'
      }
      action={
        <Link href={open ? '/pickup/done' : '/pickup'} className="btn-secondary shrink-0">
          {open ? 'ดูที่จ่ายแล้ว' : 'กลับไปใบรอจ่าย'}
        </Link>
      }
      backHref={open ? '/' : '/pickup'}
      className="mb-0"
    />
  )

  if (error) {
    console.error('[pickup] อ่านใบขอเบิกไม่ได้', error.message)
    return (
      <div className="space-y-4">
        {header}
        <DataError message="โหลดใบขอเบิกไม่สำเร็จ" />
      </div>
    )
  }
  const feed = data as unknown as MrFeed

  return (
    <div className="space-y-4">
      {open && <AutoRefresh seconds={20} />}
      {header}
      {feed.rows.length === 0 ? (
        <EmptyState
          icon={PackageCheck}
          message={open ? 'ตอนนี้ไม่มีใบขอเบิกรอจ่าย — ใบใหม่จะขึ้นที่นี่เองภายในไม่กี่วินาที' : 'ยังไม่มีใบที่จ่ายแล้ว'}
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {feed.rows.map((r) => (
            <RequestCard
              key={r.id}
              r={r}
              big
              actions={open ? <RequestAction id={r.id} requestNo={r.request_no} kind="issue" big /> : undefined}
            />
          ))}
        </div>
      )}
      {feed.total > feed.rows.length && (
        <p className="text-center text-xs text-muted-token">
          แสดง {feed.rows.length} จาก {feed.total.toLocaleString('th-TH')} ใบ
        </p>
      )}
    </div>
  )
}
