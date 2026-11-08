'use client'

import { AlertTriangle, ClipboardList, Loader2, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  buildProgressWork, filledWeeks, pwTotal, ratio, weekEndIso, type ProgressWork, type PwSource,
} from '@/lib/progress-work'

/**
 * การ์ด "แนบปริมาณงานที่แล้วเสร็จ" ในหนังสือส่งมอบงาน (R28) — ติ๊กเมื่อต้องแนบ (บางงานไม่ต้อง)
 * · ดึงจากแผนงานที่บันทึกไว้ในเมนูแผนงาน ณ สิ้นสัปดาห์ที่เลือก แล้วพิมพ์เป็นแผ่นแนวนอนต่อท้ายหนังสือ
 * · เก็บเป็นภาพนิ่งกับหนังสือ — แก้ผลงานในแผนทีหลัง ต้องกด "ดึงผลงานใหม่" เอง
 */

type PlanOption = { id: string; name: string; siteId: string | null }

const pct = (x: number) => `${(x * 100).toFixed(2)}%`
const money = (x: number) => x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const thShort = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' })

export function ProgressWorkSection({
  value, onChange, siteId,
}: {
  value: ProgressWork | null
  onChange: (pw: ProgressWork | null) => void
  /** โครงการของชุดเลข — แผนของโครงการนี้ขึ้นก่อน */
  siteId: string | null
}) {
  const [picking, setPicking] = useState(false)
  const checked = Boolean(value) || picking
  const total = value ? pwTotal(value) : null

  return (
    <section className="card-surface p-4">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 size-5 shrink-0 accent-[var(--brand)]"
          checked={checked}
          onChange={(e) => {
            if (e.target.checked) return setPicking(true)
            setPicking(false)
            if (value) {
              const before = value
              onChange(null)
              toast('เอาปริมาณงานที่แล้วเสร็จออกจากหนังสือแล้ว (ยังไม่บันทึก)', { action: { label: 'เลิกทำ', onClick: () => onChange(before) } })
            }
          }}
        />
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-base font-semibold text-ink">
            <ClipboardList className="size-5 text-brand" /> แนบปริมาณงานที่แล้วเสร็จ
          </span>
          <span className="block text-sm text-muted-token">
            ติ๊กเมื่องวดนี้ต้องแนบ — ตารางแยกค่าวัสดุ/ค่าแรงจากแผนงานที่บันทึกไว้ พิมพ์ต่อท้ายหนังสือ และเติมบรรทัด &ldquo;สิ่งที่ส่งมาด้วย&rdquo; ให้
          </span>
        </span>
      </label>

      {value && total && !picking && (
        <div className="mt-3 space-y-2">
          <dl className="grid grid-cols-2 gap-2 text-center tabular-nums sm:grid-cols-3">
            <div className="rounded-md border border-line-soft bg-surface-2 px-2 py-2 sm:col-span-1 col-span-2">
              <dt className="text-xs text-muted-token">แผนงาน</dt>
              <dd className="mt-0.5 break-words text-sm font-semibold text-ink">{value.planName}</dd>
            </div>
            <div className="rounded-md border border-line-soft bg-surface-2 px-2 py-2">
              <dt className="text-xs text-muted-token">ผลงาน ณ</dt>
              <dd className="mt-0.5 font-semibold text-ink">W{value.week} · {thShort(value.asOf)}</dd>
            </div>
            <div className="rounded-md border border-brand bg-brand-tint px-2 py-2">
              <dt className="text-xs text-muted-token">ผลงานสะสม</dt>
              <dd className="mt-0.5 text-lg font-semibold text-brand">{pct(ratio(total.value, value.contract))}</dd>
            </div>
          </dl>
          <p className="text-sm text-ink-2">
            มูลค่าที่แล้วเสร็จ (รวมตัวคูณ) ฿{money(total.value)} · ค่าวัสดุ {pct(ratio(total.matDone, total.mat))} · ค่าแรง {pct(ratio(total.labDone, total.lab))}
          </p>
          {value.unsplit > 0 && (
            <p className="flex items-start gap-2 rounded-md border border-status-progress-ring bg-status-progress-bg px-3 py-2 text-sm text-status-progress">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                {value.unsplit} รายการในแผนยังไม่แยกค่าวัสดุ/ค่าแรง (ลงช่องค่าวัสดุทั้งก้อน) — เปิด{' '}
                <Link href={`/plans/${value.planId}`} className="font-semibold underline">แผนงาน</Link>{' '}
                แล้วกด &ldquo;เติมค่าวัสดุ/ค่าแรงจาก BOQ&rdquo; จากนั้นกลับมากดดึงผลงานใหม่
              </span>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary" onClick={() => setPicking(true)}>
              <RefreshCw className="size-4" /> ดึงผลงานใหม่ / เปลี่ยนสัปดาห์
            </button>
            <span className="text-xs text-muted-token">ไฟล์ Word ไม่มีตารางนี้ — ใช้ปุ่มพิมพ์ / PDF</span>
          </div>
        </div>
      )}

      {checked && (picking || !value) && (
        <Picker
          siteId={siteId}
          current={value}
          onCancel={() => setPicking(false)}
          onPick={(pw) => {
            onChange(pw)
            setPicking(false)
            toast.success(`แนบปริมาณงานที่แล้วเสร็จ W${pw.week} แล้ว (ยังไม่บันทึก)`)
          }}
        />
      )}
    </section>
  )
}

/**
 * ตัวเลือกแผน + สัปดาห์ — mount เฉพาะตอนเปิด แล้วโหลดตอน mount (§17 ข้อ 46)
 * · setState หลัง await เท่านั้น (§17 ข้อ 16)
 */
function Picker({
  siteId, current, onCancel, onPick,
}: {
  siteId: string | null
  current: ProgressWork | null
  onCancel: () => void
  onPick: (pw: ProgressWork) => void
}) {
  const [plans, setPlans] = useState<PlanOption[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0)
  const [planId, setPlanId] = useState(current?.planId ?? '')
  const [src, setSrc] = useState<{ id: string; plan: PwSource } | null>(null)
  const [srcFailed, setSrcFailed] = useState(false)
  const [week, setWeek] = useState<number | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const r = await fetch('/api/letters/boq')
        const j = (await r.json().catch(() => ({}))) as { plans?: PlanOption[] }
        if (!live) return
        if (!r.ok || !j.plans) return setFailed(true)
        const list = [...j.plans].sort((a, b) => Number(b.siteId === siteId && siteId != null) - Number(a.siteId === siteId && siteId != null))
        setFailed(false)
        setPlans(list)
        setPlanId((cur) => cur || list[0]?.id || '')
      } catch {
        if (live) setFailed(true)
      }
    })()
    return () => { live = false }
  }, [siteId, reload])

  useEffect(() => {
    if (!planId) return
    let live = true
    ;(async () => {
      try {
        const r = await fetch(`/api/letters/boq?planId=${encodeURIComponent(planId)}&progress=1`)
        const j = (await r.json().catch(() => ({}))) as { plan?: PwSource }
        if (!live) return
        if (!r.ok || !j.plan) return setSrcFailed(true)
        setSrcFailed(false)
        setSrc({ id: planId, plan: j.plan })
        const weeks = filledWeeks(j.plan.progress)
        setWeek(current?.planId === planId ? current.week : weeks[weeks.length - 1] ?? null)
      } catch {
        if (live) setSrcFailed(true)
      }
    })()
    return () => { live = false }
  }, [planId, current])

  if (failed) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-urgent">
        โหลดรายชื่อแผนงานไม่สำเร็จ
        <button type="button" className="btn-secondary" onClick={() => { setFailed(false); setReload((x) => x + 1) }}>ลองใหม่</button>
      </div>
    )
  }
  if (!plans) {
    return <div className="mt-3 flex items-center gap-2 text-sm text-muted-token"><Loader2 className="size-4 animate-spin" /> กำลังโหลดแผนงาน…</div>
  }
  if (!plans.length) {
    return (
      <p className="mt-3 text-sm text-muted-token">
        ยังไม่มีแผนงานที่บันทึกไว้ — สร้างที่เมนู <Link href="/plans" className="font-semibold text-brand underline">แผนงานก่อสร้าง</Link> แล้วกรอกผลงานรายสัปดาห์ก่อน
      </p>
    )
  }

  const ready = src && src.id === planId
  const weeks = ready ? filledWeeks(src.plan.progress) : []
  return (
    <div className="mt-3 space-y-3 rounded-md border border-line-soft bg-surface-2 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label-base">แผนงาน</span>
          <select className="input-base" value={planId} onChange={(e) => { setPlanId(e.target.value); setWeek(null) }}>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label-base">ผลงาน ณ สิ้นสัปดาห์</span>
          <select
            className="input-base"
            value={week ?? ''}
            disabled={!ready || !weeks.length}
            onChange={(e) => setWeek(Number(e.target.value) || null)}
          >
            {!ready && <option value="">กำลังโหลด…</option>}
            {ready && !weeks.length && <option value="">แผนนี้ยังไม่ได้กรอกผลงาน</option>}
            {ready && weeks.map((w) => (
              <option key={w} value={w}>W{w} · {thShort(weekEndIso(src.plan.start, src.plan.days, w))}</option>
            ))}
          </select>
        </label>
      </div>
      {srcFailed && <p className="text-sm text-urgent">โหลดแผนงานนี้ไม่สำเร็จ — เลือกใหม่หรือลองอีกครั้ง</p>}
      {ready && !weeks.length && (
        <p className="text-sm text-muted-token">
          กรอก % แล้วเสร็จที่ <Link href={`/plans/${planId}`} className="font-semibold text-brand underline">หน้าแผนงาน</Link> ก่อน แล้วกลับมาเลือกใหม่
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={!ready || !week}
          onClick={() => ready && week && onPick(buildProgressWork(src.plan, week))}
        >
          <ClipboardList className="size-4" /> แนบผลงาน{week ? ` W${week}` : ''}
        </button>
        {current && <button type="button" className="btn-secondary" onClick={onCancel}>ยกเลิก</button>}
      </div>
    </div>
  )
}
