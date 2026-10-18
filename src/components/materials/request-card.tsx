import type { ReactNode } from 'react'
import { fmtDateTime } from '@/lib/format'
import { fmtQty, itemLabel, MR_STATUS_LABEL, type MrRow } from '@/lib/materials'

const STATUS_TONE = {
  open: 'bg-brand-tint text-brand',
  issued: 'bg-income-bg text-income',
  cancelled: 'bg-surface-2 text-muted-token',
} as const

/**
 * การ์ดใบขอเบิกหนึ่งใบ (R18) — ใช้ทั้งหน้าหัวหน้าโครงการ (/materials) และหน้าแคชเชียร์ (/pickup)
 * `big` = ตัวใหญ่สำหรับแท็บเล็ตหน้าร้าน · `actions` = ปุ่มของหน้านั้น ๆ
 * 🔴 ไม่มีทุน/ราคาเลย — ข้อมูลมาจาก `material_requests_feed` ซึ่งไม่ส่งคอลัมน์เงินออกมา
 */
export function RequestCard({ r, big = false, actions }: { r: MrRow; big?: boolean; actions?: ReactNode }) {
  return (
    <article className="rounded-lg border border-line bg-surface">
      <header className="flex items-start justify-between gap-3 border-b border-line-soft px-4 py-3">
        <div className="min-w-0">
          <p className={`font-bold tabular-nums text-ink ${big ? 'text-2xl tracking-wide' : 'text-base'}`}>
            {r.request_no}
          </p>
          <p className="mt-0.5 truncate text-sm text-ink-2">
            {r.site ?? 'ไม่ระบุโครงการ'}
            {r.employee ? ` · ช่าง ${r.employee}` : ''}
          </p>
          <p className="mt-0.5 text-xs text-muted-token">
            คีย์โดย {r.requested_by ?? '—'} · {fmtDateTime(r.created_at)}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONE[r.status]}`}>
          {MR_STATUS_LABEL[r.status]}
        </span>
      </header>

      <ul className="divide-y divide-line-soft">
        {r.lines.map((l, i) => (
          <li key={`${l.variant_id}-${i}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0">
              <p className={`truncate font-medium text-ink ${big ? 'text-base' : 'text-sm'}`}>{itemLabel(l)}</p>
              <p className="truncate text-xs text-muted-token">
                {[l.sku ? `SKU ${l.sku}` : null, l.barcode ? `บาร์โค้ด ${l.barcode}` : null,
                  l.track_stock && l.in_stock !== null ? `คงเหลือ ${fmtQty(l.in_stock)}` : null]
                  .filter(Boolean)
                  .join(' · ') || '—'}
              </p>
            </div>
            <span className={`shrink-0 font-semibold tabular-nums text-ink ${big ? 'text-xl' : 'text-base'}`}>
              × {fmtQty(l.qty)}
            </span>
          </li>
        ))}
      </ul>

      {(r.note || r.status !== 'open') && (
        <div className="space-y-1 border-t border-line-soft px-4 py-2.5 text-xs text-muted-token">
          {r.note && <p className="text-sm text-ink-2">หมายเหตุ: {r.note}</p>}
          {r.status === 'issued' && (
            <p>จ่ายของแล้วโดย {r.issued_by ?? '—'} · {fmtDateTime(r.issued_at)}</p>
          )}
          {r.status === 'cancelled' && <p>ยกเลิกเมื่อ {fmtDateTime(r.cancelled_at)}</p>}
        </div>
      )}

      {actions && <footer className="border-t border-line-soft px-4 py-3">{actions}</footer>}
    </article>
  )
}
