'use client'

import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, Download, FileSpreadsheet, Loader2, RotateCcw, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { autoSchedule, distribute, type BoqCategory, type BoqModel } from '@/lib/boq/core'
import { fmtMoney, todayInBangkok } from '@/lib/format'
import { useSCurve, type CurveData } from './s-curve'

/**
 * แผนงานก่อสร้างจาก BOQ — อัปโหลด → ตรวจ/แก้ → ดาวน์โหลด Excel
 * ทุกอย่างคำนวณในเบราว์เซอร์ ไม่บันทึกลงฐานข้อมูล (ไฟล์ BOQ มีราคากลางของหน่วยงาน
 * ไม่มีเหตุให้ส่งขึ้นเซิร์ฟเวอร์)
 */

type Contract = { contractor: string; contractNo: string; contractDate: string; contractorRep: string }
type Project = BoqModel['project'] & Contract

const DAY = 864e5
const isoToDate = (iso: string) => new Date(`${iso}T00:00:00Z`)
const addIso = (iso: string, n: number) => new Date(isoToDate(iso).getTime() + n * DAY).toISOString().slice(0, 10)
const thShort = (iso: string) =>
  isoToDate(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' })
const thDay = (iso: string) => isoToDate(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const pct = (x: number) => `${(x * 100).toFixed(2)}%`

const MESSAGES: Record<string, string> = {
  BOQ_EMPTY: 'ไม่พบรายการงานในไฟล์ ตรวจว่าเป็นไฟล์ BOQ ที่มีแบบ ปร.4 / ปร.5 / ปร.6',
}

export function PlanBuilder() {
  const [fileName, setFileName] = useState('')
  const [reading, setReading] = useState(false)
  const [over, setOver] = useState(false)
  const [model, setModel] = useState<BoqModel | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [cats, setCats] = useState<BoqCategory[]>([])
  const [start, setStart] = useState(() => addIso(todayInBangkok(), 14))
  const [days, setDays] = useState(180)
  const [daysText, setDaysText] = useState('180')
  const [periods, setPeriods] = useState('5')
  const [w124, setW124] = useState(false)
  const [exporting, setExporting] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)

  const dist = useMemo(() => distribute(cats, days), [cats, days])

  const curve = useMemo<CurveData | null>(
    () => (cats.length
      ? {
          weekly: dist.perWeek,
          plan: dist.cum,
          labels: dist.cum.map((_, i) => `W${i + 1}`),
          sublabels: dist.cum.map((_, i) => thDay(addIso(start, i * 7))),
        }
      : null),
    [dist, start, cats.length],
  )
  useSCurve(canvas, curve)

  async function onFile(file: File | undefined) {
    if (!file) return
    if (!/\.xlsx?$/i.test(file.name)) {
      toast.error('รองรับเฉพาะไฟล์ Excel (.xlsx หรือ .xls)')
      return
    }
    setReading(true)
    try {
      const { readBoqFile } = await import('@/lib/boq/workbook')
      const m = await readBoqFile(await file.arrayBuffer())
      setModel(m)
      setFileName(file.name)
      setProject({ ...m.project, contractor: project?.contractor ?? '', contractorRep: project?.contractorRep ?? '', contractNo: '', contractDate: '' })
      setCats(autoSchedule(m.categories, days))
      toast.success(`อ่าน BOQ แล้ว · ${m.categories.reduce((s, c) => s + c.tasks.length, 0)} งาน`)
    } catch (e) {
      const code = e instanceof Error ? e.message : ''
      toast.error(MESSAGES[code] ?? 'อ่านไฟล์ไม่ได้ ตรวจว่าเป็นไฟล์ BOQ (.xlsx / .xls) ที่เปิดใน Excel ได้ และไม่ได้ตั้งรหัสผ่าน')
    } finally {
      setReading(false)
    }
  }

  function commitDays() {
    const d = Math.round(Number(daysText))
    if (!(d >= 14 && d <= 1500)) {
      setDaysText(String(days))
      toast.error('ระยะเวลาก่อสร้างต้องอยู่ระหว่าง 14 ถึง 1,500 วัน')
      return
    }
    if (d === days) return
    setDays(d)
    setCats((c) => autoSchedule(c, d))
  }

  function editTask(ci: number, ti: number, patch: { on?: boolean; startIso?: string; dur?: number }) {
    setCats((prev) =>
      prev.map((c, i) =>
        i !== ci
          ? c
          : {
              ...c,
              tasks: c.tasks.map((t, j) => {
                if (j !== ti) return t
                let { offset, dur } = t
                if (patch.startIso) offset = Math.round((isoToDate(patch.startIso).getTime() - isoToDate(start).getTime()) / DAY)
                if (patch.dur != null && Number.isFinite(patch.dur)) dur = Math.max(1, Math.round(patch.dur))
                offset = Math.max(0, Math.min(days - 1, offset))
                dur = Math.min(dur, days - offset)
                return { ...t, offset, dur, on: patch.on ?? t.on }
              }),
            },
      ),
    )
  }

  async function onExport() {
    if (!model || !project) return
    setExporting(true)
    try {
      const { buildPlanXlsx } = await import('@/lib/boq/workbook')
      const n = Math.min(24, Math.max(1, Math.round(Number(periods)) || 5))
      const buf = await buildPlanXlsx({ project, factor: model.factor, vat: model.vat, categories: cats, days, start, periods: n, w124 })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      a.download = `แผนงานก่อสร้าง_${(project.name || 'โครงการ').slice(0, 60).replace(/[\\/:*?"<>|]/g, '')}.xlsx`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
      toast.success('สร้างไฟล์แผนงานแล้ว')
    } catch {
      toast.error('สร้างไฟล์ไม่สำเร็จ ลองใหม่อีกครั้ง')
    } finally {
      setExporting(false)
    }
  }

  const upload = (
    <label
      className={`card-surface flex flex-wrap items-center gap-4 border-dashed p-4 transition-colors ${over ? 'border-brand bg-brand-tint' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void onFile(e.dataTransfer.files[0]) }}
    >
      <FileSpreadsheet className="size-8 shrink-0 text-brand" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-ink break-words">{fileName || 'ยังไม่ได้เลือกไฟล์ BOQ'}</div>
        <div className="text-sm text-muted-token">
          ไฟล์ .xlsx หรือ .xls ที่มีแบบ ปร.4 / ปร.5 / ปร.6 · ลากไฟล์มาวางตรงนี้ก็ได้ · ไฟล์ไม่ถูกส่งขึ้นเซิร์ฟเวอร์
        </div>
      </div>
      <span className={`btn-primary cursor-pointer ${reading ? 'pointer-events-none opacity-60' : ''}`}>
        {reading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        {fileName ? 'เปลี่ยนไฟล์' : 'เลือกไฟล์ BOQ'}
      </span>
      <input
        type="file"
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        className="sr-only"
        onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = '' }}
      />
    </label>
  )

  if (!model || !project) {
    return (
      <div className="min-w-0 space-y-4">
        {upload}
        <div className="card-surface p-5 text-sm text-ink-2">
          <div className="mb-2 font-semibold text-ink">ระบบทำอะไรให้</div>
          <ol className="list-decimal space-y-1 pl-5">
            <li>อ่านแบบ ปร.6 → ปร.5 → ปร.4 แยกหมวดและรายการงาน (ชีตของโครงการอื่นในไฟล์ถูกข้ามให้)</li>
            <li>คิดน้ำหนักงานจากค่างานต้นทุน แล้วจัดลำดับตามขั้นตอนก่อสร้าง (รื้อถอน → งานระบบ → ผนัง พื้น ฝ้า → ตกแต่ง → ครุภัณฑ์)</li>
            <li>แก้วันเริ่ม/จำนวนวันของแต่ละงานได้ แล้วดาวน์โหลดแผนงาน Excel พร้อม S-Curve ไปยื่นหน่วยงาน</li>
            <li>ในไฟล์มีแบบ &quot;ปริมาณงาน และราคา ที่แล้วเสร็จ&quot; แยกชีตตามหมวด ทุกรายการจาก ปร.4 — ส่งงวดงานเมื่อไหร่ กรอกวันที่ส่งงวดกับ % แล้วเสร็จตามหน้างาน แล้วไฟล์คิดมูลค่างานที่ได้ (รวม Factor F/VAT) และเทียบกับแผน ณ วันนั้นว่าเร็ว ตามแผน หรือช้ากว่าแผน</li>
          </ol>
        </div>
      </div>
    )
  }

  const span = dist.weeks * 7
  const at = (d: number) => `${((d / span) * 100).toFixed(3)}%`
  const months: { label: string; days: number }[] = []
  for (let d = 0; d < span; d += 1) {
    const dt = isoToDate(addIso(start, d))
    const label = dt.toLocaleDateString('th-TH', { month: 'short', year: '2-digit', timeZone: 'UTC' })
    const last = months[months.length - 1]
    if (last && last.label === label) last.days += 1
    else months.push({ label, days: 1 })
  }
  const grid = { backgroundImage: `repeating-linear-gradient(to right, transparent 0 calc(${at(7)} - 1px), var(--line-soft) calc(${at(7)} - 1px) ${at(7)})` }
  const field = (k: keyof Project, label: string, extra: { placeholder?: string; wide?: boolean } = {}) => (
    <label className={extra.wide ? 'sm:col-span-2 lg:col-span-3' : ''}>
      <span className="label-base">{label}</span>
      <input
        className="input-base"
        value={String(project[k] ?? '')}
        placeholder={extra.placeholder}
        onChange={(e) => setProject({ ...project, [k]: e.target.value })}
      />
    </label>
  )
  // เลขข้อของหมวด/งานที่ยังติ๊กอยู่ — งานที่ติ๊กออกไม่กินเลข
  const numbers = cats.reduce<{ cat: number; tasks: number[] }[]>((acc, c) => {
    const prev = acc.length ? acc[acc.length - 1].cat : 0
    const cat = c.tasks.some((t) => t.on) ? prev + 1 : prev
    let k = 0
    acc.push({ cat, tasks: c.tasks.map((t) => (t.on ? ++k : 0)) })
    return acc
  }, [])

  return (
    <div className="min-w-0 space-y-5">
      {upload}

      <ul className="space-y-1 text-sm text-muted-token">
        {model.categories.map((c) => (
          <li key={c.name + c.source}>
            › {c.name} — {c.tasks.length} งาน · {c.tasks.reduce((s, t) => s + t.items.length, 0)} รายการย่อย{' '}
            <span className="opacity-80">({c.source})</span>
          </li>
        ))}
        {model.warnings.map((w) => (
          <li key={w} className="flex items-start gap-1.5 text-status-progress"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{w}</li>
        ))}
      </ul>

      <section className="card-surface p-4">
        <h2 className="sec-head">ข้อมูลโครงการและสัญญา</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {field('name', 'ชื่อโครงการ', { wide: true })}
          {field('owner', 'เจ้าของโครงการ')}
          {field('loc1', 'สถานที่ (บรรทัด 1)')}
          {field('loc2', 'สถานที่ (บรรทัด 2)')}
          {field('contractor', 'ผู้รับจ้าง', { placeholder: 'เช่น ห้างหุ้นส่วนจำกัด …' })}
          {field('contractorRep', 'ตัวแทนผู้รับจ้าง', { placeholder: 'ชื่อ-นามสกุล' })}
          {field('contractNo', 'สัญญาเลขที่', { placeholder: 'เช่น 5/2569' })}
          {field('contractDate', 'ลงวันที่สัญญา', { placeholder: 'เช่น 16 มิถุนายน 2569' })}
          <label>
            <span className="label-base">ค่าก่อสร้างทั้งโครงการ (บาท)</span>
            <input
              className="input-base tabular-nums"
              type="number"
              step="0.01"
              value={project.total ?? ''}
              onChange={(e) => setProject({ ...project, total: e.target.value === '' ? null : Number(e.target.value) })}
            />
          </label>
          <label>
            <span className="label-base">วันที่เริ่มงาน</span>
            <input className="input-base" type="date" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} />
          </label>
          <label>
            <span className="label-base">ระยะเวลาก่อสร้าง (วัน)</span>
            <input
              className="input-base tabular-nums"
              inputMode="numeric"
              value={daysText}
              onChange={(e) => setDaysText(e.target.value.replace(/\D/g, ''))}
              onBlur={commitDays}
              onKeyDown={(e) => e.key === 'Enter' && commitDays()}
            />
          </label>
          <label>
            <span className="label-base">จำนวนงวดงาน (ช่องกรอกผลงาน)</span>
            <input
              className="input-base tabular-nums"
              inputMode="numeric"
              value={periods}
              onChange={(e) => setPeriods(e.target.value.replace(/\D/g, '').slice(0, 2))}
              onBlur={() => setPeriods(String(Math.min(24, Math.max(1, Number(periods) || 5))))}
            />
          </label>
          <label className="flex items-start gap-2 self-end text-sm text-ink-2 sm:col-span-full">
            <input type="checkbox" className="mt-1 size-4 shrink-0 accent-[var(--brand)]" checked={w124} onChange={(e) => setW124(e.target.checked)} />
            <span>
              <span className="font-semibold text-ink">ประเมินตามหนังสือกรมบัญชีกลาง ว.124</span>
              <span className="block text-muted-token">เส้นแดงวันตรวจ (เวลาเกิน 1/2 · 3/4 · ครบสัญญา) และเส้นเทา &quot;แผน ÷ 2&quot; บน S-Curve + ตารางผลประเมินในชีตสรุปผลเบิกจ่าย</span>
            </span>
          </label>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
          {[
            [String(dist.plan.length), 'งานในแผน'],
            [fmtMoney(dist.total), 'ค่างานต้นทุนรวม (บาท)'],
            [String(dist.weeks), 'สัปดาห์'],
            [thShort(addIso(start, days - 1)), 'วันแล้วเสร็จ'],
          ].map(([v, l]) => (
            <div key={l}>
              <div className="text-xl font-bold tabular-nums text-ink">{v}</div>
              <div className="text-xs text-muted-token">{l}</div>
            </div>
          ))}
          <button type="button" className="btn-secondary ml-auto" onClick={() => setCats((c) => autoSchedule(c, days))}>
            <RotateCcw className="size-4" />จัดลำดับงานอัตโนมัติใหม่
          </button>
        </div>
        <p className="text-sm text-muted-token">แก้วันเริ่มและจำนวนวันในตารางได้ · ติ๊กออกถ้าไม่รวมงานนั้นในแผน (น้ำหนักงานคิดใหม่เอง)</p>
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-sm">
            <thead>
              <tr className="bg-surface-2 text-left text-xs text-muted-token">
                <th className="w-8 px-2 py-2" />
                <th className="px-2 py-2">No.</th>
                <th className="px-2 py-2">รายการ</th>
                <th className="px-2 py-2 text-right">งบประมาณ (บาท)</th>
                <th className="px-2 py-2 text-right">น้ำหนัก</th>
                <th className="px-2 py-2">เริ่ม</th>
                <th className="px-2 py-2">วัน</th>
                <th className="w-[36%] p-0">
                  <div className="flex h-8">
                    {months.map((m) => (
                      <div key={m.label} style={{ width: at(m.days) }} className="truncate border-l border-line px-1 leading-8">{m.label}</div>
                    ))}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {cats.map((c, ci) => {
                const on = c.tasks.filter((t) => t.on)
                const catNo = numbers[ci].cat
                const lo = on.length ? Math.min(...on.map((t) => t.offset)) : 0
                const hi = on.length ? Math.max(...on.map((t) => t.offset + t.dur)) : 0
                const sum = on.reduce((s, t) => s + t.amount, 0)
                return [
                  <tr key={`c${ci}`} className="border-t border-line bg-surface-2 font-semibold text-ink">
                    <td />
                    <td className="px-2 py-2 tabular-nums">{on.length ? catNo : ''}</td>
                    <td className="px-2 py-2">{c.name}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtMoney(sum)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{dist.total ? pct(sum / dist.total) : '–'}</td>
                    <td colSpan={2} />
                    <td className="p-0">
                      <div className="relative h-8" style={grid}>
                        {on.length > 0 && <div className="absolute top-3.5 h-2 border-x-2 border-b-2 border-bar-time" style={{ left: at(lo), width: at(hi - lo) }} />}
                      </div>
                    </td>
                  </tr>,
                  ...c.tasks.map((t, ti) => {
                    const w = dist.total && t.on ? t.amount / dist.total : 0
                    return (
                      <tr key={`t${ci}-${ti}`} className={`border-t border-line-soft ${t.on ? '' : 'opacity-50'}`}>
                        <td className="px-2 py-1.5">
                          <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={t.on} aria-label="รวมงานนี้ในแผน"
                            onChange={(e) => editTask(ci, ti, { on: e.target.checked })} />
                        </td>
                        <td className="px-2 py-1.5 tabular-nums text-muted-token">{t.on ? `${catNo}.${numbers[ci].tasks[ti]}` : ''}</td>
                        <td className="min-w-[220px] px-2 py-1.5 text-ink">
                          {t.name}
                          <div className="text-xs text-muted-token">{t.source}</div>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmtMoney(t.amount)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{t.on ? pct(w) : '–'}</td>
                        <td className="px-2 py-1.5">
                          <input type="date" className="input-base w-[150px] px-2 py-1 text-sm" aria-label="วันเริ่ม"
                            value={addIso(start, t.offset)} min={start} max={addIso(start, days - 1)}
                            onChange={(e) => e.target.value && editTask(ci, ti, { startIso: e.target.value })} />
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="number" className="input-base w-[76px] px-2 py-1 text-right text-sm tabular-nums" aria-label="จำนวนวัน"
                            min={1} max={days} value={t.dur}
                            onChange={(e) => editTask(ci, ti, { dur: Number(e.target.value) })} />
                        </td>
                        <td className="p-0">
                          <div className="relative h-10" style={grid}>
                            <div
                              className="absolute top-3 h-4 rounded-xs bg-bar-time"
                              style={{ left: at(t.offset), width: at(t.dur) }}
                              title={`${thShort(addIso(start, t.offset))} – ${thShort(addIso(start, t.offset + t.dur - 1))}`}
                            />
                          </div>
                        </td>
                      </tr>
                    )
                  }),
                ]
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card-surface p-4">
        <h2 className="sec-head">S-Curve แผนงาน<span className="count">50% ของงานควรเสร็จที่ W{dist.cum.findIndex((v) => v >= 0.5) + 1}</span></h2>
        <canvas ref={canvas} className="block h-[300px] w-full max-w-full" role="img" aria-label="กราฟ S-Curve ความคืบหน้าสะสมตามแผน" />
      </section>

      <section className="card-surface flex flex-wrap items-center gap-4 p-4">
        <div className="min-w-0 flex-1 text-sm text-muted-token">
          ในไฟล์: <b className="text-ink">แผนงานก่อสร้าง</b> (แท่งรายสัปดาห์ · S-Curve แผนเทียบจริง) ·{' '}
          <b className="text-ink">รายละเอียด</b> · <b className="text-ink">สรุปผลเบิกจ่าย</b> (ระยะเวลา · มูลค่าตามสัญญาเทียบที่ได้จริง · ผลงานรายงวด · งบประมาณรายปี) ·{' '}
          <b className="text-ink">แบบปริมาณงานที่แล้วเสร็จแยกหมวด</b> (กรอก % ในคอลัมน์ &quot;งวดที่&quot;)
        </div>
        <button type="button" className="btn-primary" disabled={exporting || !dist.plan.length} onClick={() => void onExport()}>
          {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          ดาวน์โหลดแผนงาน Excel
        </button>
      </section>
    </div>
  )
}
