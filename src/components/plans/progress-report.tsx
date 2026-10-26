'use client'

import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, Scale } from 'lucide-react'
import { statusOf, type ProgressReport, type Status } from '@/lib/boq/progress-core'
import { W124_LABEL, type W124State } from '@/lib/boq/w124'
import { fmtMoney } from '@/lib/format'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { useSCurve, type CurveData } from './s-curve'

/**
 * รายงานแผนเทียบจริง — S-Curve · ว.124 · ผลงานรายงวด · รายงานรายงาน
 * ใช้ทั้งแท็บ "ติดตามผลงาน" (อ่านจากไฟล์) และหน้าแผนงานที่บันทึกไว้ (คำนวณจากที่กรอกบนเว็บ)
 */

const STATUS: Record<Status, { label: string; tone: BadgeTone }> = {
  ahead: { label: 'เร็วกว่าแผน', tone: 'done' },
  on: { label: 'ตามแผน', tone: 'info' },
  behind: { label: 'ช้ากว่าแผน', tone: 'urgent' },
}
const W124_TONE: Record<W124State, BadgeTone> = { pass: 'done', pending: 'info', fail: 'urgent' }
const thDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' })
const p1 = (x: number) => `${(x * 100).toFixed(1)}%`
const signed = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${(Math.abs(x) * 100).toFixed(1)}%`

function Bar({ value, plan }: { value: number; plan: number }) {
  return (
    <div className="relative h-2 w-full min-w-16 rounded-xs bg-bar-track" aria-hidden>
      <div className="absolute inset-y-0 left-0 rounded-xs bg-bar-cost-material" style={{ width: `${Math.min(100, value * 100)}%` }} />
      <div className="absolute -inset-y-1 w-0.5 bg-bar-time" style={{ left: `calc(${Math.min(100, plan * 100)}% - 1px)` }} />
    </div>
  )
}

export function ProgressReportView({ report }: { report: ProgressReport }) {
  const [onlyBehind, setOnlyBehind] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)

  const curve = useMemo<CurveData>(
    () => ({
      weekly: report.planWeekly, plan: report.planCum, actual: report.actualCum, labels: report.labels, sublabels: report.sublabels,
      planHalf: report.w124.length > 0,
      fast: report.fastCum,
      ops: report.opsCum,
      checks: [...new Set(report.w124.map((c) => c.x))].map((x) => ({
        x,
        marks: report.w124.filter((c) => c.x === x).map((c) => ({ y: c.min, text: `ว.124 ข้อ ${c.clause} ≥ ${Math.round(c.min * 100)}%` })),
      })),
    }),
    [report],
  )
  useSCurve(canvas, curve)

  const cur = report.installments[report.installments.length - 1]
  const ready = cur != null && cur.plan != null
  const planNow = cur?.plan ?? 0
  const actualNow = cur?.actual ?? 0
  const diff = actualNow - planNow
  const overall = STATUS[statusOf(diff, 0.005)]
  const curLabel = cur ? `งวดที่ ${cur.no}` : 'ยังไม่กรอก'
  const rows = report.tasks.map((t) => ({ ...t, diff: t.actual - t.plan, status: statusOf(t.actual - t.plan, 0.01) }))
  const behind = rows.filter((t) => t.status === 'behind').length
  // งวดที่กรอกผลงานแล้วแต่ไม่มีวันที่ส่งงวด — ไม่รู้ว่าอยู่สัปดาห์ไหน จึงวาดเส้นผลงานจริงไม่ได้
  const undated = report.installments.filter((x) => x.date == null && x.actual > 0).map((x) => x.no)
  const shown = onlyBehind ? rows.filter((t) => t.status === 'behind') : rows

  return (
    <div className="min-w-0 space-y-5">
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
            {report.w124.length > 0 && <span><i className="mr-1 inline-block h-3 w-0 border-l-2 border-dashed border-urgent align-middle" />วันตรวจ ว.124</span>}
          </span>
        </h2>
        {undated.length > 0 && (
          <p className="mb-3 flex items-start gap-2 rounded-md bg-status-progress-bg px-3 py-2 text-sm text-status-progress">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              งวดที่ {undated.join(', ')} กรอกผลงานแล้วแต่ยังไม่มี <b>วันที่ส่งงวด</b> — เส้นผลงานจริง (สีส้ม) จะขึ้นเมื่อใส่วันที่
              เพราะระบบต้องรู้ว่าผลงานนั้นอยู่สัปดาห์ไหน
            </span>
          </p>
        )}
        <canvas ref={canvas} className="block h-[300px] w-full max-w-full" role="img" aria-label="กราฟ S-Curve แผนงานเทียบผลงานจริง" />
        {(report.fastCum || report.opsCum) && (
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-token">
            {([['bg-bar-time', 'แผนงานตามสัญญา', true], ['bg-bar-plan-fast', 'แผนงานเร่งรัด', !!report.fastCum],
              ['bg-bar-plan-ops', 'แผนการทำงานดำเนินการ', !!report.opsCum], ['bg-bar-cost-material', 'ผลงานจริง', true]] as const)
              .filter(([, , on]) => on)
              .map(([cls, label]) => (
                <span key={label} className="inline-flex items-center gap-1.5"><span className={`h-1 w-5 rounded-full ${cls}`} />{label}</span>
              ))}
          </div>
        )}
      </section>

      {report.w124.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
            <Scale className="size-5 text-urgent" />
            ประเมินตามหนังสือกรมบัญชีกลาง ว.124 ข้อ 2.2
          </h2>
          <div className="panel overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-sm">
              <thead>
                <tr className="bg-surface-2 text-left text-xs text-muted-token">
                  <th className="px-3 py-2">ข้อ</th>
                  <th className="px-3 py-2">เงื่อนไข</th>
                  <th className="px-3 py-2">วันที่ตรวจ</th>
                  <th className="px-3 py-2 text-right">ผลงาน ณ วันตรวจ</th>
                  <th className="px-3 py-2">ผลประเมิน</th>
                </tr>
              </thead>
              <tbody>
                {report.w124.map((c) => (
                  <tr key={c.clause} className="border-t border-line-soft">
                    <td className="px-3 py-2 font-semibold text-ink">{c.clause}</td>
                    <td className="px-3 py-2">{c.when} · {c.rule}</td>
                    <td className="px-3 py-2 tabular-nums">{thDate(c.date)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className="font-semibold text-ink">{p1(c.actual)}</span>
                      <div className="text-xs text-muted-token">{c.period ? `งวดที่ ${c.period}` : 'ยังไม่มีงวดก่อนวันตรวจ'}</div>
                    </td>
                    <td className="px-3 py-2"><Badge tone={W124_TONE[c.state]} dot>{W124_LABEL[c.state]}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-token">
            ต่ำกว่าเกณฑ์และความล่าช้าเป็นความผิดของผู้รับจ้าง = หน่วยงานใช้ดุลพินิจบอกเลิกสัญญาได้ · ข้อ 2.2.2 เทียบผลงานสะสมกับครึ่งหนึ่งของแผน (เส้นประเทา) ณ วันส่งงวด แทนผลงานรายเดือน · ไม่ใช้กับงานก่อสร้างบำรุงทาง
          </p>
        </section>
      )}

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
