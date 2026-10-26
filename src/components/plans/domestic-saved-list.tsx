import Link from 'next/link'
import { ChevronRight, Factory } from 'lucide-react'
import { fmtDateTime } from '@/lib/format'
import { DOMESTIC_MESSAGES } from '@/lib/boq/domestic-store'

export type SavedDomesticSummary = { id: string; name: string; sourceFile: string; updatedAt: string; siteName: string | null }

/**
 * แผนการใช้วัสดุในประเทศที่บันทึกไว้ (R22b) — อยู่บนสุดของแท็บ เหนือช่องอัปโหลด BOQ
 * · ยังไม่มี = ไม่วาดอะไร (ช่องอัปโหลดคือทางเริ่มอยู่แล้ว) · ตารางยังไม่ถูกสร้าง/อ่านไม่ได้ = บอกตรง ๆ
 */
export function DomesticSavedList({ plans, state }: { plans: SavedDomesticSummary[]; state: 'ok' | 'error' | 'missing' }) {
  if (state === 'missing') {
    return <div className="panel px-5 py-4 text-sm text-status-progress">{DOMESTIC_MESSAGES.DOMESTIC_TABLE_MISSING}</div>
  }
  if (state === 'error') {
    return <div className="panel px-5 py-4 text-sm text-urgent">โหลดรายการแผนการใช้วัสดุที่บันทึกไว้ไม่สำเร็จ — โหลดหน้าใหม่อีกครั้ง</div>
  }
  if (!plans.length) return null
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold text-ink">ที่บันทึกไว้</h2>
      <ul className="panel divide-y divide-line-soft">
        {plans.map((p) => (
          <li key={p.id}>
            <Link href={`/plans/domestic/${p.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2">
              <Factory className="size-5 shrink-0 text-brand" />
              <div className="min-w-0 flex-1">
                <div className="break-words font-semibold text-ink">{p.name}</div>
                <div className="break-words text-sm text-muted-token">
                  {p.sourceFile ? `จาก BOQ: ${p.sourceFile}` : 'แผนการใช้พัสดุ/เหล็กในประเทศ'}
                  {p.siteName && <> · โครงการ {p.siteName}</>}
                </div>
                <div className="text-xs text-muted-token">แก้ล่าสุด {fmtDateTime(p.updatedAt)}</div>
              </div>
              <ChevronRight className="size-5 shrink-0 text-muted-token" />
            </Link>
          </li>
        ))}
      </ul>
      <h2 className="pt-2 text-lg font-semibold text-ink">ทำแผนใหม่จาก BOQ</h2>
    </section>
  )
}
