import Link from 'next/link'
import { CalendarRange, ChevronRight, FolderOpen } from 'lucide-react'
import { DataError } from '@/components/ui/data-error'
import { EmptyState } from '@/components/ui/states'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { PLAN_MESSAGES } from '@/lib/boq/plan-store'

export type SavedPlanSummary = {
  id: string
  name: string
  start: string
  days: number
  updatedAt: string
  siteName: string | null
}

const endOf = (start: string, days: number) =>
  new Date(Date.parse(`${start}T00:00:00Z`) + (days - 1) * 864e5).toISOString().slice(0, 10)

/** แท็บ "แผนงานที่บันทึกไว้" — เรนเดอร์ฝั่งเซิร์ฟเวอร์ ส่งเข้าแท็บเป็น node */
export function SavedPlanList({ plans, state }: { plans: SavedPlanSummary[]; state: 'ok' | 'error' | 'missing' }) {
  if (state === 'missing') {
    return (
      <div className="panel px-5 py-6 text-sm text-ink-2">
        <div className="mb-1 font-semibold text-status-progress">{PLAN_MESSAGES.PLAN_TABLE_MISSING}</div>
        ระหว่างนี้สร้างแผนและดาวน์โหลด Excel ได้ตามปกติที่แท็บ &quot;สร้างแผนงานจาก BOQ&quot; — แค่ยังบันทึกไว้ในเว็บไม่ได้
      </div>
    )
  }
  if (state === 'error') return <DataError message="โหลดรายการแผนงานไม่สำเร็จ" />
  if (!plans.length) {
    return (
      <EmptyState
        icon={FolderOpen}
        message='ยังไม่มีแผนงานที่บันทึกไว้ — ไปที่แท็บ "สร้างแผนงานจาก BOQ" อัปโหลด BOQ แล้วกด "บันทึกแผนงานไว้ในเว็บ"'
      />
    )
  }
  return (
    <ul className="panel divide-y divide-line-soft">
      {plans.map((p) => (
        <li key={p.id}>
          <Link href={`/plans/${p.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2">
            <CalendarRange className="size-5 shrink-0 text-brand" />
            <div className="min-w-0 flex-1">
              <div className="break-words font-semibold text-ink">{p.name}</div>
              <div className="text-sm text-muted-token">
                {fmtDate(p.start)} – {fmtDate(endOf(p.start, p.days))} · {p.days} วัน · {Math.ceil(p.days / 7)} สัปดาห์
                {p.siteName && <> · โครงการ {p.siteName}</>}
              </div>
              <div className="text-xs text-muted-token">แก้ล่าสุด {fmtDateTime(p.updatedAt)}</div>
            </div>
            <ChevronRight className="size-5 shrink-0 text-muted-token" />
          </Link>
        </li>
      ))}
    </ul>
  )
}
