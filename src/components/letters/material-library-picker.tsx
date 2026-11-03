'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { Loader2, Package, Search, X } from 'lucide-react'
import Link from 'next/link'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { catalogMessage, type CatalogItem } from '@/lib/material-library'

type Row = CatalogItem & { thumbUrl: string }
/** วัสดุที่เลือก + หน้าแค็ตตาล็อกพร้อมลิงก์ดู — ส่งให้ฟอร์มหนังสือเติมรายการและต่อรูปแนบ */
export type PickedMaterial = Omit<CatalogItem, 'pages'> & { pages: { id: string; key: string; seq: number; url: string }[] }

const DIALOG =
  'fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100svh-2rem)] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-line bg-surface shadow-e3 animate-pop-in'

/**
 * เลือกวัสดุจากคลัง (R27) — ติ๊กได้หลายรายการ → เติมแถวรายการ + ต่อแค็ตตาล็อกท้ายหนังสือ
 * 🔴 โหลดรายการใน event handler (เปิดกล่อง · พิมพ์ค้นหา) ไม่ใช่ใน effect — React 19 นับ setState ใน effect เป็น cascading render (§17 ข้อ 16)
 */
export function MaterialLibraryPicker({
  open,
  onOpenChange,
  hasStamp,
  onPick,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** มีรูปตราประทับในคลัง — ถึงจะโชว์ติ๊ก "ประทับตรา" */
  hasStamp: boolean
  onPick: (items: PickedMaterial[], stamp: boolean) => void
}) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [sel, setSel] = useState<string[]>([])
  const [stamp, setStamp] = useState(true)
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seq = useRef(0)

  async function load(nextQ: string, nextCat: string) {
    const mine = ++seq.current
    setError(null)
    try {
      const p = new URLSearchParams()
      if (nextQ.trim()) p.set('q', nextQ.trim())
      if (nextCat) p.set('category', nextCat)
      const r = await fetch(`/api/material-library?${p.toString()}`)
      const j = (await r.json().catch(() => ({}))) as { items?: Row[]; error?: string }
      if (mine !== seq.current) return // มีคำค้นใหม่กว่าแล้ว
      if (!r.ok || !j.items) {
        setRows([])
        setError(catalogMessage(j.error ?? 'LOAD_FAILED'))
        return
      }
      setRows(j.items)
    } catch {
      if (mine === seq.current) {
        setRows([])
        setError(catalogMessage('LOAD_FAILED'))
      }
    }
  }

  function changeOpen(v: boolean) {
    if (busy) return
    if (v) {
      setSel([])
      setStamp(true)
      setRows(null)
      void load(q, cat)
    }
    onOpenChange(v)
  }

  function search(v: string) {
    setQ(v)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void load(v, cat), 250)
  }

  function pickCat(v: string) {
    setCat(v)
    void load(q, v)
  }

  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const categories = Array.from(new Set((rows ?? []).map((r) => r.category).filter(Boolean))).sort()

  async function confirm() {
    if (!sel.length || busy) return
    setBusy(true)
    try {
      // ต้องเรียงตามที่ติ๊ก (ลำดับข้อในหนังสือ = ลำดับที่เลือก)
      const got = await Promise.all(
        sel.map(async (id) => {
          const r = await fetch(`/api/material-library/${id}`)
          const j = (await r.json().catch(() => ({}))) as { item?: PickedMaterial; error?: string }
          if (!r.ok || !j.item) throw new Error(catalogMessage(j.error))
          return j.item
        }),
      )
      onPick(got, hasStamp && stamp)
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error && /[ก-๙]/.test(e.message) ? e.message : catalogMessage('LOAD_FAILED'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
        <Dialog.Content className={DIALOG}>
          <div className="flex items-start justify-between gap-3 border-b border-line-soft p-4">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-bold text-ink">เลือกจากคลังวัสดุ</Dialog.Title>
              <Dialog.Description className="text-sm text-muted-token">
                ติ๊กวัสดุที่ต้องการ — เติมรายการให้ และแนบแค็ตตาล็อกท้ายหนังสือตามลำดับที่เลือก
              </Dialog.Description>
            </div>
            <Dialog.Close disabled={busy} className="btn-ghost" aria-label="ปิด"><X className="size-4" /></Dialog.Close>
          </div>

          <div className="flex flex-wrap items-end gap-2 border-b border-line-soft p-3">
            <div className="relative min-w-[10rem] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-token" />
              <input className="input-base pl-8" value={q} onChange={(e) => search(e.target.value)} placeholder="ค้นหาชื่อวัสดุ" aria-label="ค้นหาชื่อวัสดุ" />
            </div>
            <select className="input-base w-auto" value={cat} onChange={(e) => pickCat(e.target.value)} aria-label="หมวด">
              <option value="">ทุกหมวด</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              {cat && !categories.includes(cat) && <option value={cat}>{cat}</option>}
            </select>
          </div>

          <div className="min-h-[12rem] flex-1 overflow-y-auto p-3">
            {rows === null ? (
              <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-token"><Loader2 className="size-4 animate-spin" /> กำลังโหลดคลังวัสดุ…</p>
            ) : error ? (
              <div className="py-8 text-center" data-state="error">
                <p className="mb-3 text-sm text-urgent">{error}</p>
                <button type="button" className="btn-secondary" onClick={() => void load(q, cat)}>ลองใหม่</button>
              </div>
            ) : rows.length === 0 ? (
              <div className="py-8 text-center">
                <Package className="mx-auto mb-2 size-6 text-muted-token" />
                <p className="mb-3 text-sm text-muted-token">{q || cat ? 'ไม่พบวัสดุที่ตรงกับที่ค้นหา' : 'ยังไม่มีวัสดุในคลัง'}</p>
                <Link href="/letters/library" target="_blank" className="btn-secondary">ไปเพิ่มวัสดุในคลัง</Link>
              </div>
            ) : (
              <ul className="space-y-2">
                {rows.map((r) => {
                  const on = sel.includes(r.id)
                  return (
                    <li key={r.id}>
                      <label className={`flex cursor-pointer items-center gap-3 rounded-md border p-2 ${on ? 'border-brand bg-brand-tint' : 'border-line bg-surface'}`}>
                        <input type="checkbox" checked={on} onChange={() => toggle(r.id)} className="size-4 shrink-0" />
                        <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded border border-line-soft bg-surface-2">
                          {r.thumbUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element -- presigned URL (§9)
                            <img src={r.thumbUrl} alt="" className="size-full object-contain" />
                          ) : (
                            <Package className="size-5 text-muted-token" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block break-words text-sm font-semibold text-ink">{r.name}</span>
                          {r.detail && <span className="block break-words text-sm text-ink-2">{r.detail}</span>}
                          <span className="block text-xs text-muted-token">
                            {r.category && <>{r.category} · </>}<span className="tabular-nums">{r.pages.length}</span> หน้า
                          </span>
                        </span>
                        {on && <span className="shrink-0 rounded-full bg-brand px-2 py-0.5 text-xs font-semibold tabular-nums text-white">{sel.indexOf(r.id) + 1}</span>}
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-line-soft p-3">
            {hasStamp ? (
              <label className="mr-auto flex items-center gap-1.5 text-sm text-ink-2">
                <input type="checkbox" checked={stamp} onChange={(e) => setStamp(e.target.checked)} /> ประทับตราบริษัทบนแค็ตตาล็อก
              </label>
            ) : (
              <Link href="/letters/library" target="_blank" className="mr-auto text-sm text-brand underline">ตั้งตราประทับบริษัท</Link>
            )}
            <Dialog.Close disabled={busy} className="btn-secondary">ยกเลิก</Dialog.Close>
            <button type="button" className="btn-primary" disabled={!sel.length || busy} onClick={() => void confirm()}>
              {busy && <Loader2 className="size-4 animate-spin" />} เพิ่ม {sel.length ? `${sel.length} รายการ` : ''}ลงหนังสือ
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
