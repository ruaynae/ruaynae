'use client'

import { Factory, Loader2, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { DomModel } from '@/lib/boq/domestic'
import { DS_MIN_MATERIAL, DS_MIN_STEEL, buildDomesticSummary, dsPass, dsRate, dsTotal, type DomesticSummary } from '@/lib/domestic-summary'

type Meta = { id: string; name: string; siteId: string | null }
const pct = (x: number) => `${(x * 100).toFixed(2)}%`
const baht = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })

/**
 * การ์ด "สรุปการใช้พัสดุในประเทศ" (R35) — ดึงจากแผนการใช้พัสดุในประเทศที่บันทึกไว้ (เมนูแผนงาน → แท็บแผนการใช้วัสดุในประเทศ)
 * · เก็บเป็นภาพนิ่งกับหนังสือ — แก้ธงเหล็ก/นำเข้าในแผนทีหลัง ต้องกด "ดึงใหม่" เอง
 */
export function DomesticSummarySection({
  value, onChange, siteId,
}: {
  value: DomesticSummary | null
  onChange: (s: DomesticSummary | null) => void
  siteId: string | null
}) {
  const [plans, setPlans] = useState<Meta[] | null>(null)
  const [planId, setPlanId] = useState(value?.planId ?? '')
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const r = await fetch('/api/letters/domestic')
        const j = await r.json().catch(() => ({}))
        if (!live) return
        if (r.status === 503) return setState('missing')
        if (!r.ok) return setState('error')
        const list = (j.plans ?? []) as Meta[]
        list.sort((a, b) => Number(b.siteId === siteId) - Number(a.siteId === siteId))
        setPlans(list)
        setPlanId((cur) => cur || list[0]?.id || '')
        setState('ready')
      } catch {
        if (live) setState('error')
      }
    })()
    return () => { live = false }
  }, [siteId, attempt])

  async function pull() {
    if (!planId) return
    setBusy(true)
    try {
      const r = await fetch(`/api/letters/domestic?id=${encodeURIComponent(planId)}`)
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.plan) return toast.error('ดึงแผนไม่สำเร็จ ลองใหม่อีกครั้ง')
      const s = buildDomesticSummary(j.plan.model as DomModel, { planId: j.plan.id, planName: j.plan.name })
      onChange(s)
      toast.success('ดึงสรุปการใช้พัสดุแล้ว (ยังไม่บันทึก)')
    } catch {
      toast.error('ดึงแผนไม่สำเร็จ ตรวจการเชื่อมต่อแล้วลองใหม่')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card-surface space-y-3 p-4">
      <h2 className="flex items-center gap-2 text-base font-semibold text-ink"><Factory className="size-5 text-brand" /> สรุปการใช้พัสดุในประเทศ</h2>
      <p className="text-sm text-muted-token">
        ดึงจากแผนการใช้พัสดุในประเทศที่บันทึกไว้ → พิมพ์เป็นตารางรายงานผล (พัสดุ ≥ 60% · เหล็ก ≥ 90%) ต่อท้ายหนังสือ · ไฟล์ Word ไม่มีตารางนี้ — ใช้ปุ่มพิมพ์ / PDF
      </p>
      {state === 'loading' && <div className="flex items-center gap-2 text-sm text-muted-token"><Loader2 className="size-4 animate-spin" /> กำลังโหลดแผน…</div>}
      {state === 'missing' && <p className="text-sm text-muted-token">ยังไม่ได้ติดตั้งตารางแผนการใช้วัสดุในฐานข้อมูล (migration 20261027090000)</p>}
      {state === 'error' && (
        <p className="text-sm text-urgent">โหลดรายชื่อแผนไม่สำเร็จ <button type="button" className="btn-secondary ml-2" onClick={() => { setState('loading'); setAttempt((n) => n + 1) }}>ลองใหม่</button></p>
      )}
      {state === 'ready' && plans && plans.length === 0 && (
        <p className="text-sm text-muted-token">ยังไม่มีแผนที่บันทึกไว้ — ทำที่เมนูแผนงาน → แท็บ &ldquo;แผนการใช้วัสดุในประเทศ&rdquo; แล้วกด &ldquo;บันทึกไว้ในเว็บ&rdquo;</p>
      )}
      {state === 'ready' && plans && plans.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block min-w-0 flex-1"><span className="label-base">แผนการใช้พัสดุในประเทศ</span>
            <select className="input-base" value={planId} onChange={(e) => setPlanId(e.target.value)}>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}{p.siteId && p.siteId === siteId ? ' · โครงการนี้' : ''}</option>)}
            </select>
          </label>
          <button type="button" className="btn-primary" onClick={pull} disabled={busy || !planId}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}{value ? 'ดึงใหม่' : 'ดึงสรุป'}
          </button>
        </div>
      )}
      {value && (
        <dl className="grid gap-2 text-center tabular-nums sm:grid-cols-2">
          {[{ what: 'พัสดุ', p: value.material, min: DS_MIN_MATERIAL }, ...(value.steel ? [{ what: 'เหล็ก', p: value.steel, min: DS_MIN_STEEL }] : [])].map(({ what, p, min }) => (
            <div key={what} className="rounded-md border border-line-soft bg-surface-2 px-2 py-2">
              <dt className="text-xs text-muted-token">{what} · {p.count} รายการ · ฿{baht(dsTotal(p))}</dt>
              <dd className={`mt-0.5 text-lg font-semibold ${dsPass(p, min) ? 'text-brand' : 'text-urgent'}`}>
                ในประเทศ {pct(dsRate(p))} {dsPass(p, min) ? '· ผ่านเกณฑ์' : `· ต่ำกว่า ${Math.round(min * 100)}%`}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {value && !value.steel && <p className="text-xs text-muted-token">แผนนี้ไม่มีรายการเหล็ก</p>}
    </section>
  )
}
