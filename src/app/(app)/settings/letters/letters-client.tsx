'use client'

import { Check, ChevronDown, Loader2, Plus, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/ui/page-header'
import { fillCompany, letterMessage, type Letterhead } from '@/lib/letters'

export type SeriesRow = {
  id: string
  label: string
  prefix: string
  siteId: string | null
  recipient: string
  contractRef: string
  intro: string
  signerTitle: string
  isActive: boolean
  letters: number
}

type FormState = Omit<SeriesRow, 'id' | 'letters'>

const EMPTY: FormState = {
  label: '',
  prefix: '',
  siteId: null,
  recipient: 'ประธานคณะกรรมการตรวจการจ้างงาน (ผ่านผู้ควบคุมงาน)',
  contractRef: 'สัญญาจ้างเลขที่ …… ลงวันที่ ……',
  intro: 'ข้าพเจ้า {บริษัท} เป็นผู้รับจ้างโครงการ …… ณ …… ตามหนังสือที่อ้างถึง (1)',
  signerTitle: 'ผู้รับจ้าง',
  isActive: true,
}

/**
 * ตั้งค่าชุดเลขหนังสือ — การ์ดละชุด กดเพื่อกางแก้ · "เพิ่มชุดเลข" เปิดการ์ดเปล่า
 * หัวกระดาษ (ชื่อห้าง ที่อยู่ ผู้ลงนาม) ไม่ได้ตั้งที่นี่ — ใช้ชุดเดียวกับใบเสร็จ
 */
export function LetterSeriesClient({
  rows,
  sites,
  letterhead,
}: {
  rows: SeriesRow[]
  sites: { id: string; name: string }[]
  letterhead: Letterhead
}) {
  const [adding, setAdding] = useState(rows.length === 0)
  const [open, setOpen] = useState<string | null>(null)

  return (
    <>
      <PageHeader
        title="ชุดเลขหนังสือ"
        subtitle="หนึ่งชุดต่อโครงการที่ออกหนังสือ — คำนำหน้าเลขที่ เรียน สัญญา และย่อหน้าแนะนำที่ฟอร์มเติมให้"
        backHref="/settings"
        action={
          <>
            {!adding && (
              <button type="button" onClick={() => setAdding(true)} className="btn-primary">
                <Plus className="size-4" /> เพิ่มชุดเลข
              </button>
            )}
            <Link href="/letters" className="btn-secondary">ไปที่หนังสือบริษัท</Link>
          </>
        }
      />

      <section className="mb-4 rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm">
        <p className="font-semibold text-ink">หัวกระดาษที่ใช้กับฉบับใหม่</p>
        <p className="mt-1 text-ink-2">{letterhead.companyName || '— ยังไม่ได้ตั้งชื่อบริษัท —'}</p>
        <p className="text-ink-2">{letterhead.address || '— ยังไม่ได้ตั้งที่อยู่/เบอร์โทร —'}</p>
        <p className="text-ink-2">ผู้ลงนาม: {letterhead.signerName || '— ยังไม่ได้ตั้ง —'}</p>
        <p className="mt-1.5 text-xs text-muted-token">
          ชื่อบริษัทและโลโก้แก้ที่ <Link href="/settings" className="font-medium text-brand underline-offset-2 hover:underline">ตั้งค่า</Link>
          {' · '}ที่อยู่ เบอร์โทร และชื่อผู้ลงนามแก้ที่{' '}
          <Link href="/settings/documents" className="font-medium text-brand underline-offset-2 hover:underline">ตั้งค่าเอกสาร</Link>
          {' '}(ชุดเดียวกับใบเสร็จ)
        </p>
      </section>

      <div className="space-y-3">
        {adding && (
          <SeriesCard
            row={null}
            sites={sites}
            companyName={letterhead.companyName}
            expanded
            onToggle={() => setAdding(false)}
            onDone={() => setAdding(false)}
          />
        )}
        {rows.map((r) => (
          <SeriesCard
            key={r.id}
            row={r}
            sites={sites}
            companyName={letterhead.companyName}
            expanded={open === r.id}
            onToggle={() => setOpen(open === r.id ? null : r.id)}
            onDone={() => setOpen(null)}
          />
        ))}
      </div>
    </>
  )
}

function SeriesCard({
  row,
  sites,
  companyName,
  expanded,
  onToggle,
  onDone,
}: {
  row: SeriesRow | null
  sites: { id: string; name: string }[]
  companyName: string
  expanded: boolean
  onToggle: () => void
  onDone: () => void
}) {
  const router = useRouter()
  const [f, setF] = useState<FormState>(row ? { ...row } : EMPTY)
  const [busy, setBusy] = useState<null | 'save' | 'delete'>(null)
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }))
  const id = row?.id ?? 'new'

  async function save() {
    if (busy) return
    setBusy('save')
    try {
      const r = await fetch(row ? `/api/settings/letter-series/${row.id}` : '/api/settings/letter-series', {
        method: row ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(f),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(letterMessage(j.error))
        return
      }
      toast.success(row ? 'บันทึกชุดเลขแล้ว' : `เพิ่มชุดเลข “${f.label}” แล้ว`)
      onDone()
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!row || busy) return
    setBusy('delete')
    try {
      const r = await fetch(`/api/settings/letter-series/${row.id}`, { method: 'DELETE' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(letterMessage(j.error))
        return
      }
      toast.success(`ลบชุดเลข “${row.label}” แล้ว`)
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="card-surface">
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-ink">
            {row ? row.label : 'ชุดเลขใหม่'}
            {row && <span className="ml-2 font-normal text-muted-token">คำนำหน้า <span className="tnum">{row.prefix}</span></span>}
            {row && !row.isActive && <span className="ml-2 text-xs font-normal text-muted-token">· ปิดใช้งาน</span>}
          </span>
          {row && <span className="block text-xs text-muted-token">{row.letters} ฉบับในทะเบียน</span>}
        </span>
        <ChevronDown className={`size-4 shrink-0 text-muted-token transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-line px-4 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-label`} className="label-base">ชื่อเรียกชุดเลข</label>
              <input id={`${id}-label`} value={f.label} onChange={(e) => set('label', e.target.value)} placeholder="เช่น ปรับปรุงอาคารสำนักทะเบียนฯ มช." className="input-base" />
            </div>
            <div>
              <label htmlFor={`${id}-prefix`} className="label-base">
                คำนำหน้าเลขที่ <span className="text-xs font-normal text-muted-token">— เช่น reg → reg048/2569</span>
              </label>
              <input id={`${id}-prefix`} value={f.prefix} onChange={(e) => set('prefix', e.target.value.replace(/\s/g, ''))} maxLength={12} className="input-base" />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor={`${id}-site`} className="label-base">ผูกกับโครงการ (ไม่บังคับ)</label>
              <select id={`${id}-site`} value={f.siteId ?? ''} onChange={(e) => set('siteId', e.target.value || null)} className="input-base">
                <option value="">— ไม่ผูก —</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor={`${id}-to`} className="label-base">เรียน (ค่าเริ่มต้น)</label>
              <input id={`${id}-to`} value={f.recipient} onChange={(e) => set('recipient', e.target.value)} className="input-base" />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor={`${id}-ref`} className="label-base">อ้างถึง ข้อ 1 (สัญญาจ้าง)</label>
              <input id={`${id}-ref`} value={f.contractRef} onChange={(e) => set('contractRef', e.target.value)} className="input-base" />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor={`${id}-intro`} className="label-base">
                ย่อหน้าแนะนำโครงการ <span className="text-xs font-normal text-muted-token">— {'{บริษัท}'} = ชื่อบริษัท</span>
              </label>
              <textarea id={`${id}-intro`} rows={4} value={f.intro} onChange={(e) => set('intro', e.target.value)} className="input-base" />
              {f.intro.includes('{บริษัท}') && companyName && (
                <p className="mt-1 text-xs text-muted-token">ตัวอย่าง: {fillCompany(f.intro, companyName)}</p>
              )}
            </div>
            <div>
              <label htmlFor={`${id}-title`} className="label-base">ตำแหน่งใต้ชื่อผู้ลงนาม</label>
              <input id={`${id}-title`} value={f.signerTitle} onChange={(e) => set('signerTitle', e.target.value)} className="input-base" />
            </div>
            <label className="flex items-center gap-2.5 self-end pb-2.5 text-sm text-ink">
              <input type="checkbox" checked={f.isActive} onChange={(e) => set('isActive', e.target.checked)} className="size-4 accent-brand" />
              เปิดใช้งาน (ปิด = ไม่โผล่ในตัวเลือกตอนออกหนังสือใหม่)
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="button" onClick={save} disabled={busy !== null} className="btn-primary">
              {busy === 'save' ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              {row ? 'บันทึก' : 'เพิ่มชุดเลข'}
            </button>
            <button type="button" onClick={onToggle} disabled={busy !== null} className="btn-secondary">ยกเลิก</button>
            {row && row.letters === 0 && (
              <button type="button" onClick={remove} disabled={busy !== null} className="btn-ghost ml-auto text-urgent">
                {busy === 'delete' ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                ลบชุดเลขนี้
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
