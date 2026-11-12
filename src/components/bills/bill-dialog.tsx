'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { Link2, Link2Off, Loader2, Save, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { billMessage } from '@/lib/bills'
import { fmtDate } from '@/lib/format'
import type { BillRow } from './bills-client'

type TxnView = {
  id: string; date: string | null; total: number | null; remaining: number | null; note: string; category: string; site: string; status: string; billCount: number
}
type Loaded = { matches: (TxnView & { matchedBy: string })[]; candidates: (TxnView & { score: number; exact: boolean; days: number | null })[] }

const money = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const json = (body: unknown) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

/**
 * R41 · กล่องบิลหนึ่งใบ — ดูรูป · แก้ข้อมูลที่ AI อ่าน · ผูก/ยกเลิกคู่กับรายจ่าย · ข้าม/ลบบิล
 * 🔴 กล่องนี้ mount เฉพาะตอนเปิด แล้วโหลดคู่/ผู้สมัครตอน mount (§17 ข้อ 46 — ไม่โหลดใน onOpenChange)
 */
export function BillDialog({ bill, onClose, onChanged }: { bill: BillRow; onClose: () => void; onChanged: () => void }) {
  const [f, setF] = useState({
    vendor: bill.vendor ?? '', vendorTaxId: bill.vendor_tax_id ?? '', billNo: bill.bill_no ?? '', billDate: bill.bill_date ?? '',
    amount: bill.amount == null ? '' : String(bill.amount), vatAmount: bill.vat_amount == null ? '' : String(bill.vat_amount),
  })
  const [data, setData] = useState<Loaded | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [ignored, setIgnored] = useState(bill.ignored)
  const [confirmDel, setConfirmDel] = useState(false)

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const r = await fetch(`/api/bills/${bill.id}/matches`)
        const j = (await r.json().catch(() => ({}))) as Loaded & { error?: string }
        if (!live) return
        if (!r.ok) return setErr(billMessage(j.error))
        setErr('')
        setData({ matches: j.matches ?? [], candidates: j.candidates ?? [] })
      } catch {
        if (live) setErr('โหลดรายจ่ายที่เข้าคู่ไม่สำเร็จ ลองใหม่')
      }
    })()
    return () => { live = false }
  }, [bill.id, reload])

  async function act(tag: string, run: () => Promise<Response>, ok: string) {
    setBusy(tag)
    try {
      const r = await run()
      const j = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) { toast.error(billMessage(j.error)); return false }
      toast.success(ok)
      onChanged()
      return true
    } catch {
      toast.error('บันทึกไม่สำเร็จ ตรวจการเชื่อมต่อแล้วลองใหม่')
      return false
    } finally {
      setBusy(null)
    }
  }

  const save = () => act('save', () => fetch(`/api/bills/${bill.id}`, {
    method: 'PATCH',
    ...json({
      vendor: f.vendor || null, vendorTaxId: f.vendorTaxId || null, billNo: f.billNo || null, billDate: f.billDate || null,
      amount: f.amount === '' ? null : f.amount, vatAmount: f.vatAmount === '' ? null : f.vatAmount,
    }),
  }), 'บันทึกข้อมูลบิลแล้ว').then((ok) => ok && setReload((x) => x + 1))
  const link = (tid: string) => act(`link-${tid}`, () => fetch(`/api/bills/${bill.id}/matches`, { method: 'POST', ...json({ transactionId: tid }) }), 'ผูกบิลกับรายจ่ายแล้ว').then((ok) => ok && setReload((x) => x + 1))
  const unlink = (tid: string) => act(`unlink-${tid}`, () => fetch(`/api/bills/${bill.id}/matches?transactionId=${tid}`, { method: 'DELETE' }), 'ยกเลิกคู่แล้ว').then((ok) => ok && setReload((x) => x + 1))
  const toggleIgnore = () => act('ignore', () => fetch(`/api/bills/${bill.id}`, { method: 'PATCH', ...json({ ignored: !ignored }) }), ignored ? 'เอากลับมาตรวจแล้ว' : 'ข้ามบิลนี้แล้ว').then((ok) => ok && setIgnored(!ignored))
  const remove = () => act('delete', () => fetch(`/api/bills/${bill.id}`, { method: 'DELETE' }), 'ลบบิลแล้ว').then((ok) => ok && onClose())

  const field = (k: keyof typeof f, label: string, o: { type?: string; mode?: 'decimal' | 'numeric'; ph?: string } = {}) => (
    <label className="block"><span className="label-base">{label}</span>
      <input className="input-base" type={o.type ?? 'text'} inputMode={o.mode} placeholder={o.ph} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </label>
  )

  return (
    <Dialog.Root open onOpenChange={(v) => { if (!v && !busy) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100svh-2rem)] w-[min(60rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-line bg-surface shadow-e3 animate-pop-in">
          <div className="flex items-start justify-between gap-3 border-b border-line-soft p-4">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-bold text-ink">{bill.vendor || bill.file_name || 'บิล'}</Dialog.Title>
              <Dialog.Description className="text-sm text-muted-token">
                {bill.file_name}{bill.page_no ? ` · หน้า ${bill.page_no}` : ''} · อัปเมื่อ {fmtDate(bill.created_at.slice(0, 10))}{bill.source === 'line' ? ' · จาก LINE' : ''}
              </Dialog.Description>
            </div>
            <Dialog.Close className="btn-ghost" aria-label="ปิด"><X className="size-5" /></Dialog.Close>
          </div>

          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <a href={`/api/bills/${bill.id}/file`} target="_blank" rel="noreferrer" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element -- 302 ไป presigned GET (§9) */}
              <img src={`/api/bills/${bill.id}/file`} alt="รูปบิล" className="max-h-[70vh] w-full rounded-md border border-line-soft object-contain" />
            </a>

            <div className="space-y-4">
              <section className="grid gap-2 sm:grid-cols-2">
                <div className="sm:col-span-2">{field('vendor', 'ผู้ขาย / ร้าน')}</div>
                {field('vendorTaxId', 'เลขผู้เสียภาษีผู้ขาย', { mode: 'numeric', ph: '13 หลัก' })}
                {field('billNo', 'เลขที่บิล')}
                {field('billDate', 'วันที่บิล', { type: 'date' })}
                {field('amount', 'ยอดรวมทั้งสิ้น (บาท)', { mode: 'decimal' })}
                {field('vatAmount', 'ภาษีมูลค่าเพิ่ม (บาท)', { mode: 'decimal' })}
                <div className="flex items-end">
                  <button type="button" className="btn-primary" disabled={busy === 'save'} onClick={() => void save()}>
                    {busy === 'save' ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} บันทึกข้อมูลบิล
                  </button>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-ink">รายจ่ายที่ผูกกับบิลนี้</h3>
                {err && <p className="text-sm text-urgent">{err} <button type="button" className="btn-ghost" onClick={() => setReload((x) => x + 1)}>ลองใหม่</button></p>}
                {!data && !err && <p className="flex items-center gap-2 text-sm text-muted-token"><Loader2 className="size-4 animate-spin" /> กำลังโหลด…</p>}
                {data && data.matches.length === 0 && <p className="text-sm text-muted-token">ยังไม่ได้ผูก — เลือกจากรายการแนะนำข้างล่าง</p>}
                {data?.matches.map((m) => {
                  return (
                    <div key={m.id} className="flex flex-wrap items-center gap-2 rounded-md border border-status-done-ring bg-status-done-bg px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1">
                        <b>{m.date ? fmtDate(m.date) : ''}</b> · {m.note || m.category} {m.site ? `· ${m.site}` : ''}
                        <span className="block text-xs text-muted-token">
                          ยอดโอน ฿{money(m.total)}{m.remaining && m.remaining > 0.005 ? ` · ยังขาดบิลอีก ฿${money(m.remaining)}` : ''}{m.matchedBy === 'auto' ? ' · ระบบจับคู่ให้' : ''}
                        </span>
                      </span>
                      <button type="button" className="btn-ghost text-sm" disabled={busy === `unlink-${m.id}`} onClick={() => void unlink(m.id)}>
                        <Link2Off className="size-4" /> ยกเลิกคู่
                      </button>
                    </div>
                  )
                })}
              </section>

              {data && data.candidates.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-ink">รายจ่ายที่น่าจะใช่ (เรียงจากใกล้เคียงที่สุด)</h3>
                  {data.candidates.map((c) => (
                    <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-md border border-line-soft px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1">
                        <b>{c.date ? fmtDate(c.date) : ''}</b> · {c.note || c.category} {c.site ? `· ${c.site}` : ''}
                        <span className="block text-xs text-muted-token">
                          ยอดที่ยังไม่มีบิล ฿{money(c.remaining)}{c.total !== c.remaining ? ` (จาก ฿${money(c.total)})` : ''} · {c.exact ? 'ยอดตรง' : 'ยอดใกล้เคียง'}
                          {c.days != null ? ` · บิลห่างจากวันโอน ${c.days > 0 ? `+${c.days}` : c.days} วัน` : ''}{c.status === 'pending' ? ' · รออนุมัติ' : ''}
                        </span>
                      </span>
                      <button type="button" className="btn-secondary text-sm" disabled={busy === `link-${c.id}`} onClick={() => void link(c.id)}>
                        {busy === `link-${c.id}` ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />} ผูก
                      </button>
                    </div>
                  ))}
                </section>
              )}
              {data && data.candidates.length === 0 && data.matches.length === 0 && (
                <p className="text-sm text-muted-token">ไม่พบรายจ่ายที่ยอดตรงหรือใกล้เคียง — ตรวจยอด/วันที่บิล หรืออาจยังไม่ได้คีย์รายจ่ายนี้ (คีย์ที่หน้าบันทึกรายการแล้วกลับมาผูก)</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft p-4">
            {/* ลบ = กดสองครั้ง (ครั้งแรกเปลี่ยนเป็นปุ่มยืนยัน) — ไม่ใช้ confirm() ของเบราว์เซอร์ */}
            <button type="button" className={confirmDel ? 'btn-primary bg-urgent' : 'btn-ghost text-urgent'} disabled={busy === 'delete'}
              onClick={() => (confirmDel ? void remove() : setConfirmDel(true))}>
              {busy === 'delete' ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              {confirmDel ? 'ยืนยันลบบิล (รูปถูกลบด้วย)' : 'ลบบิล'}
            </button>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary" disabled={busy === 'ignore'} onClick={() => void toggleIgnore()}>
                {ignored ? 'เอากลับมาตรวจ' : 'ข้ามบิลนี้ (ไม่ใช่บิลค่าใช้จ่าย/ซ้ำ)'}
              </button>
              <Dialog.Close className="btn-primary">เสร็จ</Dialog.Close>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
