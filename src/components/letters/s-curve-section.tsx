'use client'

import { LineChart, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { planReport } from '@/lib/boq/core'
import { withW124 } from '@/lib/boq/w124'
import { buildSCurveAttach, type SCurveAttach } from '@/lib/s-curve-attach'
import { type PwSource } from '@/lib/progress-work'
import { todayInBangkok } from '@/lib/format'
import { Picker } from '@/components/letters/progress-work-section'

/**
 * การ์ด "แนบ S-Curve" ในหนังสือส่งมอบงาน (R30) — ติ๊กเมื่อต้องแนบ
 * · ดึงแผนงานที่บันทึกไว้ ตัดผลงาน ณ สิ้นสัปดาห์ที่เลือก แล้วพิมพ์กราฟแผนเทียบจริงเป็นแผ่นแนวนอนต่อท้ายหนังสือ
 * · เก็บเป็นภาพนิ่งกับหนังสือ — แก้ผลงานในแผนทีหลัง ต้องกด "ดึงใหม่" เอง
 */

const pct = (x: number) => `${(x * 100).toFixed(2)}%`
const thShort = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' })

export function SCurveSection({
  value, onChange, siteId, defaultDate,
}: {
  value: SCurveAttach | null
  onChange: (s: SCurveAttach | null) => void
  siteId: string | null
  defaultDate: string
}) {
  const [picking, setPicking] = useState(false)
  const checked = Boolean(value) || picking

  function pick(src: PwSource, week: number) {
    // ตัดผลงานถึงสัปดาห์ที่เลือก — เส้นจริงและสถานะ ว.124 คิด ณ สัปดาห์นั้น ไม่ใช่สัปดาห์ล่าสุดของแผน
    const items = Object.fromEntries(Object.entries(src.progress.items).map(([k, a]) => [k, a.slice(0, week)]))
    const report = withW124(planReport({
      name: src.name, categories: src.categories, start: src.start, days: src.days, w124: src.w124 === true,
      progress: { items }, project: { total: src.project.total },
    }, todayInBangkok()))
    const s = buildSCurveAttach(report, {
      planId: src.id, planName: src.name, project: src.project.name || src.name, week,
      asOf: value?.asOf ?? defaultDate,
    })
    onChange(s)
    setPicking(false)
    toast.success(`แนบ S-Curve ณ W${week} แล้ว (ยังไม่บันทึก)`)
  }

  return (
    <section className="card-surface p-4">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 size-5 shrink-0 accent-[var(--brand)]"
          checked={checked}
          onChange={(e) => {
            if (e.target.checked) return setPicking(true)
            setPicking(false)
            if (value) {
              const before = value
              onChange(null)
              toast('เอา S-Curve ออกจากหนังสือแล้ว (ยังไม่บันทึก)', { action: { label: 'เลิกทำ', onClick: () => onChange(before) } })
            }
          }}
        />
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-base font-semibold text-ink">
            <LineChart className="size-5 text-brand" /> แนบ S-Curve (แผนเทียบผลงานจริง)
          </span>
          <span className="block text-sm text-muted-token">
            ติ๊กเมื่องวดนี้ต้องแนบ — กราฟจากแผนงานที่บันทึกไว้ พิมพ์เป็นแผ่นแนวนอนต่อท้ายหนังสือ และเติมบรรทัด &ldquo;สิ่งที่ส่งมาด้วย&rdquo; ให้
          </span>
        </span>
      </label>

      {value && !picking && (
        <div className="mt-3 space-y-2">
          <dl className="grid grid-cols-2 gap-2 text-center tabular-nums sm:grid-cols-3">
            <div className="col-span-2 rounded-md border border-line-soft bg-surface-2 px-2 py-2 sm:col-span-1">
              <dt className="text-xs text-muted-token">แผนงาน</dt>
              <dd className="mt-0.5 break-words text-sm font-semibold text-ink">{value.planName}</dd>
            </div>
            <div className="rounded-md border border-line-soft bg-surface-2 px-2 py-2">
              <dt className="text-xs text-muted-token">ตัดผลงาน ณ</dt>
              <dd className="mt-0.5 font-semibold text-ink">W{value.week} · {thShort(value.asOf)}</dd>
            </div>
            <div className="rounded-md border border-brand bg-brand-tint px-2 py-2">
              <dt className="text-xs text-muted-token">แผน / จริง</dt>
              <dd className="mt-0.5 text-lg font-semibold text-brand">{pct(value.planNow)} / {pct(value.actualValue ?? value.actualNow)}</dd>
            </div>
          </dl>
          <label className="block sm:w-64">
            <span className="label-base">ผลงาน ณ วันที่ (วันส่งงวด)</span>
            <input
              type="date"
              className="input-base"
              value={value.asOf}
              onChange={(e) => e.target.value && onChange({ ...value, asOf: e.target.value })}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary" onClick={() => setPicking(true)}>
              <RefreshCw className="size-4" /> ดึงใหม่ / เปลี่ยนสัปดาห์
            </button>
            <span className="text-xs text-muted-token">ไฟล์ Word ไม่มีกราฟนี้ — ใช้ปุ่มพิมพ์ / PDF</span>
          </div>
        </div>
      )}

      {checked && (picking || !value) && (
        <Picker
          siteId={siteId}
          current={value ? { planId: value.planId, week: value.week } : null}
          onCancel={() => setPicking(false)}
          onPick={pick}
          buttonLabel="แนบ S-Curve"
        />
      )}
    </section>
  )
}
