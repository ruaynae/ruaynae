import { KeyRound, Store } from 'lucide-react'
import { DataError } from '@/components/ui/data-error'
import { PageHeader } from '@/components/ui/page-header'
import { getSupabaseServer } from '@/lib/supabase/server'
import { ConnectPanel } from './connect-panel'
import { SyncCard, type ItemCounts } from './sync-card'
import { TokenForm, type TokenState } from './token-form'

export const metadata = { title: 'ร้านวัสดุ (Loyverse)' }

/**
 * เชื่อมร้านวัสดุใน Loyverse (R18 · M0) — เจ้าของเท่านั้น (ด่านอยู่ใน layout.tsx)
 * โทเคนเก็บใน Supabase Vault · หน้านี้เห็นแค่ 4 ตัวท้าย
 */
export default async function LoyverseSettingsPage() {
  const sb = await getSupabaseServer()
  const count = () => sb.from('pos_items').select('variant_id', { count: 'exact', head: true }).eq('is_active', true)
  const [token, cfg, active, costMissing, negative] = await Promise.all([
    sb.rpc('loyverse_token_status'),
    sb
      .from('pos_settings')
      .select('store_id, store_name, withdraw_payment_type_id, withdraw_payment_type_name, items_synced_at')
      .eq('id', true)
      .maybeSingle(),
    count(),
    count().or('pos_cost.is.null,pos_cost.eq.0').is('cost_override', null),
    count().eq('track_stock', true).lt('in_stock', 0),
  ])

  const failed = token.error ?? cfg.error ?? active.error ?? costMissing.error ?? negative.error
  if (failed) {
    console.error('[loyverse-settings] อ่านค่าไม่ได้', failed.message)
    return (
      <div className="space-y-5">
        <PageHeader title="ร้านวัสดุ (Loyverse)" backHref="/settings" className="mb-0" />
        <DataError message="โหลดการตั้งค่าร้านไม่สำเร็จ" />
      </div>
    )
  }

  const tok = token.data as unknown as TokenState
  const counts: ItemCounts = {
    active: active.count ?? 0,
    costMissing: costMissing.count ?? 0,
    negative: negative.count ?? 0,
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="ร้านวัสดุ (Loyverse)"
        subtitle="ดึงรายการสินค้าและสต็อกจาก Loyverse มาใช้กับใบขอเบิกของช่าง"
        backHref="/settings"
        className="mb-0"
      />

      <section className="rounded-lg border border-line bg-surface">
        <div className="flex items-center gap-2.5 border-b border-line-soft px-4 py-3">
          <KeyRound className="size-4 shrink-0 text-brand" strokeWidth={1.8} />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">โทเคนเชื่อมต่อ</h2>
            <p className="mt-0.5 text-xs text-muted-token">
              Loyverse Back Office → Access tokens → เพิ่มโทเคน · เก็บเข้ารหัสในฐานข้อมูล หน้านี้เห็นได้แค่ 4 ตัวท้าย
            </p>
          </div>
        </div>
        <TokenForm state={tok} />
      </section>

      <section className="rounded-lg border border-line bg-surface">
        <div className="flex items-center gap-2.5 border-b border-line-soft px-4 py-3">
          <Store className="size-4 shrink-0 text-brand" strokeWidth={1.8} />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">ร้านและวิธีชำระเงินสำหรับบิลเบิก</h2>
            <p className="mt-0.5 text-xs text-muted-token">
              กดทดสอบเพื่อดึงรายชื่อร้านและวิธีชำระเงินจาก Loyverse · บิลที่จ่ายด้วยวิธีที่เลือกจะนับเป็นของที่ช่างเบิก
            </p>
          </div>
        </div>
        <ConnectPanel
          hasToken={tok.set}
          current={{
            storeId: cfg.data?.store_id ?? null,
            storeName: cfg.data?.store_name ?? null,
            paymentTypeId: cfg.data?.withdraw_payment_type_id ?? null,
            paymentTypeName: cfg.data?.withdraw_payment_type_name ?? null,
          }}
        />
      </section>

      <SyncCard
        ready={tok.set && !!cfg.data?.store_id}
        syncedAt={cfg.data?.items_synced_at ?? null}
        counts={counts}
      />
    </div>
  )
}
