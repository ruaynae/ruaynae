'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { Loader2, RotateCcw, Search, X } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { isEquipName, itemFromBoq, coMoney, type BoqPickItem, type CoRow, type CoSide } from '@/lib/change-order'

type PlanMeta = { id: string; name: string; siteId: string | null; factor: number | null }
type BoqTree = { factor: number | null; categories: { name: string; tasks: { name: string; items: BoqPickItem[] }[] }[] }

const key = (c: number, t: number, i: number) => `${c}.${t}.${i}`

/**
 * เลือกรายการจาก BOQ ที่บันทึกไว้ในเมนูแผนงาน (R25) → แถวตารางงานเพิ่ม-ลด
 * · แผนของโครงการเดียวกับชุดเลขหนังสือขึ้นก่อน · แต่ละงานที่เลือกได้แถวหัวข้อ (ชื่องาน) + รายการ · หมวดได้แถวหมวด
 * · ราคาต่อหน่วย = ค่างานต้นทุน ÷ จำนวน ใส่ช่องค่าวัสดุ (BOQ ที่บันทึกไว้ไม่ได้แยกค่าแรง)
 */
export function ChangeOrderBoqPicker({
  open,
  onOpenChange,
  siteId,
  target,
  onPick,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  siteId: string | null
  target: CoSide
  onPick: (rows: CoRow[], factor: number | null) => void
}) {
  const [plans, setPlans] = useState<PlanMeta[] | null>(null)
  const [planId, setPlanId] = useState<string>('')
  const [tree, setTree] = useState<BoqTree | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'missing'>('idle')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [attempt, setAttempt] = useState(0)

  // รายชื่อแผนงาน — โหลดเมื่อเปิดกล่องครั้งแรก (หรือกดลองใหม่)
  useEffect(() => {
    if (!open || plans) return
    let alive = true
    fetch('/api/letters/boq')
      .then(async (r) => {
        const j = await r.json().catch(() => ({}))
        if (!alive) return
        if (r.status === 503) { setState('missing'); return }
        if (!r.ok) { setState('error'); return }
        const list = (j.plans ?? []) as PlanMeta[]
        list.sort((a, b) => Number(b.siteId === siteId) - Number(a.siteId === siteId))
        setPlans(list)
        if (list[0]) setPlanId(list[0].id)
      })
      .catch(() => alive && setState('error'))
    return () => { alive = false }
  }, [open, plans, siteId, attempt])

  // รายการของแผนที่เลือก
  useEffect(() => {
    if (!open || !planId) return
    let alive = true
    fetch(`/api/letters/boq?planId=${encodeURIComponent(planId)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}))
        if (!alive) return
        if (!r.ok) { setState('error'); return }
        setTree(j as BoqTree)
        setState('idle')
      })
      .catch(() => alive && setState('error'))
    return () => { alive = false }
  }, [open, planId, attempt])

  const needle = q.trim().toLowerCase()
  const visible = useMemo(() => {
    if (!tree) return []
    return tree.categories.map((c, ci) => ({
      ...c,
      ci,
      tasks: c.tasks.map((t, ti) => ({
        ...t,
        ti,
        items: t.items
          .map((it, ii) => ({ it, ii }))
          .filter(({ it }) => !needle || `${it.code} ${it.name} ${t.name}`.toLowerCase().includes(needle)),
      })).filter((t) => t.items.length > 0),
    })).filter((c) => c.tasks.length > 0)
  }, [tree, needle])

  const toggle = (k: string) => setPicked((p) => {
    const n = new Set(p)
    if (n.has(k)) n.delete(k)
    else n.add(k)
    return n
  })

  function confirm() {
    if (!tree) return
    const rows: CoRow[] = []
    tree.categories.forEach((c, ci) => {
      let catDone = false
      c.tasks.forEach((t, ti) => {
        const items = t.items.filter((_, ii) => picked.has(key(ci, ti, ii)))
        if (!items.length) return
        const equip = isEquipName(c.name)
        // หมวดครุภัณฑ์ต้องมีแถวหมวดเสมอ (ธงอยู่ที่แถวนี้) แม้ BOQ มีหมวดเดียว
        if (!catDone && (tree.categories.length > 1 || equip)) rows.push({ t: 'group', no: String(ci + 1), text: c.name, ...(equip ? { equip: true } : {}) })
        catDone = true
        rows.push({ t: 'head', text: t.name })
        let lastHead = ''
        for (const it of items) {
          // หัวข้อย่อยจาก BOQ (เช่น Built In … : B-01) ขึ้นเหนือรายการ ครั้งเดียวต่อกลุ่มที่ติดกัน
          if (it.head && it.head !== lastHead) rows.push({ t: 'head', text: it.head })
          lastHead = it.head ?? ''
          rows.push(itemFromBoq(it))
        }
      })
    })
    onPick(rows, tree.factor)
    setPicked(new Set())
    onOpenChange(false)
  }

  const retry = () => { setState('loading'); setPlans(null); setTree(null); setAttempt((n) => n + 1) }
  const loading = (open && !plans && state !== 'error' && state !== 'missing') || (planId && !tree && state !== 'error')

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/40 animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[70] flex max-h-[min(44rem,calc(100dvh-2rem))] w-[min(46rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-line bg-surface shadow-e3 animate-pop-in">
          <div className="flex items-start gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-lg font-bold text-ink">เลือกจาก BOQ → {target === 'cut' ? 'งานลด' : 'งานเพิ่ม'}</Dialog.Title>
              <Dialog.Description className="text-xs text-muted-token">
                จาก BOQ ที่บันทึกไว้ในเมนูแผนงาน · ราคาต่อหน่วยตามสัญญา (รวมค่าวัสดุและค่าแรง ใส่ไว้ช่องค่าวัสดุ)
              </Dialog.Description>
            </div>
            <Dialog.Close className="btn-ghost" aria-label="ปิด"><X className="size-5" /></Dialog.Close>
          </div>

          <div className="space-y-2 border-b border-line px-4 py-3">
            {plans && plans.length > 0 && (
              <select aria-label="แผนงาน" value={planId} onChange={(e) => { setTree(null); setPicked(new Set()); setPlanId(e.target.value) }} className="input-base">
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.siteId && p.siteId === siteId ? ' · โครงการนี้' : ''}</option>
                ))}
              </select>
            )}
            {tree && (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-token" />
                <input aria-label="ค้นหารายการ" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา เช่น B-04 · ตู้ · สายไฟ" className="input-base pl-9" />
              </div>
            )}
          </div>

          <div className="min-h-40 flex-1 overflow-y-auto px-4 py-3">
            {state === 'missing' ? (
              <p className="py-8 text-center text-sm text-muted-token">ยังไม่ได้ติดตั้งที่เก็บแผนงานในฐานข้อมูล</p>
            ) : state === 'error' ? (
              <div className="py-8 text-center">
                <p className="text-sm text-urgent">โหลด BOQ ไม่สำเร็จ</p>
                <button type="button" onClick={retry} className="btn-secondary mt-3"><RotateCcw className="size-4" /> ลองใหม่</button>
              </div>
            ) : loading ? (
              <div className="space-y-2" aria-busy="true">
                {[0, 1, 2, 3].map((i) => <div key={i} className="h-10 animate-pulse rounded-md bg-surface-2" />)}
              </div>
            ) : plans && plans.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-token">
                ยังไม่มี BOQ ที่บันทึกไว้ — อัปโหลด BOQ แล้วกด &ldquo;บันทึกแผนงานไว้ในเว็บ&rdquo; ที่{' '}
                <Link href="/plans" className="font-medium text-brand hover:underline">เมนูแผนงาน</Link>
              </p>
            ) : visible.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-token">ไม่พบรายการที่ตรงกับ &ldquo;{q}&rdquo;</p>
            ) : (
              <div className="space-y-4">
                {visible.map((c) => (
                  <section key={c.ci}>
                    <h3 className="mb-1 text-sm font-bold text-ink">{c.name}</h3>
                    {c.tasks.map((t) => (
                      <div key={t.ti} className="mb-2">
                        <p className="mb-1 text-sm font-semibold text-ink-2">{t.name}</p>
                        <ul className="space-y-1">
                          {t.items.map(({ it, ii }) => {
                            const k = key(c.ci, t.ti, ii)
                            return (
                              <li key={k}>
                                <label className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-surface-2">
                                  <input type="checkbox" checked={picked.has(k)} onChange={() => toggle(k)} className="mt-1 size-4 shrink-0 accent-brand" />
                                  <span className="min-w-0 flex-1 text-sm text-ink">{it.code ? `${it.code} ` : ''}{it.name}</span>
                                  <span className="shrink-0 text-right text-xs text-muted-token tabular-nums">
                                    {it.qty ?? '-'} {it.unit}<br />฿{coMoney(it.amount, false)}
                                  </span>
                                </label>
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    ))}
                  </section>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
            <span className="mr-auto text-sm text-muted-token">เลือกแล้ว {picked.size} รายการ</span>
            <Dialog.Close className="btn-secondary">ยกเลิก</Dialog.Close>
            <button type="button" onClick={confirm} disabled={picked.size === 0} className="btn-primary">
              {loading ? <Loader2 className="size-4 animate-spin" /> : null}
              เพิ่มเข้า{target === 'cut' ? 'งานลด' : 'งานเพิ่ม'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
