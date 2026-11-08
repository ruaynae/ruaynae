'use client'

import { useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { FileSpreadsheet, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { BoqCategory } from '@/lib/boq/core'
import { fitCurve, interpolateCum, readActualCurve } from '@/lib/boq/curve-fit'
import type { PlanProgress } from '@/lib/boq/plan-store'

/**
 * R29 · นำเส้นผลงานสะสมรวมจากไฟล์ Excel ของห้าง (แถว "ดำเนินการได้จริง · ความคืบหน้าสะสม") มาลงเป็นผลงานรายสัปดาห์
 * · ถ้าระบุ "สัปดาห์ปลายทาง + % สะสม" ระบบไต่เส้นจากจุดสุดท้ายของไฟล์ไปถึงจุดนั้น (เติมสัปดาห์ที่ยังไม่มีผล)
 * · ผลคือ % รายรายการแบบประมาณ (ตามรูปทรงแผน) ยอดรวมถ่วงมูลค่าตรงเส้น · แก้แค่บนจอ ต้องกดบันทึกผลงานต่อ
 */
export function CurveImportDialog({
  open, onOpenChange, plan, weeks, curWeek, defaultTarget, hasProgress, onApply,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  plan: { categories: BoqCategory[]; days: number }
  weeks: number
  /** สัปดาห์ปัจจุบันตามวันจริง (0 = W1) · null = วันนี้อยู่นอกสัญญา */
  curWeek: number | null
  /** % สะสมที่กรอกไว้ในระบบตอนนี้ (0–1) · null = ยังไม่มี */
  defaultTarget: number | null
  hasProgress: boolean
  onApply: (p: PlanProgress, lastWeek: number) => void
}) {
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState('')
  const [curve, setCurve] = useState<(number | null)[] | null>(null)
  const [tw, setTw] = useState<number>(curWeek != null ? curWeek + 1 : weeks)
  const [pct, setPct] = useState(defaultTarget != null ? String(Math.round(defaultTarget * 10000) / 100) : '')
  const input = useRef<HTMLInputElement>(null)

  const fileLast = curve ? curve.reduce<number>((a, v, i) => (v != null ? i + 1 : a), 0) : 0
  const pctNum = pct.trim() === '' ? null : Number(pct)
  const pctOk = pctNum == null || (Number.isFinite(pctNum) && pctNum >= 0 && pctNum <= 100)

  async function onFile(file: File | undefined) {
    if (!file) return
    setBusy(true)
    try {
      const { readBoqGrids } = await import('@/lib/boq/workbook')
      const grids = await readBoqGrids(await file.arrayBuffer())
      const found = grids.map(readActualCurve).find((c) => c != null) ?? null
      if (!found) return void toast.error('ไม่พบแถว "ดำเนินการได้จริง · ความคืบหน้าสะสม" ในไฟล์นี้')
      setCurve(found.slice(0, weeks))
      setFileName(file.name)
    } catch {
      toast.error('อ่านไฟล์ไม่ได้ — ต้องเป็นไฟล์ .xlsx หรือ .xls')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  function apply() {
    const pts: (number | null)[] = new Array(weeks).fill(null)
    curve?.forEach((v, i) => { if (v != null && i < weeks) pts[i] = v })
    if (pctNum != null) {
      const i = Math.min(weeks, Math.max(1, tw)) - 1
      if (i + 1 <= fileLast) return void toast.error(`สัปดาห์ปลายทางต้องอยู่หลัง W${fileLast} (จุดสุดท้ายของไฟล์)`)
      pts[i] = pctNum / 100
    }
    if (!pts.some((v) => v != null)) return void toast.error('เลือกไฟล์ หรือกรอก % สะสมของสัปดาห์ปลายทาง')
    const r = fitCurve(plan, interpolateCum(pts))
    if (!r.lastWeek) return void toast.error('คำนวณไม่ได้ — แผนนี้ไม่มีรายการที่เปิดอยู่')
    onApply({ weekly: true, items: r.items }, r.lastWeek)
    onOpenChange(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 space-y-4 overflow-y-auto rounded-lg border border-line bg-surface p-5 shadow-e3">
          <div className="flex items-start gap-3">
            <Dialog.Title className="min-w-0 flex-1 text-lg font-semibold text-ink">นำเข้าเส้นผลงานสะสม</Dialog.Title>
            <Dialog.Close className="rounded-md p-1 text-muted-token hover:bg-surface-2" aria-label="ปิด"><X className="size-5" /></Dialog.Close>
          </div>
          <Dialog.Description className="text-sm text-ink-2">
            เลือกไฟล์แผนงาน Excel ของห้าง ระบบอ่านแถว &quot;ดำเนินการได้จริง&quot; แล้วลงผลงานรายสัปดาห์ให้ · ใส่ % สะสมของสัปดาห์ปลายทางเพื่อเติมสัปดาห์ที่ยังไม่มีผลในไฟล์
            · % รายรายการเป็นค่าประมาณตามรูปทรงแผน ส่วนยอดรวมตรงกับเส้นที่ให้
          </Dialog.Description>

          <div className="space-y-2">
            <input ref={input} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
              เลือกไฟล์ Excel
            </button>
            {curve && (
              <p className="text-sm text-ink-2">
                {fileName} · อ่านได้ถึง W{fileLast} สะสม <b className="tabular-nums">{((curve[fileLast - 1] ?? 0) * 100).toFixed(2)}%</b>
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-ink">สัปดาห์ปลายทาง (W)</span>
              <input type="number" min={1} max={weeks} inputMode="numeric" className="input w-full tabular-nums" value={tw}
                onChange={(e) => setTw(Number(e.target.value))} />
              {curWeek != null && <span className="mt-1 block text-xs text-muted-token">สัปดาห์นี้ = W{curWeek + 1}</span>}
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-ink">% สะสมรวม ณ สัปดาห์นั้น</span>
              <input type="number" min={0} max={100} step="0.01" inputMode="decimal" className="input w-full tabular-nums" value={pct}
                onChange={(e) => setPct(e.target.value)} placeholder="เช่น 95.63" />
              {defaultTarget != null && <span className="mt-1 block text-xs text-muted-token">ที่กรอกไว้ตอนนี้ {(defaultTarget * 100).toFixed(2)}%</span>}
            </label>
          </div>
          {!pctOk && <p className="text-sm text-urgent">% ต้องอยู่ระหว่าง 0–100</p>}
          {hasProgress && <p className="text-sm text-urgent">ผลงานที่กรอกไว้ในหน้านี้ทั้งหมดจะถูกแทนที่ (ยังไม่บันทึกจนกว่าจะกดบันทึกผลงาน — กด &quot;ยกเลิกที่แก้&quot; เพื่อย้อนกลับ)</p>}

          <div className="flex justify-end gap-2">
            <Dialog.Close className="btn-secondary">ยกเลิก</Dialog.Close>
            <button type="button" className="btn-primary" disabled={busy || !pctOk} onClick={apply}>ลงผลงานรายสัปดาห์</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
