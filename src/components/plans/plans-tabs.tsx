'use client'

import { useState, type ReactNode } from 'react'
import { CalendarRange, FolderOpen, LineChart } from 'lucide-react'
import { PlanBuilder } from './plan-builder'
import { ProgressTracker } from './progress-tracker'

/**
 * สามงานของเมนูแผนงาน: แผนที่บันทึกไว้ (เปิดไปกรอกผลงานรายงวด) · สร้างแผนจาก BOQ (ครั้งเดียวตอนเริ่มโครงการ)
 * · ติดตามผลงานจากไฟล์ Excel ที่กรอกนอกเว็บ
 * · ทุกแท็บอยู่ในหน้า ไม่ล้างกันตอนสลับ — งานที่แก้ค้างในแท็บสร้างแผนไม่หาย
 */
export function PlansTabs({ initial, saved }: { initial: 'saved' | 'build' | 'track'; saved: ReactNode }) {
  const [tab, setTab] = useState(initial)
  const TABS = [
    { id: 'saved' as const, label: 'แผนงานที่บันทึกไว้', icon: FolderOpen },
    { id: 'build' as const, label: 'สร้างแผนงานจาก BOQ', icon: CalendarRange },
    { id: 'track' as const, label: 'ติดตามผลงานจากไฟล์', icon: LineChart },
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
      <div hidden={tab !== 'saved'}>{saved}</div>
      <div hidden={tab !== 'build'}><PlanBuilder /></div>
      <div hidden={tab !== 'track'}><ProgressTracker /></div>
    </div>
  )
}
