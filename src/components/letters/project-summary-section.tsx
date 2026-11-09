'use client'

import { Building2, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { PS_LIMITS, psTotalDays, type ProjectSummary } from '@/lib/project-summary'

/**
 * การ์ด "แนบรายละเอียดโครงการ + สรุปความก้าวหน้า" ในหนังสือส่งมอบงาน (R37) — ติ๊กเมื่อต้องแนบ · แนบหลังใบปะหน้า
 * · ข้อมูลโครงการเติมจากโครงการ/แผนงาน/ชุดเลข แก้ได้ · ใบสรุปความก้าวหน้าคิดจากปริมาณงานที่แล้วเสร็จของหนังสือฉบับนี้เอง (ติ๊กแนบการ์ดข้างบนด้วย)
 */
export function ProjectSummarySection({
  value, onChange, prefill, hasProgress,
}: {
  value: ProjectSummary | null
  onChange: (s: ProjectSummary | null) => void
  /** ค่าตั้งต้นจากโครงการ/แผน/หัวกระดาษ ณ ตอนกด */
  prefill: () => ProjectSummary
  hasProgress: boolean
}) {
  const patch = (p: Partial<ProjectSummary>) => value && onChange({ ...value, ...p })
  const days = value ? psTotalDays(value) : null
  const money = (v: string) => (v.trim() === '' ? null : Number(v.replace(/,/g, '')))
  const num = (n: number | null) => (n == null ? '' : String(n))

  return (
    <section className="card-surface p-4">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 size-5 shrink-0 accent-[var(--brand)]"
          checked={Boolean(value)}
          onChange={(e) => {
            if (e.target.checked) return onChange(prefill())
            if (value) {
              const before = value
              onChange(null)
              toast('เอาใบรายละเอียดโครงการออกจากหนังสือแล้ว (ยังไม่บันทึก)', { action: { label: 'เลิกทำ', onClick: () => onChange(before) } })
            }
          }}
        />
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-base font-semibold text-ink">
            <Building2 className="size-5 text-brand" /> แนบรายละเอียดโครงการ + สรุปความก้าวหน้า
          </span>
          <span className="block text-sm text-muted-token">
            ติ๊กเมื่อต้องแนบ — 2 ใบต่อจากใบปะหน้า · ตัวเลขความก้าวหน้าผูกกับปริมาณงานที่แล้วเสร็จของหนังสือฉบับนี้ (ตรงกับตารางปริมาณงาน/S-Curve เสมอ)
          </span>
        </span>
      </label>

      {value && (
        <div className="mt-3 space-y-3">
          {!hasProgress && (
            <p className="rounded-md border border-status-progress-ring bg-status-progress-bg px-3 py-2 text-sm text-status-progress">
              ยังไม่ได้แนบ &ldquo;ปริมาณงานที่แล้วเสร็จ&rdquo; — จะพิมพ์เฉพาะใบรายละเอียดโครงการ ใบสรุปความก้าวหน้าต้องมีปริมาณงานก่อน
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2"><span className="label-base">ชื่อโครงการ</span>
              <input className="input-base" value={value.project} maxLength={PS_LIMITS.text} onChange={(e) => patch({ project: e.target.value })} />
            </label>
            <label className="block"><span className="label-base">ผู้ว่าจ้าง</span>
              <input className="input-base" value={value.owner} maxLength={PS_LIMITS.text} onChange={(e) => patch({ owner: e.target.value })} />
            </label>
            <label className="block"><span className="label-base">สถานที่ก่อสร้าง</span>
              <input className="input-base" value={value.location} maxLength={PS_LIMITS.text} onChange={(e) => patch({ location: e.target.value })} />
            </label>
            <label className="block"><span className="label-base">สัญญาเลขที่</span>
              <input className="input-base" value={value.contractNo} maxLength={60} onChange={(e) => patch({ contractNo: e.target.value })} />
            </label>
            <label className="block"><span className="label-base">ลงวันที่</span>
              <input type="date" className="input-base" value={value.contractDate} onChange={(e) => patch({ contractDate: e.target.value })} />
            </label>
            <label className="block"><span className="label-base">วันเริ่มต้นสัญญา</span>
              <input type="date" className="input-base" value={value.start} onChange={(e) => patch({ start: e.target.value })} />
            </label>
            <label className="block"><span className="label-base">วันสิ้นสุดสัญญา</span>
              <input type="date" className="input-base" value={value.end} onChange={(e) => patch({ end: e.target.value })} />
            </label>
            <div className="block"><span className="label-base">ระยะเวลาก่อสร้าง (คิดจากวันเริ่ม–สิ้นสุด)</span>
              <p className="input-base flex items-center bg-surface-2 tabular-nums">{days != null ? `${days} วัน` : 'ใส่วันเริ่มและวันสิ้นสุดก่อน'}</p>
            </div>
            <label className="block"><span className="label-base">งวดงานทั้งหมด</span>
              <input type="number" min={1} max={99} className="input-base" value={num(value.installments)} onChange={(e) => patch({ installments: e.target.value ? Number(e.target.value) : null })} />
            </label>
            <label className="block"><span className="label-base">ราคาค่าก่อสร้าง (บาท)</span>
              <input inputMode="decimal" className="input-base tabular-nums" value={num(value.contract)} onChange={(e) => patch({ contract: money(e.target.value) })} />
            </label>
            <label className="block"><span className="label-base">แก้ไขเพิ่มเติม</span>
              <input className="input-base" value={value.amendments} maxLength={PS_LIMITS.text} onChange={(e) => patch({ amendments: e.target.value })} placeholder="ไม่มี = เว้นว่าง" />
            </label>
            <label className="block"><span className="label-base">ผู้รับจ้าง</span>
              <input className="input-base" value={value.contractor} maxLength={PS_LIMITS.text} onChange={(e) => patch({ contractor: e.target.value })} />
            </label>
            <label className="block"><span className="label-base">ตัวแทนผู้รับจ้าง</span>
              <input className="input-base" value={value.rep} maxLength={120} onChange={(e) => patch({ rep: e.target.value })} />
            </label>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold text-ink">สรุปการใช้จ่ายตามปีงบประมาณ</p>
            {value.budget.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
                <label className="block"><span className="label-base">ปีงบประมาณ</span>
                  <input className="input-base" value={r.label} maxLength={40} onChange={(e) => patch({ budget: value.budget.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} />
                </label>
                <label className="block"><span className="label-base">เงินงบประมาณ (บาท)</span>
                  <input inputMode="decimal" className="input-base tabular-nums" value={String(r.budget)} onChange={(e) => patch({ budget: value.budget.map((x, k) => (k === i ? { ...x, budget: Math.max(0, Number(e.target.value.replace(/,/g, '')) || 0) } : x)) })} />
                </label>
                <label className="block"><span className="label-base">เบิกจ่ายแล้ว (บาท)</span>
                  <input inputMode="decimal" className="input-base tabular-nums" value={String(r.paid)} onChange={(e) => patch({ budget: value.budget.map((x, k) => (k === i ? { ...x, paid: Math.max(0, Number(e.target.value.replace(/,/g, '')) || 0) } : x)) })} />
                </label>
                <button type="button" className="btn-ghost" aria-label={`ลบปีงบประมาณที่ ${i + 1}`} onClick={() => patch({ budget: value.budget.filter((_, k) => k !== i) })}><Trash2 className="size-4 text-urgent" /></button>
              </div>
            ))}
            <button type="button" className="btn-secondary" disabled={value.budget.length >= PS_LIMITS.budgetRows}
              onClick={() => patch({ budget: [...value.budget, { label: '', budget: 0, paid: 0 }] })}>
              <Plus className="size-4" /> เพิ่มปีงบประมาณ
            </button>
          </div>

          <button type="button" className="btn-secondary" onClick={() => { onChange({ ...prefill(), budget: value.budget.length ? value.budget : prefill().budget }); toast.success('ดึงข้อมูลโครงการใหม่แล้ว (ยังไม่บันทึก)') }}>
            <RefreshCw className="size-4" /> ดึงข้อมูลจากโครงการ/แผนใหม่
          </button>
        </div>
      )}
    </section>
  )
}
