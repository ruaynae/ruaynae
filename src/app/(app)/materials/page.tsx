import { PackagePlus } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { RequestAction } from '@/components/materials/request-action'
import { RequestCard } from '@/components/materials/request-card'
import { DataError } from '@/components/ui/data-error'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/states'
import { getCurrentUser } from '@/lib/auth/current-user'
import { isMrStatus, MR_STATUS_LABEL, MR_STATUSES, type MrFeed, type MrStatus } from '@/lib/materials'
import { getSupabaseServer } from '@/lib/supabase/server'

export const metadata = { title: 'เบิกวัสดุจากร้าน' }

const PAGE = 30

/**
 * ใบขอเบิกวัสดุ (R18 · M1) — หัวหน้าโครงการเห็นเฉพาะใบที่ตัวเองยื่น · เจ้าของเห็นทุกใบ
 * ขอบเขตอยู่ใน RPC `material_requests_feed`
 */
export default async function MaterialsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const me = await getCurrentUser()
  if (me.role === 'cashier') redirect('/pickup')
  const sp = await searchParams
  const status: MrStatus = isMrStatus(sp.status) ? sp.status : 'open'

  const sb = await getSupabaseServer()
  const { data, error } = await sb.rpc('material_requests_feed', { p_status: status, p_limit: PAGE, p_offset: 0 })

  const header = (
    <PageHeader
      title="เบิกวัสดุจากร้าน"
      subtitle={me.role === 'owner' ? 'ใบขอเบิกทุกใบ · ช่างไปรับของที่ร้านตามเลขใบ' : 'ใบขอเบิกที่คุณคีย์ให้ช่างไปรับของที่ร้าน'}
      action={
        <Link href="/materials/new" className="btn-primary shrink-0">
          <PackagePlus className="size-4" />
          คีย์ใบขอเบิก
        </Link>
      }
      className="mb-0"
    />
  )

  if (error) {
    console.error('[materials] อ่านใบขอเบิกไม่ได้', error.message)
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
      {header}
      <nav className="flex gap-2 overflow-x-auto" aria-label="สถานะใบขอเบิก">
        {MR_STATUSES.map((s) => (
          <Link
            key={s}
            href={s === 'open' ? '/materials' : `/materials?status=${s}`}
            aria-current={s === status ? 'page' : undefined}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm ${
              s === status ? 'border-brand bg-brand-tint font-medium text-brand' : 'border-line text-ink-2'
            }`}
          >
            {MR_STATUS_LABEL[s]}
          </Link>
        ))}
      </nav>

      {feed.rows.length === 0 ? (
        <EmptyState
          icon={PackagePlus}
          message={
            status === 'open'
              ? 'ยังไม่มีใบขอเบิกที่รอจ่าย — คีย์ใบขอเบิกให้ช่างแล้วแคชเชียร์ที่ร้านจะเห็นทันที'
              : `ยังไม่มีใบที่${MR_STATUS_LABEL[status]}`
          }
          action={
            status === 'open' ? (
              <Link href="/materials/new" className="btn-primary">
                <PackagePlus className="size-4" />
                คีย์ใบขอเบิก
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {feed.rows.map((r) => (
            <RequestCard
              key={r.id}
              r={r}
              actions={
                r.status === 'open' && (r.mine || me.role === 'owner') ? (
                  <RequestAction id={r.id} requestNo={r.request_no} kind="cancel" />
                ) : undefined
              }
            />
          ))}
        </div>
      )}
      {feed.total > feed.rows.length && (
        <p className="text-center text-xs text-muted-token">
          แสดง {feed.rows.length} จาก {feed.total.toLocaleString('th-TH')} ใบล่าสุด
        </p>
      )}
    </div>
  )
}
