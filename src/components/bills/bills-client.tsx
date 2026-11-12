'use client'

import { FileUp, Loader2, ScanText } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/states'
import { billMessage } from '@/lib/bills'
import { fmtDate } from '@/lib/format'
import { pdfErrorText } from '@/lib/pdf-pages'
import { failCode, prepareBillFiles, readBills, uploadBills } from './bill-upload'
import { BillDialog } from './bill-dialog'

export type BillRow = {
  id: string
  file_name: string
  page_no: number | null
  vendor: string | null
  vendor_tax_id: string | null
  bill_no: string | null
  bill_date: string | null
  amount: number | null
  vat_amount: number | null
  read_status: string
  ignored: boolean
  note: string
  created_at: string
  source: string
  matches: { transaction_id: string; matched_by: string }[]
}
export type UnbilledRow = {
  id: string; date: string; total: number; remaining: number; note: string; category: string; site: string; status: string; billCount: number
}

const money = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

function billState(b: BillRow): { label: string; tone: 'done' | 'pending' | 'progress' | 'info' | 'urgent' } {
  if (b.ignored) return { label: 'ข้ามแล้ว', tone: 'info' }
  if (b.matches.length) return { label: b.matches.some((m) => m.matched_by === 'auto') ? 'จับคู่แล้ว (อัตโนมัติ)' : 'จับคู่แล้ว', tone: 'done' }
  if (b.read_status === 'pending') return { label: 'รออ่าน', tone: 'pending' }
  if (b.read_status === 'failed') return { label: 'อ่านไม่ได้ — กรอกเอง', tone: 'urgent' }
  return { label: 'ยังไม่จับคู่', tone: 'progress' }
}

const FILTERS = [['all', 'ทั้งหมด'], ['open', 'ยังไม่จับคู่'], ['pending', 'รออ่าน'], ['matched', 'จับคู่แล้ว'], ['ignored', 'ข้ามแล้ว']] as const

/**
 * R41 · หน้าตรวจบิล (ฝั่งเบราว์เซอร์) — อัปโหลด/อ่าน/รายการบิล + แท็บรายจ่ายที่ยังไม่ได้บิล
 */
export function BillsClient({ tab, filter, bills, unbilled, truncated, listCap }: {
  tab: 'bills' | 'unbilled'
  filter: string
  bills: BillRow[]
  unbilled: UnbilledRow[]
  truncated: boolean
  listCap: number
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [open, setOpen] = useState<BillRow | null>(null)
  const [noBillBusy, setNoBillBusy] = useState<string | null>(null)

  async function onFiles(list: FileList | null) {
    const files = list ? Array.from(list) : [] // คัดลอกก่อน await (§17 ข้อ 42)
    if (!files.length) return
    setBusy(true)
    try {
      const { ready, skipped } = await prepareBillFiles(files, setProgress)
      if (skipped.length) toast.error(`ข้าม ${skipped.length} ไฟล์ที่ไม่ใช่รูป/PDF หรือเปิดไม่ได้`)
      if (!ready.length) return
      const ids = await uploadBills(ready, setProgress)
      toast.success(`อัปโหลดบิล ${ids.length} ใบแล้ว — กำลังให้ AI อ่าน`)
      await doRead(ids)
    } catch (e) {
      // ข้อผิดพลาดของการอัป/ลงทะเบียนมีรหัสของเรา · ที่เหลือมาจากการเปิด PDF
      toast.error(e instanceof Error && e.name === 'BillFail' ? billMessage(failCode(e)) : pdfErrorText(e))
    } finally {
      setProgress('')
      setBusy(false)
      router.refresh()
    }
  }

  async function doRead(ids: string[]) {
    const r = await readBills(ids, setProgress)
    const parts = [`อ่านแล้ว ${r.read} ใบ`]
    if (r.matched) parts.push(`จับคู่อัตโนมัติ ${r.matched} ใบ`)
    if (r.failed) parts.push(`อ่านไม่ได้ ${r.failed} ใบ (กรอกเอง)`)
    toast.success(parts.join(' · '))
    if (r.stoppedBy) toast.error(billMessage(r.stoppedBy))
  }

  async function readPending() {
    const ids = bills.filter((b) => b.read_status === 'pending' && !b.ignored).map((b) => b.id)
    if (!ids.length) return
    setBusy(true)
    try {
      await doRead(ids)
    } finally {
      setProgress('')
      setBusy(false)
      router.refresh()
    }
  }

  async function setNoBill(id: string) {
    setNoBillBusy(id)
    try {
      const r = await fetch('/api/bills/no-bill', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transactionId: id, notRequired: true }) })
      const j = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) return toast.error(billMessage(j.error))
      toast.success('ตั้งว่าไม่ต้องมีบิลแล้ว', {
        action: { label: 'เลิกทำ', onClick: () => void fetch('/api/bills/no-bill', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transactionId: id, notRequired: false }) }).then(() => router.refresh()) },
      })
      router.refresh()
    } catch {
      toast.error('บันทึกไม่สำเร็จ ตรวจการเชื่อมต่อแล้วลองใหม่')
    } finally {
      setNoBillBusy(null)
    }
  }

  if (tab === 'unbilled') {
    const sum = unbilled.reduce((s, t) => s + t.remaining, 0)
    return (
      <section className="space-y-3">
        <p className="text-sm text-ink-2">
          รายจ่ายที่ยังไม่มีบิลรองรับครบยอด <b className="tabular-nums">{unbilled.length.toLocaleString('en-US')}</b> รายการ ·
          รวม <b className="tabular-nums">฿{money(sum)}</b> — เรียงจากค้างนานสุด · หมวดค่าแรง/เบี้ยเลี้ยงไม่ต้องมีบิล
        </p>
        {truncated && <p className="text-sm text-urgent">รายจ่ายเกินเพดานที่อ่านได้ — ตัวเลขอาจไม่ครบ</p>}
        {unbilled.length === 0 ? (
          <EmptyState message="ไม่มีรายจ่ายที่ค้างบิล" />
        ) : (
          <ul className="card-surface divide-y divide-line-soft">
            {unbilled.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="w-24 shrink-0 text-sm text-muted-token">{fmtDate(t.date)}</span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block break-words text-ink">{t.note || t.category || 'ไม่มีหมายเหตุ'}</span>
                  <span className="block text-xs text-muted-token">
                    {[t.category, t.site || 'ส่วนกลาง', t.status === 'pending' ? 'รออนุมัติ' : null, t.billCount ? `มีบิลแล้ว ${t.billCount} ใบ ยังไม่ครบยอด` : null].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="text-right text-sm font-semibold tabular-nums text-ink">
                  ฿{money(t.remaining)}
                  {t.remaining !== t.total && <span className="block text-xs font-normal text-muted-token">จากยอด ฿{money(t.total)}</span>}
                </span>
                <button type="button" className="btn-ghost text-sm" disabled={noBillBusy === t.id} onClick={() => void setNoBill(t.id)}>
                  {noBillBusy === t.id && <Loader2 className="size-4 animate-spin" />}ไม่ต้องมีบิล
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  }

  const shown = bills.filter((b) => {
    if (filter === 'open') return !b.ignored && !b.matches.length && b.read_status !== 'pending'
    if (filter === 'pending') return !b.ignored && b.read_status === 'pending'
    if (filter === 'matched') return !b.ignored && b.matches.length > 0
    if (filter === 'ignored') return b.ignored
    return true
  })
  const pendingCount = bills.filter((b) => b.read_status === 'pending' && !b.ignored).length

  return (
    <section className="space-y-4">
      <div className="card-surface flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-ink">อัปโหลดบิล / ใบเสร็จ / ใบกำกับภาษี</h2>
          <p className="text-sm text-muted-token">เลือกรูปหรือ PDF ได้ทีละหลายไฟล์ · PDF ที่สแกนทีละปึก = 1 หน้า 1 บิล · AI อ่านแล้วจับคู่กับรายจ่ายให้เมื่อชัดเจน</p>
          {progress && <p className="mt-1 flex items-center gap-2 text-sm text-brand"><Loader2 className="size-4 animate-spin" />{progress}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {pendingCount > 0 && (
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => void readPending()}>
              <ScanText className="size-4" /> อ่านที่เหลือ ({pendingCount})
            </button>
          )}
          <label className={`btn-primary cursor-pointer ${busy ? 'pointer-events-none opacity-60' : ''}`}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />} เลือกไฟล์บิล
            <input type="file" multiple accept=".pdf,application/pdf,.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" className="sr-only"
              onChange={(e) => { const l = e.target.files; void onFiles(l); e.target.value = '' }} />
          </label>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="กรองบิล">
        {FILTERS.map(([k, label]) => (
          <Link key={k} href={k === 'all' ? '/bills' : `/bills?f=${k}`} className={filter === k ? 'btn-primary' : 'btn-secondary'}>{label}</Link>
        ))}
      </div>

      {bills.length === 0 ? (
        <EmptyState icon={FileUp} message="ยังไม่มีบิล — กด &quot;เลือกไฟล์บิล&quot; เพื่ออัปโหลดรูปหรือ PDF" />
      ) : shown.length === 0 ? (
        <EmptyState message="ไม่มีบิลในกลุ่มนี้" />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((b) => {
            const st = billState(b)
            return (
              <li key={b.id}>
                <button type="button" onClick={() => setOpen(b)} className="card-surface flex w-full items-start gap-3 p-3 text-left hover:bg-surface-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- 302 ไป presigned GET (§9) */}
                  <img src={`/api/bills/${b.id}/file`} alt="" loading="lazy" className="size-16 shrink-0 rounded-md border border-line-soft object-cover" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{b.vendor || b.file_name || 'บิล'}</span>
                    <span className="block text-xs text-muted-token">{[b.bill_date ? fmtDate(b.bill_date) : null, b.bill_no].filter(Boolean).join(' · ') || '—'}</span>
                    <span className="block text-sm font-semibold tabular-nums text-ink">฿{money(b.amount)}</span>
                    <Badge tone={st.tone} dot>{st.label}</Badge>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {bills.length >= listCap && <p className="text-xs text-muted-token">แสดง {listCap} ใบล่าสุด</p>}
      {open && <BillDialog bill={open} onClose={() => setOpen(null)} onChanged={() => router.refresh()} />}
    </section>
  )
}
