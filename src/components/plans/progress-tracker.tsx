'use client'

import { useMemo, useRef, useState } from 'react'
import { FileCheck2, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { statusOf, type ProgressReport, type Status } from '@/lib/boq/progress-core'
import { fmtMoney } from '@/lib/format'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { useSCurve, type CurveData } from './s-curve'

/**
 * ติดตามผลงาน — อัปโหลดไฟล์แผนงาน (ที่ดาวน์โหลดจากแท็บแรก) หลังกรอกผลงานรายงวดแล้ว
 * แล้วเห็นแผนเทียบจริงทันที · อ่านในเบราว์เซอร์ ไม่บันทึกที่ไหน (ไฟล์คือที่เก็บข้อมูล)
 */

const STATUS: Record<Status, { label: string; tone: BadgeTone }> = {
  ahead: { label: 'เร็วกว่าแผน', tone: 'done' },
  on: { label: 'ตามแผน', tone: 'info' },
  behind: { label: 'ช้ากว่าแผน', tone: 'urgent' },
}
const thDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' })
const p1 = (x: number) => `${(x * 100).toFixed(1)}%`
const signed = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${(Math.abs(x) * 100).toFixed(1)}%`

const MESSAGES: Record<string, string> = {
  NOT_PLAN_FILE: 'ไม่ใช่ไฟล์แผนงานจากระบบนี้ — ใช้ไฟล์ที่ดาวน์โหลดจากแท็บ "สร้างแผนงาน" แล้วกรอกผลงานรายงวด',
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
    () => (report ? { weekly: report.planWeekly, plan: report.planCum, actual: report.actualCum, labels: report.labels, sublabels: report.sublabels } : null),
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
      if (!r.installments.length) toast.info('ไฟล์นี้ยังไม่มีการกรอกผลงาน — กรอก % แล้วเสร็จที่ชีตหมวด (คอลัมน์ "งวดที่") และวันที่ส่งงวดที่ชีต "สรุปผลเบิกจ่าย" แล้วอัปโหลดใหม่')
      else if (r.installments.some((p) => !p.date)) toast.warning('มีงวดที่ยังไม่ใส่วันที่ส่งงวด — งวดนั้นเทียบกับแผนไม่ได้')
      else if (r.start && r.installments.some((p) => p.date && p.date < r.start!))
        toast.warning('มีวันที่ส่งงวดก่อนวันเริ่มสัญญาในไฟล์ — ตรวจวันที่ในแถว "วันที่ส่งงวด"')
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
          ไฟล์แผนงานที่ดาวน์โหลดจากระบบ และกรอกผลงานรายงวดแล้ว · ปิดไฟล์ใน Excel ก่อนเลือก
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
            <li>ส่งงวดเมื่อไหร่ เปิดไฟล์แผนงานที่ดาวน์โหลดไว้ ใส่วันที่ส่งงวดที่ชีต &quot;สรุปผลเบิกจ่าย&quot;</li>
            <li>ที่ชีตหมวด (เช่น &quot;1 งานสถาปัตยกรรม&quot;) กรอก % แล้วเสร็จสะสมของแต่ละรายการในคอลัมน์ &quot;งวดที่ …&quot; (ช่องสีเหลือง) แล้วบันทึกไฟล์</li>
            <li>อัปโหลดไฟล์ที่นี่ — เห็น S-Curve แผนเทียบจริง และงานไหนเร็ว/ช้ากว่าแผน</li>
          </ol>
        </div>
      </div>
    )
  }

  const cur = report.installments[report.installments.length - 1]
  const ready = cur != null && cur.plan != null
  const planNow = cur?.plan ?? 0
  const actualNow = cur?.actual ?? 0
  const diff = actualNow - planNow
  const overall = STATUS[statusOf(diff, 0.005)]
  const curLabel = cur ? `งวดที่ ${cur.no}` : 'ยังไม่กรอก'
  const rows = report.tasks.map((t) => ({ ...t, diff: t.actual - t.plan, status: statusOf(t.actual - t.plan, 0.01) }))
  const behind = rows.filter((t) => t.status === 'behind').length
  const shown = onlyBehind ? rows.filter((t) => t.status === 'behind') : rows

  return (
    <div className="min-w-0 space-y-5">
      {upload}

      <section className="card-surface grid grid-cols-2 gap-4 p-4 lg:grid-cols-5">
        {[
          ['งวดล่าสุด', cur ? `${curLabel}${cur.date ? ` · ${thDate(cur.date)}` : ''}` : curLabel],
          ['แผนงานสะสม ณ วันส่งงวด', ready ? p1(planNow) : '—'],
          ['ผลงานจริงสะสม', cur ? p1(actualNow) : '—'],
          ['เร็ว (+) / ช้า (−)', ready ? signed(diff) : '—'],
        ].map(([l, v]) => (
          <div key={l}>
            <div className="text-xs text-muted-token">{l}</div>
            <div className="text-xl font-bold tabular-nums text-ink">{v}</div>
          </div>
        ))}
        <div>
          <div className="text-xs text-muted-token">สถานะโครงการ</div>
          <div className="mt-1">
            {ready ? <Badge tone={overall.tone} dot>{overall.label}</Badge>
              : <span className="text-sm text-muted-token">{cur ? 'ใส่วันที่ส่งงวดก่อน' : '—'}</span>}
          </div>
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

      {report.installments.length > 0 && (
        <section className="panel overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-sm">
            <thead>
              <tr className="bg-surface-2 text-left text-xs text-muted-token">
                <th className="px-3 py-2">งวด</th>
                <th className="px-3 py-2">วันที่ส่งงวด</th>
                <th className="px-3 py-2 text-right">แผนสะสม</th>
                <th className="px-3 py-2 text-right">จริงสะสม</th>
                <th className="px-3 py-2 text-right">ผลต่าง</th>
                <th className="px-3 py-2">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {report.installments.map((p) => {
                const st = p.plan == null ? null : statusOf(p.actual - p.plan, 0.005)
                return (
                  <tr key={p.no} className="border-t border-line-soft">
                    <td className="px-3 py-2 font-semibold text-ink">งวดที่ {p.no}</td>
                    <td className="px-3 py-2">{p.date ? `${thDate(p.date)} (W${p.week})` : <span className="text-status-progress">ยังไม่ใส่วันที่</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.plan == null ? '—' : p1(p.plan)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink">{p1(p.actual)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${st === 'behind' ? 'text-urgent' : st === 'ahead' ? 'text-status-done' : ''}`}>
                      {p.plan == null ? '—' : signed(p.actual - p.plan)}
                    </td>
                    <td className="px-3 py-2">{st ? <Badge tone={STATUS[st].tone}>{STATUS[st].label}</Badge> : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-ink">รายงาน ณ {cur ? curLabel : '—'}</h2>
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
                  <td className="px-3 py-2">{ready ? <Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge> : '—'}</td>
                </tr>
              ))}
              {!shown.length && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-token">ไม่มีงานที่ช้ากว่าแผน</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-token">
          แท่งส้ม = ผลงานจริงของงานนั้น · ขีดน้ำเงิน = แผน ณ วันส่งงวดเดียวกัน · ตัดสินเร็ว/ช้าเมื่อต่างจากแผนเกิน 1 จุด (โครงการ 0.5 จุด) เท่ากับในไฟล์ Excel
        </p>
      </section>
    </div>
  )
}
