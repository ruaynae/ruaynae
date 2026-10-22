'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import * as Dialog from '@radix-ui/react-dialog'
import { Download, Loader2, Pencil, RotateCcw, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { planReport } from '@/lib/boq/core'
import { withW124 } from '@/lib/boq/w124'
import { lastFilledPeriod, planMessage, type PlanProgress, type SavedPlan } from '@/lib/boq/plan-store'
import { fmtDate, todayInBangkok } from '@/lib/format'
import { ProgressEntry } from './progress-entry'
import { ProgressReportView } from './progress-report'

/**
 * แผนงานที่บันทึกไว้ (R20i) — กรอกผลงานรายงวดบนเว็บ แล้วเห็น S-Curve/ว.124 ทันที
 * · รายงานคิดจากที่กรอกบนจอ (ยังไม่บันทึกก็เห็น) ด้วยสูตรเดียวกับไฟล์ Excel (`planReport` ≡ `readProgress`)
 * · ดาวน์โหลด Excel = ไฟล์แผนงานพร้อมผลงานที่กรอกไว้ในช่องสีเหลือง
 */

type Site = { id: string; name: string }

async function patch(id: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/plans/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = (await res.json().catch(() => ({}))) as { updatedAt?: string; error?: string }
  return res.ok && j.updatedAt ? { ok: true as const, updatedAt: j.updatedAt } : { ok: false as const, error: j.error ?? '' }
}

export function SavedPlanView({ plan, sites }: { plan: SavedPlan; sites: Site[] }) {
  const router = useRouter()
  const [draft, setDraft] = useState<PlanProgress>(plan.progress)
  const [savedProgress, setSavedProgress] = useState(plan.progress)
  const [updatedAt, setUpdatedAt] = useState(plan.updatedAt)
  const [siteId, setSiteId] = useState(plan.siteId ?? '')
  const [k, setK] = useState(() => Math.min(plan.periods, Math.max(1, lastFilledPeriod(plan.progress))) - 1)
  const [busy, setBusy] = useState<null | 'save' | 'site' | 'export' | 'delete'>(null)
  const [delOpen, setDelOpen] = useState(false)
  const dirty = draft !== savedProgress

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const report = useMemo(() => withW124(planReport({ ...plan, progress: draft }, todayInBangkok())), [plan, draft])

  const pad = (a: (number | null)[] | undefined) => Array.from({ length: plan.periods }, (_, i) => a?.[i] ?? null)
  const setItems = (keys: string[], v: number | null) =>
    setDraft((d) => {
      const items = { ...d.items }
      for (const key of keys) items[key] = pad(items[key]).map((x, i) => (i === k ? v : x))
      return { ...d, items }
    })
  const setDate = (iso: string | null) =>
    setDraft((d) => ({ ...d, dates: Array.from({ length: plan.periods }, (_, i) => (i === k ? iso : d.dates[i] ?? null)) }))

  function failed(code: string) {
    toast.error(planMessage(code))
    if (code === 'PLAN_CHANGED') router.refresh()
  }

  async function onSave() {
    setBusy('save')
    try {
      const r = await patch(plan.id, { expectedUpdatedAt: updatedAt, progress: draft })
      if (!r.ok) return failed(r.error)
      setUpdatedAt(r.updatedAt)
      setSavedProgress(draft)
      toast.success(`บันทึกผลงานงวดที่ ${k + 1} แล้ว`)
      router.refresh()
    } catch {
      toast.error('บันทึกไม่สำเร็จ ตรวจการเชื่อมต่อแล้วลองใหม่')
    } finally {
      setBusy(null)
    }
  }

  async function onSite(next: string) {
    const prev = siteId
    setSiteId(next)
    setBusy('site')
    try {
      const r = await patch(plan.id, { expectedUpdatedAt: updatedAt, siteId: next || null })
      if (!r.ok) {
        setSiteId(prev)
        return failed(r.error)
      }
      setUpdatedAt(r.updatedAt)
      toast.success(next ? 'ผูกกับโครงการแล้ว' : 'เลิกผูกโครงการแล้ว')
    } catch {
      setSiteId(prev)
      toast.error('บันทึกไม่สำเร็จ ตรวจการเชื่อมต่อแล้วลองใหม่')
    } finally {
      setBusy(null)
    }
  }

  async function onExport() {
    setBusy('export')
    try {
      const { buildPlanXlsx } = await import('@/lib/boq/workbook')
      const buf = await buildPlanXlsx({
        project: plan.project, factor: plan.factor, vat: plan.vat, categories: plan.categories,
        days: plan.days, start: plan.start, periods: plan.periods, w124: plan.w124, progress: draft,
      })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      a.download = `แผนงานก่อสร้าง_${plan.name.slice(0, 60).replace(/[\\/:*?"<>|]/g, '')}.xlsx`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
    } catch {
      toast.error('สร้างไฟล์ไม่สำเร็จ ลองใหม่อีกครั้ง')
    } finally {
      setBusy(null)
    }
  }

  async function onDelete() {
    setBusy('delete')
    try {
      const res = await fetch(`/api/plans/${plan.id}`, { method: 'DELETE' })
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) return failed(j.error ?? '')
      toast.success('ลบแผนงานแล้ว')
      router.push('/plans')
      router.refresh()
    } catch {
      toast.error('ลบไม่สำเร็จ ตรวจการเชื่อมต่อแล้วลองใหม่')
    } finally {
      setBusy(null)
    }
  }

  const end = new Date(Date.parse(`${plan.start}T00:00:00Z`) + (plan.days - 1) * 864e5).toISOString().slice(0, 10)

  return (
    <div className="min-w-0 space-y-5">
      <section className="card-surface flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-0 flex-1 text-sm text-ink-2">
          สัญญา {fmtDate(plan.start)} – {fmtDate(end)} · {plan.days} วัน · {plan.periods} งวด
          {plan.w124 && ' · ประเมินตาม ว.124'}
          {plan.sourceFile && <div className="break-words text-xs text-muted-token">จาก BOQ: {plan.sourceFile}</div>}
        </div>
        <label className="w-full sm:w-64">
          <span className="label-base">ผูกกับโครงการ</span>
          <select className="input-base" value={siteId} disabled={busy === 'site'} onChange={(e) => void onSite(e.target.value)}>
            <option value="">— ไม่ผูกโครงการ —</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        {siteId && <Link href={`/sites/${siteId}`} className="btn-secondary">เปิดหน้าโครงการ</Link>}
      </section>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" disabled={busy === 'export'} onClick={() => void onExport()}>
          {busy === 'export' ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          ดาวน์โหลด Excel (พร้อมผลงานที่กรอก)
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => (dirty ? toast.warning('บันทึกผลงานที่กรอกค้างไว้ก่อน แล้วค่อยแก้แผนงาน') : router.push(`/plans/${plan.id}/edit`))}
        >
          <Pencil className="size-4" />แก้แผนงาน
        </button>
        <button type="button" className="btn-secondary text-urgent" onClick={() => setDelOpen(true)}>
          <Trash2 className="size-4" />ลบแผนงาน
        </button>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">กรอกผลงานรายงวด</h2>
        <div role="tablist" className="no-scrollbar flex gap-1.5 overflow-x-auto pb-1">
          {Array.from({ length: plan.periods }, (_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === k}
              onClick={() => setK(i)}
              className={`shrink-0 rounded-md border px-3 py-1.5 text-sm font-semibold tabular-nums transition-colors ${
                i === k ? 'border-brand bg-brand text-white' : 'border-line bg-surface text-ink-2 hover:bg-surface-2'
              }`}
            >
              งวด {i + 1}
              {draft.dates[i] && <span className={`block text-xs font-normal ${i === k ? '' : 'text-muted-token'}`}>{fmtDate(draft.dates[i])}</span>}
            </button>
          ))}
        </div>
        <ProgressEntry
          categories={plan.categories}
          progress={draft}
          k={k}
          onDate={setDate}
          onItem={(key, v) => setItems([key], v)}
          onTask={setItems}
        />
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 lg:bottom-4 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-3 shadow-e2">
          <span className="min-w-0 flex-1 text-sm text-muted-token">
            {dirty ? 'มีผลงานที่ยังไม่ได้บันทึก' : 'บันทึกแล้ว'} · ช่องว่าง = เท่างวดก่อน
          </span>
          <button type="button" className="btn-secondary" disabled={!dirty || busy === 'save'} onClick={() => setDraft(savedProgress)}>
            <RotateCcw className="size-4" />ยกเลิกที่แก้
          </button>
          <button type="button" className="btn-primary" disabled={!dirty || busy === 'save'} onClick={() => void onSave()}>
            {busy === 'save' ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            บันทึกผลงาน
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-ink">แผนงานเทียบผลงานจริง</h2>
        {report.installments.length ? (
          <ProgressReportView report={report} />
        ) : (
          <div className="panel px-5 py-6 text-sm text-muted-token">ยังไม่มีผลงาน — กรอกวันที่ส่งงวดและ % แล้วเสร็จข้างบน แล้ว S-Curve แผนเทียบจริงจะขึ้นตรงนี้ทันที</div>
        )}
      </section>

      <Dialog.Root open={delOpen} onOpenChange={(v) => { if (!busy) setDelOpen(v) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-surface p-5 shadow-e3 animate-pop-in">
            <Dialog.Title className="text-lg font-bold text-ink">ลบแผนงาน</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-token">
              ลบ &quot;{plan.name}&quot; พร้อมผลงานที่กรอกไว้ทุกงวด · กู้คืนไม่ได้ (ไฟล์ Excel ที่ดาวน์โหลดไว้แล้วไม่ถูกลบ)
            </Dialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close disabled={busy !== null} className="btn-secondary">ปิด</Dialog.Close>
              <button type="button" className="btn-danger" disabled={busy !== null} onClick={() => void onDelete()}>
                {busy === 'delete' ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                ลบแผนงาน
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
