'use client'

import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Activity, Loader2, X } from 'lucide-react'
import type { BoqCategory } from '@/lib/boq/core'
import { fitCurve, interpolateCum } from '@/lib/boq/curve-fit'
import type { PlanProgress } from '@/lib/boq/plan-store'

/**
 * R32 · ประมาณรูปทรงผลงานรายสัปดาห์จากข้อมูลในระบบ — ต้นทุนที่บันทึกไว้ในโครงการที่ผูกกับแผน (ค่าแรงที่ลงชื่อ + รายจ่ายที่อนุมัติแล้ว)
 * 🔴 เป็นค่าประมาณ ไม่ใช่ % ที่ตรวจรับ: ต้นทุนไม่เท่าความคืบหน้า (ซื้อของล่วงหน้า · จ่ายช้า · งานที่ไม่คิดเงิน) ·
 *    ต้องแจ้งให้ชัดตอนนำไปใช้ · ใช้เป็นร่างบนจอ แก้ได้ก่อนกดบันทึกผลงาน
 */

type Activity = { siteName: string; start: string; weeks: number; labor: number[]; expense: number[]; capped: boolean }
const money = (x: number) => x.toLocaleString('en-US', { maximumFractionDigits: 0 })
const pct = (x: number) => `${(x * 100).toFixed(1)}%`

export function ActivityEstimateDialog({
  planId, plan, planCum, onClose, onApply,
}: {
  planId: string
  plan: { categories: BoqCategory[]; days: number }
  /** แผนสะสมรายสัปดาห์ (0–1) ไว้เทียบ */
  planCum: number[]
  onClose: () => void
  onApply: (p: PlanProgress, lastWeek: number) => void
}) {
  const [data, setData] = useState<Activity | null>(null)
  const [err, setErr] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const r = await fetch(`/api/plans/${planId}/activity`)
        const j = (await r.json().catch(() => ({}))) as Partial<Activity> & { error?: string }
        if (!live) return
        if (j.error === 'PLAN_NO_SITE') return setErr('แผนนี้ยังไม่ได้ผูกกับโครงการ — ผูกที่ช่อง "ผูกกับโครงการ" ก่อน')
        if (!r.ok || !j.labor || !j.expense) return setErr('โหลดข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง')
        setErr('')
        setData(j as Activity)
      } catch {
        if (live) setErr('โหลดข้อมูลไม่สำเร็จ ตรวจการเชื่อมต่อแล้วลองใหม่')
      }
    })()
    return () => { live = false }
  }, [planId, reload])

  const calc = useMemo(() => {
    if (!data) return null
    const total = data.labor.map((l, i) => l + data.expense[i])
    let last = -1
    total.forEach((v, i) => { if (v > 0) last = i })
    const sum = total.reduce((a, b) => a + b, 0)
    const withData = total.filter((v) => v > 0).length
    let acc = 0
    const cum = total.map((v) => (acc += v, sum > 0 ? acc / sum : 0))
    return { total, cum, last, sum, withData }
  }, [data])

  function apply() {
    if (!calc || calc.last < 0) return
    // สะสมถึงสัปดาห์สุดท้ายที่มีข้อมูล = 100% (ต้นทุนทั้งหมดที่บันทึกไว้) แล้วกระจายเป็น % รายรายการตามรูปทรงแผน
    const pts: (number | null)[] = calc.cum.map((v, i) => (i <= calc.last ? v : null))
    const r = fitCurve(plan, interpolateCum(pts))
    if (!r.lastWeek) return
    onApply({ weekly: true, items: r.items }, r.lastWeek)
  }

  const few = calc != null && calc.withData < Math.max(3, Math.round((calc.last + 1) * 0.5))
  return (
    <Dialog.Root open onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[min(46rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 space-y-4 overflow-y-auto rounded-lg border border-line bg-surface p-5 shadow-e3">
          <div className="flex items-start gap-3">
            <Dialog.Title className="min-w-0 flex-1 text-lg font-semibold text-ink">ประมาณผลงานจากข้อมูลในระบบ</Dialog.Title>
            <Dialog.Close className="rounded-md p-1 text-muted-token hover:bg-surface-2" aria-label="ปิด"><X className="size-5" /></Dialog.Close>
          </div>
          <Dialog.Description className="text-sm text-ink-2">
            สรุปต้นทุนรายสัปดาห์ของโครงการที่ผูกกับแผนนี้ (ค่าแรงที่ลงชื่อ + รายจ่ายที่อนุมัติแล้ว) แล้วดูรูปทรงว่าลงแรง/ลงทุนไปเมื่อไหร่ ·
            <b> เป็นค่าประมาณจากต้นทุน ไม่ใช่ % ที่ตรวจรับ</b> — ซื้อวัสดุล่วงหน้าหรือจ่ายช้าจะทำให้รูปทรงเพี้ยน
          </Dialog.Description>

          {err && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-urgent">
              {err}
              <button type="button" className="btn-secondary" onClick={() => { setErr(''); setReload((x) => x + 1) }}>ลองใหม่</button>
            </div>
          )}
          {!data && !err && <div className="flex items-center gap-2 text-sm text-muted-token"><Loader2 className="size-4 animate-spin" /> กำลังโหลด…</div>}

          {data && calc && (
            <>
              <p className="text-sm text-ink-2">โครงการ {data.siteName || '—'} · รวมต้นทุนที่บันทึกไว้ ฿{money(calc.sum)} · มีข้อมูล {calc.withData} จาก {data.weeks} สัปดาห์</p>
              {(calc.sum <= 0 || few) && (
                <p className="rounded-md border border-status-progress-ring bg-status-progress-bg px-3 py-2 text-sm text-status-progress">
                  {calc.sum <= 0
                    ? 'ยังไม่มีข้อมูลต้นทุนของโครงการนี้ในช่วงของแผน — ประมาณไม่ได้'
                    : 'ข้อมูลน้อยกว่าครึ่งของสัปดาห์ที่ผ่านมา — รูปทรงที่ประมาณได้ไม่น่าเชื่อถือ ระวังก่อนนำไปใช้'}
                </p>
              )}
              {data.capped && <p className="text-xs text-urgent">ข้อมูลเกินเพดานที่อ่านได้ (30,000 แถว) — ตัวเลขอาจไม่ครบ</p>}
              <div className="max-h-72 overflow-auto rounded-md border border-line-soft">
                <table className="w-full min-w-[34rem] text-right text-sm tabular-nums">
                  <thead className="sticky top-0 bg-surface-2 text-xs text-muted-token">
                    <tr><th className="px-2 py-1.5 text-left">สัปดาห์</th><th className="px-2 py-1.5">ค่าแรง</th><th className="px-2 py-1.5">รายจ่ายอื่น</th><th className="px-2 py-1.5">สะสมตามต้นทุน</th><th className="px-2 py-1.5">แผนสะสม</th></tr>
                  </thead>
                  <tbody>
                    {data.labor.map((l, i) => (
                      <tr key={i} className="border-t border-line-soft">
                        <td className="px-2 py-1 text-left">W{i + 1}</td>
                        <td className="px-2 py-1">{money(l)}</td>
                        <td className="px-2 py-1">{money(data.expense[i])}</td>
                        <td className="px-2 py-1">{i <= calc.last ? pct(calc.cum[i]) : '—'}</td>
                        <td className="px-2 py-1 text-muted-token">{planCum[i] != null ? pct(planCum[i]) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-token">
                &ldquo;ใช้เป็นร่างผลงาน&rdquo; ตั้งสะสมถึงสัปดาห์สุดท้ายที่มีข้อมูล (W{calc.last + 1}) = 100% แล้วกระจายเป็น % รายรายการตามรูปทรงแผน · แทนที่ผลงานที่กรอกค้างบนหน้าจอ ·
                ยังไม่บันทึกจนกว่าจะกด &ldquo;บันทึกผลงาน&rdquo; · ตอนยื่นงานควรระบุว่าเป็นค่าประมาณจากต้นทุน
              </p>
            </>
          )}

          <div className="flex justify-end gap-2">
            <Dialog.Close className="btn-secondary">ปิด</Dialog.Close>
            <button type="button" className="btn-primary" disabled={!calc || calc.last < 0 || calc.sum <= 0} onClick={apply}>
              <Activity className="size-4" /> ใช้เป็นร่างผลงาน
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
