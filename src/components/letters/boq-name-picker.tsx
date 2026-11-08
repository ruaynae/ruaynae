'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { Loader2, RotateCcw, Search, X } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

export type BoqNamePick = { code: string; name: string; qty: number | null; unit: string; task: string; category: string }
type PlanMeta = { id: string; name: string; siteId: string | null }
type Tree = { categories: { name: string; tasks: { name: string; items: { code: string; name: string; qty: number | null; unit: string }[] }[] }[] }

const key = (c: number, t: number, i: number) => `${c}.${t}.${i}`

/**
 * เลือกรายการจาก BOQ ที่บันทึกไว้ (เมนูแผนงาน) ไปเป็นแถวของตารางแนบหนังสือ — แผนบำรุงรักษา (R33) / สรุปครุภัณฑ์ (R34)
 * · หมวดที่ชื่อมี "ครุภัณฑ์" ขึ้นก่อนและเปิดไว้ · หมวดอื่นกางดูได้ · ค้นหาได้ · ดึงมาแต่ชื่อ/จำนวน/หน่วย (ไม่มีราคา)
 * · เปิดกล่องแล้วค่อยโหลด (กล่องเป็น Radix — โหลดตอน mount ของเนื้อกล่อง ไม่ใช่ใน onOpenChange)
 */
export function BoqNamePicker({
  open, onOpenChange, siteId, title, confirmLabel, onPick,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  siteId: string | null
  title: string
  confirmLabel: string
  onPick: (rows: BoqNamePick[]) => void
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/40 animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[70] flex max-h-[min(44rem,calc(100dvh-2rem))] w-[min(46rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-line bg-surface shadow-e3 animate-pop-in">
          <Body siteId={siteId} title={title} confirmLabel={confirmLabel} onPick={(r) => { onPick(r); onOpenChange(false) }} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Body({ siteId, title, confirmLabel, onPick }: { siteId: string | null; title: string; confirmLabel: string; onPick: (rows: BoqNamePick[]) => void }) {
  const [plans, setPlans] = useState<PlanMeta[] | null>(null)
  const [planId, setPlanId] = useState('')
  const [tree, setTree] = useState<Tree | null>(null)
  const [fail, setFail] = useState<'' | 'missing' | 'error'>('')
  const [q, setQ] = useState('')
  const [all, setAll] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const r = await fetch('/api/letters/boq')
        const j = await r.json().catch(() => ({}))
        if (!live) return
        if (r.status === 503) return setFail('missing')
        if (!r.ok) return setFail('error')
        const list = (j.plans ?? []) as PlanMeta[]
        list.sort((a, b) => Number(b.siteId === siteId) - Number(a.siteId === siteId))
        setFail('')
        setPlans(list)
        if (list[0]) setPlanId(list[0].id)
      } catch {
        if (live) setFail('error')
      }
    })()
    return () => { live = false }
  }, [siteId, attempt])

  useEffect(() => {
    if (!planId) return
    let live = true
    ;(async () => {
      try {
        const r = await fetch(`/api/letters/boq?planId=${encodeURIComponent(planId)}`)
        const j = await r.json().catch(() => ({}))
        if (!live) return
        if (!r.ok) return setFail('error')
        setTree(j as Tree)
      } catch {
        if (live) setFail('error')
      }
    })()
    return () => { live = false }
  }, [planId, attempt])

  const needle = q.trim().toLowerCase()
  const cats = useMemo(() => {
    if (!tree) return []
    return tree.categories
      .map((c, ci) => ({ ...c, ci, equip: /ครุภัณฑ์/.test(c.name) }))
      .filter((c) => all || needle || c.equip || tree.categories.every((x) => !/ครุภัณฑ์/.test(x.name)))
      .map((c) => ({
        ...c,
        tasks: c.tasks.map((t, ti) => ({
          ...t, ti,
          items: t.items.map((it, ii) => ({ it, ii })).filter(({ it }) => !needle || `${it.code} ${it.name} ${t.name}`.toLowerCase().includes(needle)),
        })).filter((t) => t.items.length > 0),
      }))
      .filter((c) => c.tasks.length > 0)
  }, [tree, needle, all])
  const hasEquip = tree?.categories.some((c) => /ครุภัณฑ์/.test(c.name)) ?? false

  const toggle = (k: string) => setPicked((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n })
  function confirm() {
    if (!tree) return
    const rows: BoqNamePick[] = []
    tree.categories.forEach((c, ci) => c.tasks.forEach((t, ti) => t.items.forEach((it, ii) => {
      if (picked.has(key(ci, ti, ii))) rows.push({ code: it.code, name: it.name, qty: it.qty, unit: it.unit, task: t.name, category: c.name })
    })))
    onPick(rows)
  }
  const retry = () => { setFail(''); setPlans(null); setTree(null); setAttempt((n) => n + 1) }
  const loading = fail === '' && (!plans || (planId !== '' && !tree))

  return (
    <>
      <div className="flex items-start gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <Dialog.Title className="text-lg font-bold text-ink">{title}</Dialog.Title>
          <Dialog.Description className="text-xs text-muted-token">จาก BOQ ที่บันทึกไว้ในเมนูแผนงาน · ติ๊กรายการที่ต้องการ</Dialog.Description>
        </div>
        <Dialog.Close className="btn-ghost" aria-label="ปิด"><X className="size-5" /></Dialog.Close>
      </div>
      <div className="space-y-2 border-b border-line px-4 py-3">
        {plans && plans.length > 0 && (
          <select aria-label="แผนงาน" value={planId} onChange={(e) => { setTree(null); setPicked(new Set()); setPlanId(e.target.value) }} className="input-base">
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}{p.siteId && p.siteId === siteId ? ' · โครงการนี้' : ''}</option>)}
          </select>
        )}
        {tree && (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-token" />
              <input aria-label="ค้นหารายการ" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา เช่น เครื่องปรับอากาศ · ตู้เย็น" className="input-base pl-9" />
            </div>
            {hasEquip && (
              <label className="flex items-center gap-2 text-sm text-ink-2">
                <input type="checkbox" className="size-4 accent-brand" checked={all} onChange={(e) => setAll(e.target.checked)} /> แสดงทุกหมวด (ปกติแสดงเฉพาะหมวดครุภัณฑ์)
              </label>
            )}
          </>
        )}
      </div>
      <div className="min-h-40 flex-1 overflow-y-auto px-4 py-3">
        {fail === 'missing' ? (
          <p className="py-8 text-center text-sm text-muted-token">ยังไม่ได้ติดตั้งที่เก็บแผนงานในฐานข้อมูล</p>
        ) : fail === 'error' ? (
          <div className="py-8 text-center">
            <p className="text-sm text-urgent">โหลด BOQ ไม่สำเร็จ</p>
            <button type="button" onClick={retry} className="btn-secondary mt-3"><RotateCcw className="size-4" /> ลองใหม่</button>
          </div>
        ) : loading ? (
          <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="h-10 animate-pulse rounded-md bg-surface-2" />)}</div>
        ) : plans && plans.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-token">
            ยังไม่มี BOQ ที่บันทึกไว้ — บันทึกแผนงานที่ <Link href="/plans" className="font-medium text-brand hover:underline">เมนูแผนงาน</Link> ก่อน หรือปิดกล่องนี้แล้วพิมพ์รายการเอง
          </p>
        ) : cats.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-token">ไม่พบรายการ{needle ? ` ที่ตรงกับ “${q}”` : ''}</p>
        ) : (
          <div className="space-y-4">
            {cats.map((c) => (
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
                              <span className="shrink-0 text-xs text-muted-token tabular-nums">{it.qty ?? '-'} {it.unit}</span>
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
          {loading && <Loader2 className="size-4 animate-spin" />}{confirmLabel}
        </button>
      </div>
    </>
  )
}
