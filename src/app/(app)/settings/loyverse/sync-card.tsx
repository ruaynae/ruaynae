'use client'

import { Loader2, PackageSearch, RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { fmtDateTime } from '@/lib/format'
import { lvMessage } from './loyverse-messages'

export type ItemCounts = { active: number; costMissing: number; negative: number }

/** ดึงรายการสินค้า + คงเหลือจาก Loyverse และสรุปสิ่งที่ต้องแก้ (ทุน 0 · สต็อกติดลบ) */
export function SyncCard({ ready, syncedAt, counts }: { ready: boolean; syncedAt: string | null; counts: ItemCounts }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const sync = async () => {
    if (busy) return
    setBusy(true)
    try {
      const r = await fetch('/api/settings/loyverse/sync', { method: 'POST' })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(lvMessage(b.error, 'ดึงสินค้าไม่สำเร็จ'))
        return
      }
      const s = b.result as { inserted: number; updated: number; deactivated: number }
      toast.success(`ดึงสินค้าแล้ว · ใหม่ ${s.inserted} · เปลี่ยน ${s.updated} · หายจาก Loyverse ${s.deactivated}`)
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className="flex items-center gap-2.5 border-b border-line-soft px-4 py-3">
        <PackageSearch className="size-4 shrink-0 text-brand" strokeWidth={1.8} />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">รายการสินค้า</h2>
          <p className="mt-0.5 text-xs text-muted-token">
            ดึงล่าสุด: {syncedAt ? fmtDateTime(syncedAt) : 'ยังไม่เคยดึง'}
          </p>
        </div>
      </div>
      <div className="space-y-4 px-4 py-4">
        {syncedAt && (
          <dl className="grid grid-cols-3 gap-3 text-center">
            <div className="min-w-0 rounded-md bg-surface-2 px-2 py-3">
              <dt className="text-xs text-muted-token">สินค้า</dt>
              <dd className="text-lg font-semibold tabular-nums text-ink">{counts.active.toLocaleString('th-TH')}</dd>
            </div>
            <div className="min-w-0 rounded-md bg-surface-2 px-2 py-3">
              <dt className="text-xs text-muted-token">ยังไม่มีทุน</dt>
              <dd className={`text-lg font-semibold tabular-nums ${counts.costMissing ? 'text-expense' : 'text-ink'}`}>
                {counts.costMissing.toLocaleString('th-TH')}
              </dd>
            </div>
            <div className="min-w-0 rounded-md bg-surface-2 px-2 py-3">
              <dt className="text-xs text-muted-token">สต็อกติดลบ</dt>
              <dd className={`text-lg font-semibold tabular-nums ${counts.negative ? 'text-expense' : 'text-ink'}`}>
                {counts.negative.toLocaleString('th-TH')}
              </dd>
            </div>
          </dl>
        )}
        {syncedAt && (counts.costMissing > 0 || counts.negative > 0) && (
          <p className="text-xs text-muted-token">
            ยังไม่มีทุน = เบิกได้ แต่ต้นทุนโครงการจะรอให้เติมทุนทีหลัง · สต็อกติดลบ = ยอดใน Loyverse ไม่ตรงของจริง
            ควรปรับยอดใน Loyverse ก่อนเปิดแจ้งเตือนสินค้าใกล้หมด
          </p>
        )}
        <button type="button" onClick={sync} disabled={!ready || busy} className="btn-primary">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {busy ? 'กำลังดึง…' : 'ดึงสินค้าจาก Loyverse'}
        </button>
        {!ready && <p className="text-xs text-muted-token">ตั้งโทเคนและเลือกร้านก่อน</p>}
      </div>
    </section>
  )
}
