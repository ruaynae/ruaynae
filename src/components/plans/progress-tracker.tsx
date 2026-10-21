'use client'

import { useMemo, useRef, useState } from 'react'
import { FileCheck2, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { statusOf, type ProgressReport, type Status } from '@/lib/boq/progress-core'
import { fmtMoney } from '@/lib/format'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { useSCurve, type CurveData } from './s-curve'

/**
 * ติดตามผลงาน — อัปโหลดไฟล์แผนงาน (ที่ดาวน์โหลดจากแท็บแรก) หลังกรอกชีต "ปริมาณงานที่แล้วเสร็จ"
 * แล้วเห็นแผนเทียบจริงทันที · อ่านในเบราว์เซอร์ ไม่บันทึกที่ไหน (ไฟล์คือที่เก็บข้อมูล)
 */

const STATUS: Record<Status, { label: string; tone: BadgeTone }> = {
  ahead: { label: 'เร็วกว่าแผน', tone: 'done' },
  on: { label: 'ตามแผน', tone: 'info' },
  behind: { label: 'ช้ากว่าแผน', tone: 'urgent' },
}
const p1 = (x: number) => `${(x * 100).toFixed(1)}%`
const signed = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${(Math.abs(x) * 100).toFixed(1)}%`

const MESSAGES: Record<string, string> = {
  NOT_PLAN_FILE: 'ไม่ใช่ไฟล์แผนงานจากระบบนี้ — ใช้ไฟล์ที่ดาวน์โหลดจากแท็บ "สร้างแผนงาน" แล้วกรอกชีต "ปริมาณงานที่แล้วเสร็จ"',
}

function Bar({ value, plan }: { value: number; plan: number }) {
  return (
    <div className="relative h-2 w-full min-w-16 rounded-xs bg-bar-track" aria-hidden>
      <div className="absolute inset-y-0 left-0 rounded-xs bg-bar-cost-material" style={{ width: `${Math.min(100, value * 100)}%` }} />
      <div className="absolute -inset-y-1 w-0.5 bg-bar-time" style={{ left: `calc(${Math.min(100, plan * 100)}% - 1px)` }} />
    </div>
  )
}

export function ProgressTracker() {
  const [report, setReport] = useState<ProgressReport | null>(null)
  const [fileName, setFileName] = useState('')
  const [reading, setReading] = useState(false)
  const [over, setOver] = useState(false)
  const [onlyBehind, setOnlyBehind] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)

  const curve = useMemo<CurveData | null>(
    () => (report ? { weekly: report.planWeekly, plan: report.planCum, actual: report.actualCum, labels: report.labels.map((l) => l.split(' ')[0]), sublabels: report.labels.map((l) => l.split(' ')[1] ?? '') } : null),
    [report],
  )
  useSCurve(canvas, curve)

  async function onFile(file: File | undefined) {
    if (!file) return
    if (!/\.xlsx$/i.test(file.name)) {
      toast.error('รองรับเฉพาะไฟล์ Excel (.xlsx)')
      return
    }
    setReading(true)
    try {
      const { readPlanFile } = await import('@/lib/boq/workbook')
      const r = await readPlanFile(await file.arrayBuffer())
      setReport(r)
      setFileName(file.name)
      if (!r.lastWeek) toast.info('ไฟล์นี้ยังไม่มีการกรอก % แล้วเสร็จ — กรอกที่ชีต "ปริมาณงานที่แล้วเสร็จ" แล้วอัปโหลดใหม่')
    } catch (e) {
      const code = e instanceof Error ? e.message : ''
      toast.error(MESSAGES[code] ?? 'อ่านไฟล์ไม่ได้ — ถ้าไฟล์เปิดอยู่ใน Excel ให้ปิดก่อนแล้วลองใหม่')
    } finally {
      setReading(false)
    }
  }

  const upload = (
    <label
      className={`card-surface flex flex-wrap items-center gap-4 border-dashed p-4 transition-colors ${over ? 'border-brand bg-brand-tint' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void onFile(e.dataTransfer.files[0]) }}
    >
      <FileCheck2 className="size-8 shrink-0 text-brand" />
      <div className="min-w-0 flex-1">
        <div className="break-words font-semibold text-ink">{fileName || 'ยังไม่ได้เลือกไฟล์แผนงาน'}</div>
        <div className="text-sm text-muted-token">
          ไฟล์แผนงานที่ดาวน์โหลดจากระบบ และกรอก % ในชีต &quot;ปริมาณงานที่แล้วเสร็จ&quot; แล้ว · ปิดไฟล์ใน Excel ก่อนเลือก
        </div>
      </div>
      <span className={`btn-primary cursor-pointer ${reading ? 'pointer-events-none opacity-60' : ''}`}>
        {reading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        {fileName ? 'เปลี่ยนไฟล์' : 'เลือกไฟล์แผนงาน'}
      </span>
      <input
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = '' }}
      />
    </label>
  )

  if (!report) {
    return (
      <div className="min-w-0 space-y-4">
        {upload}
        <div className="card-surface p-5 text-sm text-ink-2">
          <div className="mb-2 font-semibold text-ink">ใช้อย่างไร</div>
          <ol className="list-decimal space-y-1 pl-5">
            <li>เปิดไฟล์แผนงานที่ดาวน์โหลดไว้ ไปที่ชีต &quot;ปริมาณงานที่แล้วเสร็จ&quot;</li>
            <li>กรอก % แล้วเสร็จสะสมของแต่ละรายการในคอลัมน์ของสัปดาห์นั้น (ช่องสีเหลือง) แล้วบันทึกไฟล์</li>
            <li>อัปโหลดไฟล์ที่นี่ — เห็น S-Curve แผนเทียบจริง และงานไหนเร็ว/ช้ากว่าแผน</li>
          </ol>
        </div>
      </div>
    )
  }

  const lw = report.lastWeek
  const planNow = lw ? report.planCum[lw - 1] : 0
  const actualNow = lw ? (report.actualCum[lw - 1] ?? 0) : 0
  const diff = actualNow - planNow
  const overall = STATUS[statusOf(diff, 0.005)]
  const rows = report.tasks.map((t) => ({ ...t, diff: t.actual - t.plan, status: statusOf(t.actual - t.plan, 0.01) }))
  const behind = rows.filter((t) => t.status === 'behind').length
  const shown = onlyBehind ? rows.filter((t) => t.status === 'behind') : rows

  return (
    <div className="min-w-0 space-y-5">
      {upload}

      <section className="card-surface grid grid-cols-2 gap-4 p-4 lg:grid-cols-5">
        {[
          ['สัปดาห์ล่าสุดที่กรอก', lw ? report.labels[lw - 1] : 'ยังไม่กรอก'],
          ['แผนงานสะสม', p1(planNow)],
          ['ผลงานจริงสะสม', p1(actualNow)],
          ['เร็ว (+) / ช้า (−)', signed(diff)],
        ].map(([l, v]) => (
          <div key={l}>
            <div className="text-xs text-muted-token">{l}</div>
            <div className="text-xl font-bold tabular-nums text-ink">{v}</div>
          </div>
        ))}
        <div>
          <div className="text-xs text-muted-token">สถานะโครงการ</div>
          <div className="mt-1">{lw ? <Badge tone={overall.tone} dot>{overall.label}</Badge> : <span className="text-muted-token">—</span>}</div>
        </div>
      </section>

      <section className="card-surface p-4">
        <h2 className="sec-head">
          S-Curve แผนงานเทียบผลงานจริง
          <span className="count flex gap-3">
            <span><i className="mr-1 inline-block h-0.5 w-4 bg-bar-time align-middle" />แผน</span>
            <span><i className="mr-1 inline-block h-1 w-4 bg-bar-cost-material align-middle" />จริง</span>
          </span>
        </h2>
        <canvas ref={canvas} className="block h-[300px] w-full max-w-full" role="img" aria-label="กราฟ S-Curve แผนงานเทียบผลงานจริง" />
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-ink">รายงาน ณ {lw ? report.labels[lw - 1] : '—'}</h2>
          <label className="ml-auto flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={onlyBehind} onChange={(e) => setOnlyBehind(e.target.checked)} />
            เฉพาะงานที่ช้ากว่าแผน ({behind})
          </label>
        </div>
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="bg-surface-2 text-left text-xs text-muted-token">
                <th className="px-3 py-2">No.</th>
                <th className="px-3 py-2">งาน</th>
                <th className="px-3 py-2 text-right">มูลค่า (บาท)</th>
                <th className="px-3 py-2 text-right">แผน</th>
                <th className="px-3 py-2 text-right">จริง</th>
                <th className="w-40 px-3 py-2">ความคืบหน้า</th>
                <th className="px-3 py-2 text-right">ผลต่าง</th>
                <th className="px-3 py-2">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t, i) => (
                <tr key={t.code} className={`border-t border-line-soft ${i === 0 || shown[i - 1].category !== t.category ? 'border-line' : ''}`}>
                  <td className="px-3 py-2 tabular-nums text-muted-token">{t.code}</td>
                  <td className="min-w-[220px] px-3 py-2 text-ink">
                    {t.name}
                    <div className="text-xs text-muted-token">{t.category}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(t.amount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p1(t.plan)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink">{p1(t.actual)}</td>
                  <td className="px-3 py-2"><Bar value={t.actual} plan={t.plan} /></td>
                  <td className={`px-3 py-2 text-right tabular-nums ${t.status === 'behind' ? 'text-urgent' : t.status === 'ahead' ? 'text-status-done' : ''}`}>{signed(t.diff)}</td>
                  <td className="px-3 py-2">{lw ? <Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge> : '—'}</td>
                </tr>
              ))}
              {!shown.length && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-token">ไม่มีงานที่ช้ากว่าแผน</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-token">
          แท่งส้ม = ผลงานจริงของงานนั้น · ขีดน้ำเงิน = แผน ณ สัปดาห์เดียวกัน · ตัดสินเร็ว/ช้าเมื่อต่างจากแผนเกิน 1 จุด (โครงการ 0.5 จุด) เท่ากับในไฟล์ Excel
        </p>
      </section>
    </div>
  )
}
