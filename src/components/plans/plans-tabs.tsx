'use client'

import { useState } from 'react'
import { CalendarRange, LineChart } from 'lucide-react'
import { PlanBuilder } from './plan-builder'
import { ProgressTracker } from './progress-tracker'

/**
 * สองงานของเมนูแผนงาน: สร้างแผนจาก BOQ (ครั้งเดียวตอนเริ่มโครงการ) · ติดตามผลงาน (ทุกสัปดาห์/ทุกงวด)
 * · ทั้งสองแท็บอยู่ในหน้า ไม่ล้างกันตอนสลับ — งานที่แก้ค้างในแท็บแรกไม่หาย
 */
export function PlansTabs({ initial }: { initial: 'build' | 'track' }) {
  const [tab, setTab] = useState(initial)
  const TABS = [
    { id: 'build' as const, label: 'สร้างแผนงานจาก BOQ', icon: CalendarRange },
    { id: 'track' as const, label: 'ติดตามผลงาน (แผนเทียบจริง)', icon: LineChart },
  ]
  return (
    <div className="min-w-0 space-y-4">
      <div role="tablist" className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors ${
              tab === t.id ? 'border-brand text-brand' : 'border-transparent text-muted-token hover:text-ink'
            }`}
          >
            <t.icon className="size-4" />
            {t.label}
          </button>
        ))}
      </div>
      <div hidden={tab !== 'build'}><PlanBuilder /></div>
      <div hidden={tab !== 'track'}><ProgressTracker /></div>
    </div>
  )
}
