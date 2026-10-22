'use client'

import { useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import * as Dialog from '@radix-ui/react-dialog'
import { Download, ExternalLink, Loader2, Pencil, Search, Trash2, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  FILE_ACCEPT, FILE_CATEGORIES, FILE_CATEGORY_LABEL, FILE_MAX_BYTES, fileMessage, fileTypeOf, titleFromFileName,
  type FileCategory,
} from '@/lib/files'
import { fmtBytes } from '@/lib/format'

/**
 * คลังเอกสาร (R21) — ปุ่มอัปโหลด · ตัวกรอง · ปุ่มของแต่ละไฟล์
 * อัปโหลด = ขอลิงก์ (`/api/files/sign`) → PUT ตรงเข้า R2 (ไบต์ไม่ผ่าน Vercel · มีแถบความคืบหน้า) → บันทึก (`/api/files`)
 */

type Site = { id: string; name: string }
type Meta = { category: FileCategory; siteId: string; docNo: string; docDate: string; note: string }

const DIALOG = 'fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100svh-2rem)] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-line bg-surface shadow-e3 animate-pop-in'

async function jsonOrNull(r: Response) {
  return (await r.json().catch(() => ({}))) as { error?: string; key?: string; url?: string; contentType?: string }
}

/** PUT ตรงเข้า R2 ด้วย XHR — `fetch` บอกความคืบหน้าของการอัปโหลดไม่ได้ (ไฟล์แบบ 80 MB บนมือถือต้องเห็นว่ายังเดินอยู่) */
function putWithProgress(url: string, file: File, contentType: string, onProgress: (f: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('content-type', contentType)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('PUT_FAILED')))
    xhr.onerror = () => reject(new Error('PUT_FAILED'))
    xhr.send(file)
  })
}

function MetaFields({ meta, set, sites, children }: {
  meta: Meta
  set: <K extends keyof Meta>(k: K, v: Meta[K]) => void
  sites: Site[]
  children?: ReactNode
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label>
        <span className="label-base">หมวดเอกสาร</span>
        <select className="input-base" value={meta.category} onChange={(e) => set('category', e.target.value as FileCategory)}>
          {FILE_CATEGORIES.map((c) => <option key={c} value={c}>{FILE_CATEGORY_LABEL[c]}</option>)}
        </select>
      </label>
      <label>
        <span className="label-base">โครงการ</span>
        <select className="input-base" value={meta.siteId} onChange={(e) => set('siteId', e.target.value)}>
          <option value="">— ไม่ผูกโครงการ —</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      {children}
      <label>
        <span className="label-base">เลขที่เอกสาร <span className="text-xs font-normal text-muted-token">— เช่น เลขที่สัญญา</span></span>
        <input className="input-base" value={meta.docNo} maxLength={100} onChange={(e) => set('docNo', e.target.value)} />
      </label>
      <label>
        <span className="label-base">ลงวันที่</span>
        <input className="input-base" type="date" value={meta.docDate} onChange={(e) => set('docDate', e.target.value)} />
      </label>
      <label className="sm:col-span-2">
        <span className="label-base">หมายเหตุ <span className="text-xs font-normal text-muted-token">— คำที่อยากใช้ค้นหาทีหลัง</span></span>
        <textarea className="input-base" rows={2} value={meta.note} maxLength={2000} onChange={(e) => set('note', e.target.value)} />
      </label>
    </div>
  )
}

type Pending = { file: File; title: string; progress: number; state: 'wait' | 'up' | 'done' | 'err' }

export function UploadFilesButton({ sites, defaultSiteId, defaultCategory }: {
  sites: Site[]
  defaultSiteId: string | null
  defaultCategory: FileCategory | null
}) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const [items, setItems] = useState<Pending[]>([])
  const blank = (): Meta => ({ category: defaultCategory ?? 'contract', siteId: defaultSiteId ?? '', docNo: '', docDate: '', note: '' })
  const [meta, setMeta] = useState<Meta>(blank)
  const set = <K extends keyof Meta>(k: K, v: Meta[K]) => setMeta((m) => ({ ...m, [k]: v }))

  function add(list: FileList | null) {
    if (!list?.length) return
    const next: Pending[] = []
    for (const f of Array.from(list)) {
      if (!fileTypeOf(f.name)) { toast.error(`${f.name}: ${fileMessage('UNSUPPORTED_TYPE')}`); continue }
      if (f.size > FILE_MAX_BYTES) { toast.error(`${f.name}: ${fileMessage('FILE_TOO_LARGE')}`); continue }
      if (f.size === 0) { toast.error(`${f.name}: ${fileMessage('FILE_EMPTY')}`); continue }
      next.push({ file: f, title: titleFromFileName(f.name), progress: 0, state: 'wait' })
    }
    setItems((p) => [...p, ...next].slice(0, 20))
  }

  const patch = (i: number, p: Partial<Pending>) => setItems((list) => list.map((x, j) => (j === i ? { ...x, ...p } : x)))

  async function uploadOne(it: Pending, i: number) {
    patch(i, { state: 'up', progress: 0 })
    const sign = await fetch('/api/files/sign', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileName: it.file.name, byteSize: it.file.size }),
    })
    const s = await jsonOrNull(sign)
    if (!sign.ok || !s.url || !s.key || !s.contentType) throw new Error(s.error ?? 'SIGN_FAILED')
    await putWithProgress(s.url, it.file, s.contentType, (f) => patch(i, { progress: f }))
    const save = await fetch('/api/files', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...meta, objectKey: s.key, fileName: it.file.name, title: it.title }),
    })
    const r = await jsonOrNull(save)
    if (!save.ok) throw new Error(r.error ?? 'SAVE_FAILED')
    patch(i, { state: 'done', progress: 1 })
  }

  async function start() {
    if (items.some((x) => !x.title.trim())) return toast.error(fileMessage('TITLE_REQUIRED'))
    setBusy(true)
    let ok = 0
    for (const [i, it] of items.entries()) {
      if (it.state === 'done') { ok += 1; continue }
      try {
        await uploadOne(it, i)
        ok += 1
      } catch (e) {
        patch(i, { state: 'err' })
        const code = e instanceof Error ? e.message : ''
        toast.error(`${it.file.name}: ${code === 'PUT_FAILED' ? 'ส่งไฟล์ไม่สำเร็จ ตรวจสัญญาณแล้วลองใหม่' : fileMessage(code)}`)
        // ตารางยังไม่มี = ไฟล์ถัดไปก็ไม่ผ่าน ไม่ต้องลองต่อ
        if (code === 'TABLE_MISSING') break
      }
    }
    setBusy(false)
    if (ok) router.refresh()
    if (ok === items.length) {
      toast.success(`บันทึกเอกสารแล้ว ${ok} ไฟล์`)
      setOpen(false)
      setItems([])
      setMeta(blank())
    }
  }

  return (
    <>
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
        <Upload className="size-4" />อัปโหลดเอกสาร
      </button>
      <Dialog.Root open={open} onOpenChange={(v) => { if (!busy) setOpen(v) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
          <Dialog.Content className={DIALOG}>
            <div className="flex items-start gap-3 border-b border-line px-4 py-3">
              <div className="min-w-0 flex-1">
                <Dialog.Title className="text-lg font-bold text-ink">อัปโหลดเอกสาร</Dialog.Title>
                <Dialog.Description className="text-sm text-muted-token">
                  PDF รูปภาพ Excel Word DWG ZIP · ไฟล์ละไม่เกิน 100 MB · เลือกหลายไฟล์ได้ (ใช้หมวด/โครงการเดียวกัน)
                </Dialog.Description>
              </div>
              <Dialog.Close disabled={busy} className="btn-ghost" aria-label="ปิด"><X className="size-4" /></Dialog.Close>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              <button
                type="button"
                disabled={busy}
                onClick={() => input.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setOver(true) }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files) }}
                className={`flex w-full flex-col items-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${over ? 'border-brand bg-brand-tint' : 'border-line hover:border-brand'}`}
              >
                <Upload className="size-6 text-brand" />
                <span className="font-semibold text-ink">เลือกไฟล์ หรือลากมาวางตรงนี้</span>
              </button>
              <input ref={input} type="file" multiple accept={FILE_ACCEPT} className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = '' }} />

              {items.length > 0 && (
                <ul className="space-y-2">
                  {items.map((it, i) => (
                    <li key={`${it.file.name}-${i}`} className="rounded-md border border-line-soft p-2.5">
                      <div className="flex items-center gap-2">
                        <input
                          className="input-base min-w-0 flex-1 py-1.5"
                          aria-label="ชื่อเอกสาร"
                          value={it.title}
                          disabled={busy || it.state === 'done'}
                          onChange={(e) => patch(i, { title: e.target.value })}
                        />
                        {!busy && it.state !== 'done' && (
                          <button type="button" className="btn-ghost p-1.5" aria-label="เอาออก" onClick={() => setItems((l) => l.filter((_, j) => j !== i))}>
                            <X className="size-4" />
                          </button>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-token">
                        <span className="min-w-0 flex-1 truncate">{it.file.name} · {fmtBytes(it.file.size)}</span>
                        <span className={it.state === 'err' ? 'text-urgent' : it.state === 'done' ? 'text-status-done' : ''}>
                          {it.state === 'done' ? 'บันทึกแล้ว' : it.state === 'err' ? 'ไม่สำเร็จ' : it.state === 'up' ? `${Math.round(it.progress * 100)}%` : 'รออัปโหลด'}
                        </span>
                      </div>
                      {it.state === 'up' && (
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bar-track">
                          <div className="h-full bg-brand transition-[width]" style={{ width: `${it.progress * 100}%` }} />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <MetaFields meta={meta} set={set} sites={sites} />
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
              <Dialog.Close disabled={busy} className="btn-secondary">ยกเลิก</Dialog.Close>
              <button type="button" className="btn-primary" disabled={busy || !items.length} onClick={() => void start()}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                อัปโหลด {items.length ? `${items.length} ไฟล์` : ''}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}

export function FileFilters({ sites, years, value }: {
  sites: Site[]
  years: number[]
  value: { q: string; cat: string; site: string; year: string }
}) {
  const router = useRouter()
  const [q, setQ] = useState(value.q)
  const go = (next: Partial<typeof value>) => {
    const v = { ...value, q, ...next }
    const u = new URLSearchParams()
    for (const [k, x] of Object.entries(v)) if (x) u.set(k, x)
    const s = u.toString()
    router.push(s ? `/files?${s}` : '/files')
  }
  return (
    <form
      className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]"
      onSubmit={(e) => { e.preventDefault(); go({}) }}
    >
      <label className="relative block min-w-0">
        <span className="sr-only">ค้นหา</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-token" />
        <input
          type="search"
          className="input-base pl-9"
          value={q}
          placeholder="ค้นหาชื่อเอกสาร เลขที่ หมายเหตุ…"
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      <select className="input-base min-w-0" aria-label="หมวด" value={value.cat} onChange={(e) => go({ cat: e.target.value })}>
        <option value="">ทุกหมวด</option>
        {FILE_CATEGORIES.map((c) => <option key={c} value={c}>{FILE_CATEGORY_LABEL[c]}</option>)}
      </select>
      <select className="input-base min-w-0" aria-label="โครงการ" value={value.site} onChange={(e) => go({ site: e.target.value })}>
        <option value="">ทุกโครงการ</option>
        <option value="none">ไม่ผูกโครงการ</option>
        {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <select className="input-base min-w-0" aria-label="ปี" value={value.year} onChange={(e) => go({ year: e.target.value })}>
        <option value="">ทุกปี</option>
        {years.map((y) => <option key={y} value={y}>พ.ศ. {y + 543}</option>)}
      </select>
    </form>
  )
}

type FileRow = {
  id: string; category: FileCategory; title: string; siteId: string | null
  docNo: string; docDate: string; note: string; fileName: string
}

export function FileActions({ file, sites }: { file: FileRow; sites: Site[] }) {
  const router = useRouter()
  const [edit, setEdit] = useState(false)
  const [del, setDel] = useState(false)
  const [busy, setBusy] = useState(false)
  const [title, setTitle] = useState(file.title)
  const [meta, setMeta] = useState<Meta>({
    category: file.category, siteId: file.siteId ?? '', docNo: file.docNo, docDate: file.docDate, note: file.note,
  })
  const set = <K extends keyof Meta>(k: K, v: Meta[K]) => setMeta((m) => ({ ...m, [k]: v }))

  async function save() {
    if (!title.trim()) return toast.error(fileMessage('TITLE_REQUIRED'))
    setBusy(true)
    try {
      const r = await fetch(`/api/files/${file.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...meta, title }),
      })
      const j = await jsonOrNull(r)
      if (!r.ok) return toast.error(fileMessage(j.error ?? ''))
      toast.success('บันทึกแล้ว')
      setEdit(false)
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      const r = await fetch(`/api/files/${file.id}`, { method: 'DELETE' })
      const j = await jsonOrNull(r)
      if (!r.ok) return toast.error(fileMessage(j.error ?? '', 'ลบไม่สำเร็จ ลองใหม่อีกครั้ง'))
      toast.success('ลบเอกสารแล้ว')
      setDel(false)
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(false)
    }
  }

  const icon = 'btn-ghost p-2'
  return (
    <div className="flex shrink-0 flex-col gap-0.5 sm:flex-row">
      <a href={`/api/files/${file.id}`} target="_blank" rel="noopener" className={icon} aria-label="เปิด" title="เปิด"><ExternalLink className="size-4" /></a>
      <a href={`/api/files/${file.id}?download=1`} className={icon} aria-label="ดาวน์โหลด" title="ดาวน์โหลด"><Download className="size-4" /></a>
      <button type="button" className={icon} aria-label="แก้ไข" title="แก้ไข" onClick={() => setEdit(true)}><Pencil className="size-4" /></button>
      <button type="button" className={`${icon} text-urgent`} aria-label="ลบ" title="ลบ" onClick={() => setDel(true)}><Trash2 className="size-4" /></button>

      <Dialog.Root open={edit} onOpenChange={(v) => { if (!busy) setEdit(v) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
          <Dialog.Content className={DIALOG}>
            <div className="border-b border-line px-4 py-3">
              <Dialog.Title className="text-lg font-bold text-ink">แก้ไขข้อมูลเอกสาร</Dialog.Title>
              <Dialog.Description className="break-all text-sm text-muted-token">{file.fileName} · เปลี่ยนไฟล์ = อัปโหลดใหม่แล้วลบไฟล์นี้</Dialog.Description>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <MetaFields meta={meta} set={set} sites={sites}>
                <label className="sm:col-span-2">
                  <span className="label-base">ชื่อเอกสาร</span>
                  <input className="input-base" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
                </label>
              </MetaFields>
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
              <Dialog.Close disabled={busy} className="btn-secondary">ยกเลิก</Dialog.Close>
              <button type="button" className="btn-primary" disabled={busy} onClick={() => void save()}>
                {busy && <Loader2 className="size-4 animate-spin" />}บันทึก
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={del} onOpenChange={(v) => { if (!busy) setDel(v) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-surface p-5 shadow-e3 animate-pop-in">
            <Dialog.Title className="text-lg font-bold text-ink">ลบเอกสารนี้?</Dialog.Title>
            <Dialog.Description className="mt-1 break-words text-sm text-muted-token">
              &ldquo;{file.title}&rdquo; จะถูกลบทั้งข้อมูลและไฟล์ · กู้คืนไม่ได้
            </Dialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close disabled={busy} className="btn-secondary">ยกเลิก</Dialog.Close>
              <button type="button" className="btn-danger" disabled={busy} onClick={() => void remove()}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}ลบเอกสาร
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
