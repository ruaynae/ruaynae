'use client'

import { useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { CalendarClock, FileSpreadsheet, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { similarity, type BoqCategory } from '@/lib/boq/core'
import { applySchedule, readSchedule, type FileSchedule } from '@/lib/boq/schedule-import'

/**
 * R31 · ปรับวันของงานตามไฟล์แผนงาน Excel ของห้าง — เลือกไฟล์ → ดูตัวอย่างการจับคู่ → ใช้กับแผนที่บันทึกไว้
 * · ไฟล์อ่านในเบราว์เซอร์ ไม่ถูกส่งขึ้นเซิร์ฟเวอร์ · ผลงาน % ที่กรอกไว้ไม่หาย (คีย์รายการไม่เปลี่ยน)
 * · เปลี่ยนวันเริ่ม/ระยะเวลาของแผนได้เฉพาะแผนที่ยังไม่ได้กรอกผลงาน (ไม่งั้น W ของผลงานเลื่อน)
 */

const DAY = 864e5
const diff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY)
const addIso = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)
const th = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' })

export function ScheduleImportDialog({
  onClose, plan, hasProgress, busy, onApply,
}: {
  onClose: () => void
  plan: { categories: BoqCategory[]; start: string; days: number }
  hasProgress: boolean
  busy: boolean
  onApply: (categories: BoqCategory[], start: string, days: number) => void
}) {
  const [reading, setReading] = useState(false)
  const [fileName, setFileName] = useState('')
  const [sched, setSched] = useState<FileSchedule | null>(null)
  const [contractFrom, setContractFrom] = useState<'Plan' | 'Actual'>('Actual')
  const [withOps, setWithOps] = useState(true)
  const [setDates, setSetDates] = useState(true)
  const input = useRef<HTMLInputElement>(null)

  async function onFile(file: File | undefined) {
    if (!file) return
    setReading(true)
    try {
      const { readBoqGrids } = await import('@/lib/boq/workbook')
      const grids = await readBoqGrids(await file.arrayBuffer())
      const found = grids.map(readSchedule).find((s) => s != null) ?? null
      if (!found) return void toast.error('ไม่พบตารางแผนงาน (หัวสัปดาห์ W1… และแถว Plan/Actual) ในไฟล์นี้')
      setSched(found)
      setFileName(file.name)
    } catch {
      toast.error('อ่านไฟล์ไม่ได้ — ต้องเป็นไฟล์ .xlsx หรือ .xls')
    } finally {
      setReading(false)
      if (input.current) input.current.value = ''
    }
  }

  const fileDays = sched?.start && sched.end ? diff(sched.start, sched.end) + 1 : null
  const canSetDates = !hasProgress && sched?.start != null && fileDays != null && fileDays >= 14 && fileDays <= 1500
  const useDates = setDates && canSetDates
  const start = useDates ? (sched?.start as string) : plan.start
  const days = useDates ? (fileDays as number) : plan.days

  const result = useMemo(
    () => (sched ? applySchedule(plan.categories, sched.rows, { start, days, contractFrom, withOps, similarity }) : null),
    [sched, plan.categories, start, days, contractFrom, withOps],
  )
  const span = (s: { offset: number; dur: number } | null) => (s ? `${th(addIso(start, s.offset))} – ${th(addIso(start, s.offset + s.dur - 1))} (${s.dur} วัน)` : '—')

  return (
    <Dialog.Root open onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[min(52rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 space-y-4 overflow-y-auto rounded-lg border border-line bg-surface p-5 shadow-e3">
          <div className="flex items-start gap-3">
            <Dialog.Title className="min-w-0 flex-1 text-lg font-semibold text-ink">ปรับวันของงานตามไฟล์แผนงาน</Dialog.Title>
            <Dialog.Close className="rounded-md p-1 text-muted-token hover:bg-surface-2" aria-label="ปิด"><X className="size-5" /></Dialog.Close>
          </div>
          <Dialog.Description className="text-sm text-ink-2">
            เลือกไฟล์แผนงาน Excel ของห้าง (ตารางที่มี W1… และแถว Plan / Actual ต่องาน) ระบบจับคู่งานตามชื่อ แล้วตั้งวันเริ่ม–ระยะเวลาของงานตามไฟล์ ·
            ผลงาน % ที่กรอกไว้ไม่หาย · ยังไม่บันทึกจนกว่าจะกด &quot;ใช้กับแผนนี้&quot;
          </Dialog.Description>

          <div className="space-y-2">
            <input ref={input} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
            <button type="button" className="btn-secondary" disabled={reading} onClick={() => input.current?.click()}>
              {reading ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
              เลือกไฟล์ Excel
            </button>
            {sched && (
              <p className="text-sm text-ink-2">
                {fileName} · พบ {sched.rows.length} งาน · {sched.weeks} สัปดาห์
                {sched.start && sched.end && <> · {th(sched.start)} – {th(sched.end)}{fileDays ? ` (${fileDays} วัน)` : ''}</>}
              </p>
            )}
          </div>

          {sched && result && (
            <>
              <fieldset className="space-y-2 rounded-md border border-line-soft bg-surface-2 p-3 text-sm">
                <legend className="px-1 font-semibold text-ink">แถวไหนในไฟล์คือ &quot;แผนงานตามสัญญา&quot;</legend>
                <label className="flex cursor-pointer items-start gap-2">
                  <input type="radio" name="sch-src" className="mt-1 accent-[var(--brand)]" checked={contractFrom === 'Actual'} onChange={() => setContractFrom('Actual')} />
                  <span>แถว <b>Actual</b> (ช่องสีเหลือง) — ถ้าป้ายสัญลักษณ์ในไฟล์ระบุว่าสีเหลือง = แผนงานตามสัญญา · แถว Plan เป็นแผนการทำงานดำเนินการ</span>
                </label>
                <label className="flex cursor-pointer items-start gap-2">
                  <input type="radio" name="sch-src" className="mt-1 accent-[var(--brand)]" checked={contractFrom === 'Plan'} onChange={() => setContractFrom('Plan')} />
                  <span>แถว <b>Plan</b> — ถ้าไฟล์ใช้แถว Plan เป็นแผนตามสัญญา (แถว Actual เป็นผลงานจริง)</span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 pt-1">
                  <input type="checkbox" className="mt-1 accent-[var(--brand)]" checked={withOps} onChange={(e) => setWithOps(e.target.checked)} />
                  <span>ตั้งอีกแถวเป็น <b>แผนการทำงานดำเนินการ</b> (เปิดแผนนี้ให้ในแผนงาน)</span>
                </label>
                <label className={`flex items-start gap-2 ${canSetDates ? 'cursor-pointer' : 'opacity-60'}`}>
                  <input type="checkbox" className="mt-1 accent-[var(--brand)]" disabled={!canSetDates} checked={useDates} onChange={(e) => setSetDates(e.target.checked)} />
                  <span>
                    ตั้งวันเริ่ม–สิ้นสุดของแผนตามไฟล์
                    {hasProgress && ' — ทำไม่ได้: แผนนี้กรอกผลงานแล้ว (วันที่เปลี่ยนจะทำให้ W ของผลงานเลื่อน) ใช้วันเดิมของแผนคิดช่วงของงาน'}
                    {!hasProgress && !canSetDates && ' — ไม่พบวันเริ่ม/แล้วเสร็จที่ใช้ได้ในไฟล์'}
                  </span>
                </label>
              </fieldset>

              <div className="space-y-2">
                <p className="text-sm font-semibold text-ink">
                  จับคู่ได้ {result.matched.length} งาน
                  {result.unmatched.length > 0 && <span className="text-urgent"> · ไม่พบในแผน {result.unmatched.length}</span>}
                  {result.untouched.length > 0 && <span className="text-muted-token"> · งานในแผนที่ไม่มีในไฟล์ (คงวันเดิม) {result.untouched.length}</span>}
                </p>
                <div className="max-h-72 overflow-auto rounded-md border border-line-soft">
                  <table className="w-full min-w-[40rem] text-left text-sm">
                    <thead className="sticky top-0 bg-surface-2 text-xs text-muted-token">
                      <tr><th className="px-2 py-1.5">งานในไฟล์ → งานในแผน</th><th className="px-2 py-1.5">แผนตามสัญญา</th>{withOps && <th className="px-2 py-1.5">แผนดำเนินการ</th>}</tr>
                    </thead>
                    <tbody>
                      {result.matched.map((m, i) => (
                        <tr key={i} className="border-t border-line-soft align-top">
                          <td className="px-2 py-1.5">
                            {m.fileName}
                            {m.fileName !== m.taskName && <span className="block text-xs text-muted-token">→ {m.taskName}{m.score < 0.85 ? ' (ชื่อใกล้เคียง)' : ''}</span>}
                          </td>
                          <td className="px-2 py-1.5 tabular-nums">{span(m.contract)}</td>
                          {withOps && <td className="px-2 py-1.5 tabular-nums">{span(m.ops)}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {result.unmatched.length > 0 && (
                  <p className="text-xs text-urgent">ไม่พบในแผน (ข้าม): {result.unmatched.join(' · ')}</p>
                )}
              </div>
            </>
          )}

          <div className="flex justify-end gap-2">
            <Dialog.Close className="btn-secondary">ยกเลิก</Dialog.Close>
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !result || !result.matched.length}
              onClick={() => result && onApply(result.categories, start, days)}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <CalendarClock className="size-4" />}
              ใช้กับแผนนี้
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
