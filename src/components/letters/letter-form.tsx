'use client'

import * as Dialog from '@radix-ui/react-dialog'
import {
  AlertTriangle, Copy, FileDown, Loader2, Plus, Printer, RotateCcw, Trash2,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/ui/page-header'
import { LetterPreview } from '@/components/letters/letter-preview'
import { LetterTemplatePicker } from '@/components/letters/letter-template-picker'
import { LetterQuickFields } from '@/components/letters/letter-quick-fields'
import { LetterRefPicker } from '@/components/letters/letter-ref-picker'
import { LetterContractPicker, putContractRef, type SiteContract } from '@/components/letters/letter-contract-picker'
import { LetterPhotos, type LetterPhoto } from '@/components/letters/letter-photos'
import { LETTER_TEMPLATES, findLetterTemplate } from '@/lib/letter-templates'
import {
  CLOSING_OPTIONS, DEFAULT_CLOSING, autoFieldValue, bumpCounters, fillCompany, fillProject, formatLetterNo,
  generateFromTemplate, letterFileName, letterMessage, nextSeq, splitLines, stripItemNo, yearCeOf,
  type GeneratedText, type Letterhead, type LetterPaperData, type RegisterEntry,
} from '@/lib/letters'

export type SeriesOption = {
  id: string
  label: string
  prefix: string
  /** โครงการที่ผูกกับชุดเลข — กล่องอ้างถึงสัญญาโชว์โครงการนี้ก่อน */
  siteId: string | null
  recipient: string
  contractRef: string
  intro: string
  signerTitle: string
  isActive: boolean
}

/** หนังสือที่เปิดมาแก้ หรือฉบับต้นแบบของ "ทำซ้ำ" */
export type FormLetter = {
  id: string
  seriesId: string
  seq: number
  date: string
  subject: string
  recipient: string
  refs: string[]
  attachments: string[]
  body: string
  closing: string
  intro: string | null
  signerTitle: string
  showReceipt: boolean
  templateId: string | null
  fields: Record<string, string>
}

type Draft = {
  seriesId: string
  seq: number
  /** แก้เลขเองแล้ว — เปลี่ยนวันที่ไม่ต้องคำนวณเลขใหม่ทับ */
  seqManual: boolean
  date: string
  subject: string
  recipient: string
  refs: string
  attachments: string
  body: string
  closing: string
  useIntro: boolean
  intro: string
  signerTitle: string
  showReceipt: boolean
  templateId: string | null
  fields: Record<string, string>
}

const GEN_KEYS = ['subject', 'attachments', 'body', 'closing'] as const
const EMPTY_GEN: GeneratedText = { subject: '', attachments: '', body: '', closing: '', photoTitle: '' }

/** โครงการที่ผูกกับชุดเลข → ย่อหน้าแนะนำเติมชื่อเต็ม/ที่ตั้งให้ */
const seriesProject = (s: SeriesOption | undefined, contracts: SiteContract[]) =>
  contracts.find((c) => c.siteId === s?.siteId) ?? null

function seriesDefaults(s: SeriesOption | undefined, companyName: string, contracts: SiteContract[]) {
  return {
    recipient: s?.recipient ?? '',
    refs: s?.contractRef ?? '',
    intro: s ? fillProject(fillCompany(s.intro, companyName), seriesProject(s, contracts)) : '',
    useIntro: Boolean(s?.intro.trim()),
    signerTitle: s?.signerTitle ?? '',
  }
}

export function LetterForm({
  mode,
  series,
  entries: initialEntries,
  contracts,
  letterhead,
  logoUrl,
  today,
  initial,
  initialSeriesId,
  initialPhotos,
}: {
  mode: 'new' | 'edit'
  series: SeriesOption[]
  entries: RegisterEntry[]
  contracts: SiteContract[]
  letterhead: Letterhead
  logoUrl: string | null
  today: string
  /** edit = หนังสือฉบับนี้ · new = ฉบับต้นแบบของ "ทำซ้ำ" (หรือ null) */
  initial: FormLetter | null
  initialSeriesId: string | null
  /** รูปแนบที่เก็บไว้กับหนังสือ (หน้า `/letters/[id]`) */
  initialPhotos?: { photos: { key: string; url: string; caption: string }[]; title: string; layout: '1' | '2' }
}) {
  const router = useRouter()
  const company = letterhead.companyName
  const [entries, setEntries] = useState(initialEntries)
  const [savedId, setSavedId] = useState<string | null>(mode === 'edit' ? initial?.id ?? null : null)
  const [busy, setBusy] = useState<null | 'docx' | 'print' | 'delete'>(null)
  const [refOpen, setRefOpen] = useState(false)
  const [contractOpen, setContractOpen] = useState(false)
  /** พิมพ์/ดาวน์โหลด 2 ฉบับ — ต้นฉบับยื่นหน่วยงาน · สำเนาให้เจ้าหน้าที่เซ็นรับแล้วเก็บกลับมา (เจ้าของขอ 22 ต.ค. 2569) */
  const [copies, setCopies] = useState<1 | 2>(2)
  const [askDelete, setAskDelete] = useState(false)
  const [photos, setPhotos] = useState<LetterPhoto[]>(initialPhotos?.photos ?? [])
  const [photoTitle, setPhotoTitle] = useState(initialPhotos?.title ?? '')
  const [photoLayout, setPhotoLayout] = useState<'1' | '2'>(initialPhotos?.layout ?? '1')
  /** หนังสือนี้มีรูปเก็บอยู่ในระบบ — ลบรูปหมดแล้วบันทึก ต้องส่งรายการว่างไปลบด้วย */
  const hadPhotos = useRef(Boolean(initialPhotos?.photos.length))
  const warnedPhotos = useRef(false)
  const [gen, setGen] = useState<GeneratedText>(EMPTY_GEN)

  const [d, setD] = useState<Draft>(() => {
    if (initial) {
      const s = series.find((x) => x.id === initial.seriesId)
      const base: Draft = {
        seriesId: initial.seriesId,
        seq: initial.seq,
        seqManual: true,
        date: initial.date,
        subject: initial.subject,
        recipient: initial.recipient,
        refs: initial.refs.join('\n'),
        attachments: initial.attachments.join('\n'),
        body: initial.body,
        closing: initial.closing || DEFAULT_CLOSING,
        useIntro: initial.intro !== null,
        intro: initial.intro ?? seriesDefaults(s, company, contracts).intro,
        signerTitle: initial.signerTitle,
        showReceipt: initial.showReceipt,
        templateId: initial.templateId,
        fields: { ...initial.fields },
      }
      if (mode === 'edit') return base
      // ทำซ้ำ → ฉบับใหม่: เลขถัดไป วันนี้ และขยับ "ครั้งที่/งวดที่/ประจำเดือน" (R19-UI-09)
      const t = findLetterTemplate(initial.templateId)
      const next = { ...base, date: today, seqManual: false, seq: nextSeq(initialEntries, base.seriesId, yearCeOf(today)) }
      for (const f of t?.fields ?? []) {
        if (!f.auto) continue
        const v = autoFieldValue(f.auto, initialEntries, base.seriesId, today)
        next.fields[f.k] = v
        next.subject = bumpCounters(next.subject, f.auto, v)
        next.attachments = bumpCounters(next.attachments, f.auto, v)
        next.body = bumpCounters(next.body, f.auto, v)
      }
      return next
    }
    const active = series.filter((x) => x.isActive)
    const s = series.find((x) => x.id === initialSeriesId) ?? active[0] ?? series[0]
    return {
      seriesId: s?.id ?? '',
      seq: s ? nextSeq(initialEntries, s.id, yearCeOf(today)) : 1,
      seqManual: false,
      date: today,
      subject: '',
      ...seriesDefaults(s, company, contracts),
      attachments: '',
      body: '',
      closing: DEFAULT_CLOSING,
      showReceipt: true,
      templateId: null,
      fields: {},
    }
  })

  const cur = series.find((x) => x.id === d.seriesId)
  const prefix = cur?.prefix ?? ''
  const yearCe = yearCeOf(d.date)
  const letterNo = formatLetterNo(prefix, d.seq, yearCe)
  const template = findLetterTemplate(d.templateId)
  const seriesEntries = useMemo(() => entries.filter((e) => e.seriesId === d.seriesId), [entries, d.seriesId])
  const taken = entries.find((e) => e.seriesId === d.seriesId && e.yearCe === yearCe && e.seq === d.seq && e.id !== savedId)

  const usage = useMemo(() => {
    const out: Record<string, number> = {}
    for (const t of LETTER_TEMPLATES) if (t.match) out[t.id] = seriesEntries.filter((e) => t.match!.test(e.subject)).length
    return out
  }, [seriesEntries])

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }))

  /* ── แบบหนังสือ ─────────────────────────────────────────────────── */
  function pickTemplate(id: string) {
    const t = findLetterTemplate(id)
    if (!t) return
    const before = d
    const fields: Record<string, string> = {}
    for (const f of t.fields ?? []) fields[f.k] = f.auto ? autoFieldValue(f.auto, entries, d.seriesId, d.date) : f.def ?? ''
    const g = generateFromTemplate(t, fields, company)
    setD((p) => ({ ...p, templateId: id, fields, subject: g.subject, attachments: g.attachments, body: g.body, closing: g.closing }))
    setGen(g)
    if (g.photoTitle) setPhotoTitle(g.photoTitle)
    if (t.photoLayout) setPhotoLayout(t.photoLayout)
    // เนื้อความที่พิมพ์เองถูกแทน — ให้ย้อนได้ แทนการถามก่อน
    if (before.body.trim() && before.body !== gen.body) {
      toast(`ใช้แบบ “${t.name}” แล้ว`, { action: { label: 'เลิกทำ', onClick: () => setD(before) } })
    }
  }

  /** แก้ช่องด่วน → เติมข้อความใหม่เฉพาะช่องที่ยังเป็นข้อความอัตโนมัติ (R19-UI-04) */
  function setField(k: string, v: string) {
    if (!template) return
    const fields = { ...d.fields, [k]: v }
    const g = generateFromTemplate(template, fields, company)
    setD((p) => {
      const next = { ...p, fields }
      for (const key of GEN_KEYS) if (p[key] === gen[key]) next[key] = g[key]
      return next
    })
    if (photoTitle === gen.photoTitle) setPhotoTitle(g.photoTitle)
    setGen(g)
  }

  function changeSeries(id: string) {
    const s = series.find((x) => x.id === id)
    setD((p) => ({
      ...p,
      seriesId: id,
      ...seriesDefaults(s, company, contracts),
      seq: p.seqManual ? p.seq : nextSeq(entries, id, yearCeOf(p.date)),
    }))
  }

  function changeDate(v: string) {
    setD((p) => ({ ...p, date: v, seq: p.seqManual || savedId ? p.seq : nextSeq(entries, p.seriesId, yearCeOf(v)) }))
  }

  /* ── บันทึก / ไฟล์ Word / พิมพ์ ─────────────────────────────────── */
  async function persist(): Promise<string | null> {
    if (!d.seriesId) { toast.error(letterMessage('LETTER_SERIES_REQUIRED')); return null }
    if (!d.subject.trim()) { toast.error(letterMessage('LETTER_SUBJECT_REQUIRED')); return null }
    if (!d.recipient.trim()) { toast.error(letterMessage('LETTER_RECIPIENT_REQUIRED')); return null }

    const payload = {
      seriesId: d.seriesId,
      seq: d.seq,
      letterDate: d.date,
      subject: d.subject,
      recipient: d.recipient,
      refs: splitLines(d.refs).map(stripItemNo),
      attachments: splitLines(d.attachments).map(stripItemNo),
      body: d.body,
      closing: d.closing,
      intro: d.useIntro ? d.intro : null,
      signerTitle: d.signerTitle,
      showReceipt: d.showReceipt,
      templateId: d.templateId,
      fields: d.fields,
    }
    try {
      const r = await fetch(savedId ? `/api/letters/${savedId}` : '/api/letters', {
        method: savedId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        if (j.error === 'LETTER_NO_TAKEN') {
          toast.error(letterMessage(j.error), {
            action: { label: 'ใช้เลขถัดไป', onClick: () => setD((p) => ({ ...p, seqManual: false, seq: nextSeq(entries, p.seriesId, yearCeOf(p.date)) })) },
          })
        } else {
          toast.error(letterMessage(j.error))
        }
        return null
      }
      const id: string = savedId ?? j.id
      const entry: RegisterEntry = { id, seriesId: d.seriesId, seq: d.seq, yearCe, date: d.date, subject: d.subject.trim() }
      setEntries((p) => [entry, ...p.filter((e) => e.id !== id)])
      if (!savedId) {
        setSavedId(id)
        // เปลี่ยน URL โดยไม่โหลดหน้าใหม่ — รูปแนบที่เลือกไว้ต้องไม่หาย
        window.history.replaceState(null, '', `/letters/${id}`)
      }
      await savePhotos(id)
      return id
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
      return null
    }
  }

  /**
   * รูปแนบ → R2 (เฉพาะรูปที่เพิ่งเลือก) แล้วเก็บรายการทั้งชุดกับหนังสือ · ไม่สำเร็จ = แจ้งเตือน แต่หนังสือบันทึกแล้ว
   * · ยังไม่รัน migration (503) = เตือนครั้งเดียว ไฟล์ Word ยังได้รูปจากที่ส่งไปกับคำขอ
   */
  async function savePhotos(id: string) {
    if (!photos.length && !hadPhotos.current) return
    try {
      const next = [...photos]
      for (const [i, p] of next.entries()) {
        if (p.key || !p.file) continue
        const s = await fetch('/api/uploads/sign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ purpose: 'letter', contentType: p.file.type || 'image/jpeg', byteSize: p.file.size }),
        })
        const j = (await s.json().catch(() => ({}))) as { key?: string; url?: string; contentType?: string }
        if (!s.ok || !j.key || !j.url) throw new Error('SIGN')
        const put = await fetch(j.url, { method: 'PUT', headers: { 'content-type': j.contentType ?? 'image/jpeg' }, body: p.file })
        if (!put.ok) throw new Error('PUT')
        next[i] = { ...p, key: j.key }
      }
      setPhotos(next)
      const r = await fetch(`/api/letters/${id}/photos`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: photoTitle, layout: photoLayout, photos: next.map((p) => ({ key: p.key, caption: p.caption })) }),
      })
      if (r.status === 503) {
        if (!warnedPhotos.current) toast.warning('ยังไม่ได้ติดตั้งที่เก็บรูปแนบในฐานข้อมูล — รูปยังไม่ถูกเก็บกับหนังสือ (รัน migration 20261023120000_letter_photos.sql)')
        warnedPhotos.current = true
        return
      }
      if (!r.ok) throw new Error('SAVE')
      hadPhotos.current = next.length > 0
    } catch {
      toast.error('บันทึกหนังสือแล้ว แต่เก็บรูปแนบไม่สำเร็จ — ตรวจสัญญาณแล้วกดบันทึกอีกครั้ง')
    }
  }

  async function downloadWord() {
    if (busy) return
    setBusy('docx')
    try {
      const wasNew = !savedId
      const id = await persist()
      if (!id) return
      const fd = new FormData()
      // รูปที่เก็บในระบบแล้วเซิร์ฟเวอร์อ่านจาก R2 เอง · ส่งไฟล์ไปด้วยเผื่อยังไม่ได้รัน migration
      photos.forEach((p) => p.file && fd.append('photo', p.file))
      fd.append('captions', JSON.stringify(photos.filter((p) => p.file).map((p) => p.caption)))
      fd.append('photoTitle', photoTitle)
      fd.append('photoLayout', photoLayout)
      fd.append('copies', String(copies))
      const r = await fetch(`/api/letters/${id}/docx`, { method: 'POST', body: fd })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        toast.error(letterMessage(j.error ?? 'DOCX_FAILED'))
        return
      }
      const blob = await r.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = letterFileName(prefix, d.seq, d.subject)
      document.body.appendChild(a)
      a.click()
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1500)
      toast.success(wasNew ? `ดาวน์โหลดแล้ว · ลงทะเบียน ${letterNo} เรียบร้อย` : `ดาวน์โหลดแล้ว · บันทึก ${letterNo}`)
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(null)
    }
  }

  async function print() {
    if (busy) return
    setBusy('print')
    try {
      const id = await persist()
      if (id) window.print()
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!savedId || busy) return
    setBusy('delete')
    try {
      const r = await fetch(`/api/letters/${savedId}`, { method: 'DELETE' })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        toast.error(letterMessage(j.error ?? 'DELETE_FAILED'))
        return
      }
      toast.success(`ลบ ${letterNo} ออกจากทะเบียนแล้ว`)
      setAskDelete(false)
      router.push('/letters')
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(null)
    }
  }

  const paper: LetterPaperData = {
    letterNo,
    date: d.date,
    subject: d.subject,
    recipient: d.recipient,
    refs: splitLines(d.refs).map(stripItemNo),
    attachments: splitLines(d.attachments).map(stripItemNo),
    intro: d.useIntro && d.intro.trim() ? d.intro : null,
    body: d.body,
    closing: d.closing,
    signerTitle: d.signerTitle,
    showReceipt: d.showReceipt,
    letterhead,
  }

  const actions = (
    <>
      <button type="button" onClick={downloadWord} disabled={busy !== null} className="btn-primary">
        {busy === 'docx' ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
        ดาวน์โหลด Word
      </button>
      <button type="button" onClick={print} disabled={busy !== null} className="btn-secondary">
        {busy === 'print' ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
        พิมพ์ / PDF
      </button>
    </>
  )

  return (
    <>
      <PageHeader
        className="print-hide"
        title={savedId ? `หนังสือ ${letterNo}` : 'ออกหนังสือใหม่'}
        subtitle={
          savedId
            ? 'ลงทะเบียนแล้ว — แก้แล้วกดดาวน์โหลด/พิมพ์อีกครั้งเพื่อบันทึก'
            : 'เลือกแบบ → กรอกช่องเฉพาะเรื่อง → ดาวน์โหลด Word หรือพิมพ์ (ระบบลงทะเบียนให้ตอนกด)'
        }
        backHref="/letters"
        action={
          <>
            {actions}
            {savedId && (
              <>
                <Link href={`/letters/new?from=${savedId}`} className="btn-secondary">
                  <Copy className="size-4" /> ทำซ้ำเป็นฉบับใหม่
                </Link>
                <button type="button" onClick={() => setAskDelete(true)} disabled={busy !== null} className="btn-danger">
                  <Trash2 className="size-4" /> ลบ
                </button>
              </>
            )}
          </>
        }
      />

      {!letterhead.address || !letterhead.signerName ? (
        <Link
          href="/settings/documents"
          className="print-hide mb-3 flex items-center gap-2.5 rounded-lg border border-status-progress-ring bg-status-progress-bg px-3 py-2.5 text-sm text-status-progress"
        >
          <AlertTriangle className="size-4.5 shrink-0" strokeWidth={1.8} />
          ยังไม่ได้ตั้งที่อยู่/เบอร์โทร หรือชื่อผู้ลงนามของบริษัท — แตะเพื่อไปตั้งที่หน้า &ldquo;เอกสาร&rdquo; ในตั้งค่า
        </Link>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <div className="print-hide min-w-0 space-y-4">
          <section className="card-surface p-4">
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-ink">
              <Step n={1} /> เลือกแบบหนังสือ
            </h2>
            <LetterTemplatePicker selected={d.templateId} usage={usage} onPick={pickTemplate} />
          </section>

          {template && (template.fields?.length ?? 0) > 0 && (
            <section className="card-surface p-4">
              <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-ink">
                <Step n={2} /> ข้อมูลเฉพาะเรื่องนี้
                <span className="ml-auto text-xs font-normal text-muted-token">ข้อความด้านล่างเติมให้เอง</span>
              </h2>
              <LetterQuickFields template={template} values={d.fields} onChange={setField} />
            </section>
          )}

          <section className="card-surface space-y-3.5 p-4">
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
              <Step n={template && (template.fields?.length ?? 0) > 0 ? 3 : 2} /> รายละเอียดหนังสือ
            </h2>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="lf-series" className="label-base">ชุดเลขหนังสือ (โครงการ)</label>
                <select
                  id="lf-series"
                  value={d.seriesId}
                  onChange={(e) => changeSeries(e.target.value)}
                  disabled={Boolean(savedId)}
                  className="input-base"
                >
                  {series.length === 0 && <option value="">— ยังไม่มีชุดเลข —</option>}
                  {series.map((s) => (
                    <option key={s.id} value={s.id} disabled={!s.isActive && s.id !== d.seriesId}>
                      {s.label} ({s.prefix}){s.isActive ? '' : ' · ปิดใช้งาน'}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="lf-seq" className="label-base">เลขที่</label>
                <div className="flex items-stretch overflow-hidden rounded-md border border-line-strong bg-surface">
                  <span className="grid place-items-center bg-surface-2 px-2.5 text-sm text-muted-token">{prefix || '—'}</span>
                  <input
                    id="lf-seq"
                    type="number"
                    min={1}
                    max={99999}
                    value={d.seq}
                    onChange={(e) => { const n = Number(e.target.value); if (n > 0) setD((p) => ({ ...p, seq: n, seqManual: true })) }}
                    className="min-w-0 flex-1 bg-surface px-2 py-2.5 text-center text-base font-semibold tnum text-ink focus:outline-none"
                  />
                  <span className="grid place-items-center bg-surface-2 px-2.5 text-sm text-muted-token tnum">/{yearCe + 543}</span>
                  <button
                    type="button"
                    title="ใช้เลขถัดไปจากทะเบียน"
                    aria-label="ใช้เลขถัดไปจากทะเบียน"
                    onClick={() => setD((p) => ({ ...p, seqManual: false, seq: nextSeq(entries, p.seriesId, yearCeOf(p.date)) }))}
                    className="border-l border-line px-2.5 text-muted-token transition-colors hover:text-brand"
                  >
                    <RotateCcw className="size-4" />
                  </button>
                </div>
                {taken && <p className="mt-1 text-xs text-urgent">เลขนี้ใช้ไปแล้วกับ “{taken.subject}”</p>}
              </div>
              <div>
                <label htmlFor="lf-date" className="label-base">ลงวันที่</label>
                <input id="lf-date" type="date" value={d.date} onChange={(e) => changeDate(e.target.value || today)} className="input-base" />
              </div>
            </div>

            <Field id="lf-subject" label="เรื่อง">
              <input id="lf-subject" value={d.subject} onChange={(e) => set('subject', e.target.value)} placeholder="เช่น ขออนุมัติใช้วัสดุ ครั้งที่ 14" className="input-base" />
            </Field>
            <Field id="lf-recipient" label="เรียน">
              <input id="lf-recipient" value={d.recipient} onChange={(e) => set('recipient', e.target.value)} className="input-base" />
            </Field>
            <Field
              id="lf-refs"
              label="อ้างถึง"
              hint="บรรทัดละ 1 รายการ ไม่ต้องใส่เลขข้อ"
              extra={
                <span className="flex flex-wrap justify-end gap-x-1">
                  <button type="button" onClick={() => setContractOpen(true)} className="btn-ghost -my-1 px-2 py-1 text-xs text-brand">
                    <Plus className="size-3.5" /> อ้างถึงสัญญาของโครงการ
                  </button>
                  <button type="button" onClick={() => setRefOpen(true)} className="btn-ghost -my-1 px-2 py-1 text-xs text-brand">
                    <Plus className="size-3.5" /> อ้างถึงหนังสือในทะเบียน
                  </button>
                </span>
              }
            >
              <textarea id="lf-refs" rows={2} value={d.refs} onChange={(e) => set('refs', e.target.value)} className="input-base" />
            </Field>
            <Field id="lf-atts" label="สิ่งที่ส่งมาด้วย" hint="บรรทัดละ 1 รายการ เว้นว่างได้">
              <textarea id="lf-atts" rows={2} value={d.attachments} onChange={(e) => set('attachments', e.target.value)} className="input-base" />
            </Field>
            <Field id="lf-body" label="เนื้อความ" hint="1 บรรทัด = 1 ย่อหน้า · ขึ้นต้นด้วย 1. 2. เพื่อทำเป็นข้อ ๆ">
              <textarea id="lf-body" rows={6} value={d.body} onChange={(e) => set('body', e.target.value)} className="input-base" />
            </Field>

            <div className="rounded-md border border-line-soft bg-surface-2 px-3 py-2.5">
              <label className="flex items-start gap-2.5 text-sm text-ink">
                <input type="checkbox" checked={d.useIntro} onChange={(e) => set('useIntro', e.target.checked)} className="mt-1 size-4 accent-brand" />
                <span>ใส่ย่อหน้าแนะนำโครงการ (&ldquo;ข้าพเจ้า … ตามหนังสือที่อ้างถึง (1)&rdquo;) ไว้ก่อนเนื้อความ</span>
              </label>
              {d.useIntro && (() => {
                const proj = seriesProject(cur, contracts)
                return proj ? (
                  <p className="mt-1.5 pl-6 text-xs text-muted-token">
                    ชื่อโครงการและที่ตั้งดึงจากโครงการ &ldquo;{proj.name}&rdquo;
                    {!proj.fullName && ' (ยังไม่ได้กรอกชื่อเต็ม — ใช้ชื่อย่อ · กรอกได้ที่หน้าโครงการ → แก้ไข)'}
                    {' · '}
                    <button type="button" className="font-medium text-brand hover:underline" onClick={() => set('intro', seriesDefaults(cur, company, contracts).intro)}>
                      เติมจากโครงการใหม่
                    </button>
                  </p>
                ) : (
                  <p className="mt-1.5 pl-6 text-xs text-status-progress">
                    ชุดเลขนี้ยังไม่ได้ผูกโครงการ — ผูกที่ ตั้งค่า → ชุดเลขหนังสือ แล้วระบบเติมชื่อโครงการเต็มและที่ตั้งให้
                  </p>
                )
              })()}
              {d.useIntro && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium text-brand">แก้ย่อหน้าแนะนำเฉพาะฉบับนี้</summary>
                  <textarea rows={4} value={d.intro} onChange={(e) => set('intro', e.target.value)} aria-label="ย่อหน้าแนะนำโครงการ" className="input-base mt-2" />
                </details>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field id="lf-closing" label="ข้อความปิดท้าย">
                <input id="lf-closing" list="lf-closing-list" value={d.closing} onChange={(e) => set('closing', e.target.value)} className="input-base" />
                <datalist id="lf-closing-list">{CLOSING_OPTIONS.map((c) => <option key={c} value={c} />)}</datalist>
              </Field>
              <Field id="lf-title" label="ตำแหน่งใต้ชื่อผู้ลงนาม">
                <input id="lf-title" value={d.signerTitle} onChange={(e) => set('signerTitle', e.target.value)} className="input-base" />
              </Field>
            </div>

            <label className="flex items-center gap-2.5 text-sm text-ink">
              <input type="checkbox" checked={d.showReceipt} onChange={(e) => set('showReceipt', e.target.checked)} className="size-4 accent-brand" />
              มีกล่อง &ldquo;รับเอกสารแล้ว ลงชื่อ… วันที่…&rdquo; มุมขวาล่าง
            </label>
            <label className="flex items-start gap-2.5 text-sm text-ink">
              <input type="checkbox" checked={copies === 2} onChange={(e) => setCopies(e.target.checked ? 2 : 1)} className="mt-0.5 size-4 shrink-0 accent-brand" />
              <span>
                พิมพ์ 2 ฉบับ: <b>ต้นฉบับ</b> + <b>สำเนาคู่ฉบับ</b>
                <span className="block text-xs text-muted-token">ต้นฉบับไม่มีป้ายและไม่มีกล่องรับเอกสาร · สำเนาคู่ฉบับมีป้ายกลางหน้าบนสุดและกล่อง &ldquo;รับเอกสารแล้ว&rdquo; ให้เจ้าหน้าที่เซ็นรับแล้วนำกลับมาเก็บ · ใช้ทั้งปุ่มพิมพ์และไฟล์ Word</span>
              </span>
            </label>
          </section>

          <details className="card-surface p-4" open={photos.length > 0 || undefined}>
            <summary className="cursor-pointer text-base font-semibold text-ink">
              รูปภาพแนบท้ายหนังสือ <span className="text-sm font-normal text-muted-token">(ไม่บังคับ{photos.length ? ` · ${photos.length} รูป` : ''})</span>
            </summary>
            <div className="mt-3">
              <LetterPhotos
                photos={photos}
                onChange={setPhotos}
                title={photoTitle}
                onTitle={setPhotoTitle}
                layout={photoLayout}
                onLayout={setPhotoLayout}
              />
            </div>
          </details>

          <div className="flex flex-wrap gap-2">{actions}</div>
        </div>

        <div className="min-w-0 lg:sticky lg:top-4">
          <p className="print-hide mb-2 text-sm font-semibold text-ink-2">ตัวอย่างหนังสือ (A4)</p>
          <LetterPreview
            copies={copies}
            letter={paper}
            logoUrl={logoUrl}
            photos={photos.map((p) => ({ url: p.url, caption: p.caption }))}
            photoTitle={photoTitle}
            photoLayout={photoLayout}
          />
        </div>
      </div>

      <LetterContractPicker
        open={contractOpen}
        onOpenChange={setContractOpen}
        contracts={contracts}
        preferSiteId={series.find((x) => x.id === d.seriesId)?.siteId ?? null}
        onPick={(line) => setD((p) => ({ ...p, refs: putContractRef(p.refs, line) }))}
      />

      <LetterRefPicker
        open={refOpen}
        onOpenChange={setRefOpen}
        entries={seriesEntries.filter((e) => e.id !== savedId)}
        prefix={prefix}
        onPick={(line) => setD((p) => ({ ...p, refs: p.refs.trim() ? `${p.refs.trim()}\n${line}` : line }))}
      />

      <Dialog.Root open={askDelete} onOpenChange={(v) => { if (busy !== 'delete') setAskDelete(v) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-surface p-5 shadow-e3 animate-pop-in">
            <Dialog.Title className="text-lg font-bold text-ink">ลบ {letterNo} ออกจากทะเบียน?</Dialog.Title>
            <Dialog.Description className="mt-0.5 text-sm text-muted-token">
              &ldquo;{d.subject}&rdquo; จะหายจากทะเบียน · สำเนาก่อนลบยังอยู่ในประวัติการแก้ไข
              · เลขนี้จะว่างให้ฉบับอื่นใช้ได้
            </Dialog.Description>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setAskDelete(false)} disabled={busy === 'delete'} className="btn-secondary">ยกเลิก</button>
              <button type="button" onClick={remove} disabled={busy === 'delete'} className="btn-danger">
                {busy === 'delete' ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                ลบ
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}

function Step({ n }: { n: number }) {
  return (
    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-solid text-xs font-bold text-white">{n}</span>
  )
}

function Field({
  id, label, hint, extra, children,
}: {
  id: string
  label: string
  hint?: string
  extra?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="label-base">
          {label}
          {hint && <span className="ml-1.5 text-xs font-normal text-muted-token">— {hint}</span>}
        </label>
        {extra}
      </div>
      {children}
    </div>
  )
}
