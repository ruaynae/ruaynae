'use client'

import { Loader2, Minus, PackagePlus, Plus, Search, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { fmtQty, itemLabel, mrMessage, type PosSearchItem } from '@/lib/materials'

type Opt = { id: string; name: string }
type Line = { item: PosSearchItem; qty: string }

const MAX_LINES = 50

/**
 * ฟอร์มใบขอเบิกวัสดุ (R18) — เลือกโครงการ · ช่าง (ไม่บังคับ) · ค้นหาสินค้าแล้วใส่จำนวน
 * 🔴 ค้นหาผ่าน /api/pos/items ซึ่งไม่ส่งทุนหรือราคา — หน้าจอนี้ของหัวหน้าโครงการจึงไม่มีตัวเลขเงินเลย
 */
export function RequestForm({ sites, employees }: { sites: Opt[]; employees: Opt[] }) {
  const router = useRouter()
  const [siteId, setSiteId] = useState(sites.length === 1 ? sites[0].id : '')
  const [employeeId, setEmployeeId] = useState('')
  const [note, setNote] = useState('')
  const [q, setQ] = useState('')
  const [results, setResults] = useState<PosSearchItem[]>([])
  const [searching, setSearching] = useState(false)
  const [searchFailed, setSearchFailed] = useState(false)
  const [lines, setLines] = useState<Line[]>([])
  const [busy, setBusy] = useState(false)
  const reqId = useRef(0)

  // ค้นหาแบบหน่วง 300 ms · คำตอบที่มาช้ากว่าคำค้นล่าสุดถูกทิ้ง
  useEffect(() => {
    const term = q.trim()
    if (!term) return
    const my = ++reqId.current
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await fetch(`/api/pos/items?q=${encodeURIComponent(term)}`)
        const b = await r.json().catch(() => ({}))
        if (my !== reqId.current) return
        if (!r.ok) {
          setSearchFailed(true)
          setResults([])
          return
        }
        setSearchFailed(false)
        setResults((b.items as PosSearchItem[]) ?? [])
      } catch {
        if (my === reqId.current) {
          setSearchFailed(true)
          setResults([])
        }
      } finally {
        if (my === reqId.current) setSearching(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [q])

  const add = (item: PosSearchItem) => {
    if (lines.some((l) => l.item.variant_id === item.variant_id)) {
      toast.info('สินค้านี้อยู่ในใบแล้ว — แก้จำนวนที่บรรทัดเดิม')
      return
    }
    if (lines.length >= MAX_LINES) return toast.error(`ใบเดียวใส่ได้ไม่เกิน ${MAX_LINES} รายการ`)
    setLines([...lines, { item, qty: '1' }])
    setQ('')
    setResults([])
  }

  const setQty = (i: number, qty: string) =>
    setLines(lines.map((l, j) => (j === i ? { ...l, qty: qty.replace(/[^\d.]/g, '') } : l)))
  const bump = (i: number, d: number) =>
    setLines(
      lines.map((l, j) =>
        j === i ? { ...l, qty: String(Math.max(1, Math.round((Number(l.qty) || 0) + d))) } : l,
      ),
    )
  const remove = (i: number) => setLines(lines.filter((_, j) => j !== i))

  const submit = async () => {
    if (busy) return
    if (!siteId) return toast.error('เลือกโครงการก่อน')
    if (lines.length === 0) return toast.error('เพิ่มสินค้าอย่างน้อยหนึ่งรายการ')
    if (lines.some((l) => !(Number(l.qty) > 0))) return toast.error('จำนวนต้องมากกว่า 0 ทุกบรรทัด')
    setBusy(true)
    try {
      const r = await fetch('/api/materials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId,
          employeeId: employeeId || null,
          note: note.trim() || null,
          lines: lines.map((l) => ({ variantId: l.item.variant_id, qty: Number(l.qty) })),
        }),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(mrMessage(b.error, 'บันทึกใบขอเบิกไม่สำเร็จ'))
        return
      }
      toast.success(`บันทึกใบขอเบิก ${b.request_no} แล้ว · บอกเลขนี้ให้ช่างไปรับของที่ร้าน`)
      router.push('/materials')
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(false)
    }
  }

  const showResults = q.trim() !== ''

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
        <div>
          <label htmlFor="mr-site" className="label-base">โครงการที่จะใช้ของ</label>
          <select id="mr-site" value={siteId} onChange={(e) => setSiteId(e.target.value)} className="input-base">
            <option value="">เลือกโครงการ</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="mr-emp" className="label-base">ช่างที่จะไปรับของ (ไม่บังคับ)</label>
          <select id="mr-emp" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="input-base">
            <option value="">ไม่ระบุ</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-surface">
        <div className="border-b border-line-soft p-4">
          <label htmlFor="mr-q" className="label-base">เพิ่มสินค้า</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-token" />
            <input
              id="mr-q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="พิมพ์ชื่อสินค้า หรือ SKU"
              autoComplete="off"
              className="input-base pl-9"
            />
            {searching && (
              <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-token" />
            )}
          </div>
          {showResults && (
            <ul className="mt-2 max-h-72 divide-y divide-line-soft overflow-y-auto rounded-md border border-line">
              {searchFailed ? (
                <li className="px-3 py-3 text-sm text-expense">ค้นหาไม่สำเร็จ ลองพิมพ์ใหม่อีกครั้ง</li>
              ) : results.length === 0 && !searching ? (
                <li className="px-3 py-3 text-sm text-muted-token">ไม่พบสินค้าที่ตรงกับ &ldquo;{q.trim()}&rdquo;</li>
              ) : (
                results.map((it) => (
                  <li key={it.variant_id}>
                    <button
                      type="button"
                      onClick={() => add(it)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-surface-2"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-ink">{itemLabel(it)}</span>
                        <span className="block truncate text-xs text-muted-token">
                          {[it.sku ? `SKU ${it.sku}` : null, it.category,
                            it.track_stock && it.in_stock !== null ? `คงเหลือ ${fmtQty(it.in_stock)}` : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      <Plus className="size-4 shrink-0 text-brand" />
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>

        {lines.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-token">ยังไม่มีสินค้าในใบนี้ — ค้นหาแล้วแตะเพื่อเพิ่ม</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {lines.map((l, i) => {
              const over =
                l.item.track_stock && l.item.in_stock !== null && Number(l.qty) > l.item.in_stock
              return (
                <li key={l.item.variant_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{itemLabel(l.item)}</p>
                    {over && (
                      <p className="text-xs text-expense">
                        เกินยอดคงเหลือในระบบ ({fmtQty(l.item.in_stock ?? 0)}) — ร้านอาจมีของไม่พอ
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={() => bump(i, -1)} className="btn-ghost px-2" aria-label="ลดจำนวน">
                      <Minus className="size-4" />
                    </button>
                    <input
                      inputMode="decimal"
                      value={l.qty}
                      onChange={(e) => setQty(i, e.target.value)}
                      aria-label={`จำนวน ${itemLabel(l.item)}`}
                      className="input-base w-20 text-center tabular-nums"
                    />
                    <button type="button" onClick={() => bump(i, 1)} className="btn-ghost px-2" aria-label="เพิ่มจำนวน">
                      <Plus className="size-4" />
                    </button>
                    <button type="button" onClick={() => remove(i)} className="btn-ghost px-2 text-expense" aria-label="ลบบรรทัด">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-line bg-surface p-4">
        <label htmlFor="mr-note" className="label-base">หมายเหตุถึงร้าน (ไม่บังคับ)</label>
        <textarea
          id="mr-note"
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 500))}
          rows={2}
          placeholder="เช่น มารับบ่ายสอง · ขอสีเบอร์เดิม"
          className="input-base"
        />
      </section>

      <button type="button" onClick={submit} disabled={busy} className="btn-primary w-full py-3 text-base">
        {busy ? <Loader2 className="size-5 animate-spin" /> : <PackagePlus className="size-5" />}
        {busy ? 'กำลังบันทึก…' : `บันทึกใบขอเบิก (${lines.length} รายการ)`}
      </button>
    </div>
  )
}
