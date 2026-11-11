'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { ArrowDown, ArrowUp, Eye, EyeOff, FolderPen, FolderPlus, FolderX, ImagePlus, Loader2, Package, Pencil, Plus, Stamp, Trash2, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { EmptyState } from '@/components/ui/states'
import { prepareCatalogFiles, prepareStampFile, uploadCatalogFile } from '@/lib/catalog-upload'
import { CATALOG_CATEGORIES, CATALOG_LIMITS, catalogMessage, type CatalogItem } from '@/lib/material-library'
import { MA_NOTE_OPTIONS } from '@/lib/material-approval'

export type LibraryItem = CatalogItem & { thumbUrl: string }

const DIALOG =
  'fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100svh-2rem)] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-line bg-surface shadow-e3 animate-pop-in'

type Draft = { id: string | null; name: string; category: string; detail: string; note: string }
/** หน้าแค็ตตาล็อกในกล่องแก้: `key` = อยู่ในคลังแล้ว · `file` = เพิ่งเลือก (ยังไม่อัป) */
type DraftPage = { key?: string; file?: File; url: string }

const emptyDraft = (): Draft => ({ id: null, name: '', category: '', detail: '', note: MA_NOTE_OPTIONS[0] })

async function api(url: string, init?: RequestInit) {
  const r = await fetch(url, init)
  const j = (await r.json().catch(() => ({}))) as { error?: string; item?: unknown }
  return { ok: r.ok, status: r.status, j }
}

/**
 * หน้าคลังวัสดุขออนุมัติ (R27) — การ์ดวัสดุ · เพิ่ม/แก้/ซ่อน/ลบ · ตราประทับบริษัท
 * · อัปไฟล์: รูป/PDF → รูปทีละหน้า (ย่อที่เบราว์เซอร์) → R2 ตรง → บันทึกคีย์ที่ `/api/material-library`
 * · วัสดุที่หนังสือใช้อยู่ลบไม่ได้ (409) → ซ่อนแทน
 */
export function MaterialLibraryClient({ items, missing, stampUrl }: { items: LibraryItem[]; missing: boolean; stampUrl: string | null }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [pages, setPages] = useState<DraftPage[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [del, setDel] = useState<LibraryItem | null>(null)
  const [stampBusy, setStampBusy] = useState(false)
  // หมวดที่เพิ่มจากปุ่ม "เพิ่มหมวด" แต่ยังไม่มีวัสดุ — หมวดเกิดจากวัสดุที่ใช้หมวดนั้น จึงอยู่ได้ถึงรีเฟรชหน้าจนกว่าจะมีวัสดุเข้าหมวด
  const [extraCats, setExtraCats] = useState<string[]>([])
  const [catDialog, setCatDialog] = useState(false)
  const [newCat, setNewCat] = useState('')
  const [catAction, setCatAction] = useState<null | 'rename' | 'delete'>(null)
  const [renameTo, setRenameTo] = useState('')
  const [catBusy, setCatBusy] = useState(false)

  const categories = useMemo(() => Array.from(new Set(items.map((i) => i.category).filter(Boolean))).sort(), [items])
  // ตัวเลือกหมวดบนตัวกรอง = หมวดที่มีวัสดุ + หมวดที่เพิ่มเอง + หมวดมาตรฐาน (ว่างก็เลือกดูได้)
  const allCats = useMemo(() => Array.from(new Set([...categories, ...extraCats, ...CATALOG_CATEGORIES])), [categories, extraCats])
  const shown = items.filter((i) => {
    if (!showHidden && !i.isActive) return false
    if (cat && i.category !== cat) return false
    const t = q.trim().toLowerCase()
    return !t || `${i.name} ${i.detail} ${i.category}`.toLowerCase().includes(t)
  })
  const hiddenCount = items.filter((i) => !i.isActive).length

  if (missing) {
    return (
      <div className="panel p-5 text-sm text-ink-2">
        <p className="font-semibold text-ink">ยังไม่ได้ติดตั้งคลังวัสดุในฐานข้อมูล</p>
        <p className="mt-1">รัน migration <code>supabase/migrations/20261103090000_r27_material_library.sql</code> แล้วรีเฟรชหน้านี้</p>
      </div>
    )
  }

  function startNew() {
    // กรองหมวดไว้อยู่ = วัสดุใหม่เข้าหมวดนั้นให้เลย
    setDraft({ ...emptyDraft(), category: cat })
    setPages([])
    setOpen(true)
  }

  const catCount = cat ? items.filter((i) => i.category === cat).length : 0
  const isDefaultCat = (CATALOG_CATEGORIES as readonly string[]).includes(cat)

  /** เปลี่ยนชื่อ/ลบหมวดที่กรองอยู่ — มีวัสดุ = แก้ที่ฐานข้อมูลทุกตัวในหมวด · ไม่มีวัสดุ = เอาออกจากรายการที่เพิ่มเอง (หมวดมาตรฐานลบไม่ได้) */
  async function applyCategory() {
    const to = catAction === 'rename' ? renameTo.replace(/\s+/g, ' ').trim() : ''
    if (catAction === 'rename') {
      if (!to) return toast.error('ใส่ชื่อหมวดใหม่ก่อน')
      if (to.length > CATALOG_LIMITS.category) return toast.error(`ชื่อหมวดยาวเกินไป (ไม่เกิน ${CATALOG_LIMITS.category} ตัวอักษร)`)
      if (to === cat) return setCatAction(null)
    }
    setCatBusy(true)
    try {
      if (catCount > 0) {
        const r = await api('/api/material-library/categories', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: cat, to }),
        })
        if (!r.ok) return toast.error(catalogMessage(r.j.error))
      } else if (catAction === 'delete' && isDefaultCat && !extraCats.includes(cat)) {
        return toast.error('หมวดมาตรฐานลบออกจากรายการไม่ได้ — ปล่อยว่างไว้ได้ ไม่กระทบอะไร')
      }
      setExtraCats((x) => (catAction === 'rename' ? [...new Set(x.map((c) => (c === cat ? to : c)))] : x.filter((c) => c !== cat)))
      toast.success(
        catAction === 'rename' ? `เปลี่ยนชื่อหมวดเป็น "${to}" แล้ว${catCount ? ` (${catCount} วัสดุ)` : ''}` : `ลบหมวด "${cat}" แล้ว${catCount ? ` — วัสดุ ${catCount} รายการยังอยู่ แค่ไม่มีหมวด` : ''}`,
      )
      setCat(catAction === 'rename' ? to : '')
      setCatAction(null)
      router.refresh()
    } catch {
      toast.error('เปลี่ยนหมวดไม่สำเร็จ ตรวจการเชื่อมต่อแล้วลองใหม่')
    } finally {
      setCatBusy(false)
    }
  }

  function addCategory() {
    const name = newCat.replace(/\s+/g, ' ').trim()
    if (!name) return toast.error('ใส่ชื่อหมวดก่อน')
    if (name.length > CATALOG_LIMITS.category) return toast.error(`ชื่อหมวดยาวเกินไป (ไม่เกิน ${CATALOG_LIMITS.category} ตัวอักษร)`)
    const dup = allCats.find((c) => c.toLowerCase() === name.toLowerCase())
    const use = dup ?? name
    if (!dup) setExtraCats((x) => [...x, name])
    setCat(use)
    setCatDialog(false)
    setNewCat('')
    toast.success(dup ? `มีหมวด "${use}" อยู่แล้ว — เลือกให้แล้ว` : `เพิ่มหมวด "${name}" แล้ว — กด "เพิ่มวัสดุ" เพื่อใส่วัสดุเข้าหมวดนี้`)
  }

  async function startEdit(it: LibraryItem) {
    setLoadingId(it.id)
    try {
      const r = await api(`/api/material-library/${it.id}`)
      const item = r.j.item as (Omit<CatalogItem, 'pages'> & { pages: { key: string; url: string }[] }) | undefined
      if (!r.ok || !item) {
        toast.error(catalogMessage(r.j.error))
        return
      }
      setDraft({ id: it.id, name: item.name, category: item.category, detail: item.detail, note: item.note })
      setPages(item.pages.map((p) => ({ key: p.key, url: p.url })))
      setOpen(true)
    } finally {
      setLoadingId(null)
    }
  }

  async function addFiles(input: FileList | null) {
    const files = input ? Array.from(input) : [] // คัดลอกก่อน await (§17 ข้อ 42)
    if (!files.length) return
    setBusy(true)
    try {
      const ready = await prepareCatalogFiles(files, CATALOG_LIMITS.pages - pages.length, setProgress)
      setPages((p) => [...p, ...ready.map((file) => ({ file, url: URL.createObjectURL(file) }))])
    } finally {
      setProgress('')
      setBusy(false)
    }
  }

  function removePage(i: number) {
    setPages((p) => {
      if (p[i]?.url.startsWith('blob:')) URL.revokeObjectURL(p[i].url)
      return p.filter((_, j) => j !== i)
    })
  }
  const move = (i: number, d: -1 | 1) =>
    setPages((p) => {
      const j = i + d
      if (j < 0 || j >= p.length) return p
      const n = [...p]
      ;[n[i], n[j]] = [n[j], n[i]]
      return n
    })

  async function save() {
    if (busy) return
    if (!draft.name.trim()) {
      toast.error(catalogMessage('CATALOG_NAME_REQUIRED'))
      return
    }
    setBusy(true)
    try {
      const keys: { key: string }[] = []
      for (const [i, p] of pages.entries()) {
        if (p.key) { keys.push({ key: p.key }); continue }
        if (!p.file) continue
        setProgress(`กำลังอัปโหลดหน้า ${i + 1}/${pages.length}`)
        keys.push({ key: await uploadCatalogFile(p.file) })
      }
      setProgress('กำลังบันทึก')
      const body = JSON.stringify({ name: draft.name, category: draft.category, detail: draft.detail, note: draft.note, pages: keys })
      const r = await api(draft.id ? `/api/material-library/${draft.id}` : '/api/material-library', {
        method: draft.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      if (!r.ok) {
        toast.error(catalogMessage(r.j.error))
        return
      }
      pages.forEach((p) => p.url.startsWith('blob:') && URL.revokeObjectURL(p.url))
      toast.success(draft.id ? 'บันทึกวัสดุแล้ว' : 'เพิ่มวัสดุเข้าคลังแล้ว')
      setOpen(false)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error && /[ก-๙]/.test(e.message) ? e.message : catalogMessage('SAVE_FAILED'))
    } finally {
      setProgress('')
      setBusy(false)
    }
  }

  async function toggleHidden(it: LibraryItem) {
    setLoadingId(it.id)
    try {
      const r = await api(`/api/material-library/${it.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !it.isActive }),
      })
      if (!r.ok) toast.error(catalogMessage(r.j.error))
      else {
        toast.success(it.isActive ? 'ซ่อนวัสดุแล้ว — ไม่โผล่ตอนเลือกในหนังสือ' : 'แสดงวัสดุแล้ว')
        router.refresh()
      }
    } finally {
      setLoadingId(null)
    }
  }

  async function doDelete() {
    if (!del) return
    setBusy(true)
    try {
      const r = await api(`/api/material-library/${del.id}`, { method: 'DELETE' })
      if (!r.ok) {
        toast.error(catalogMessage(r.j.error))
        return
      }
      toast.success('ลบวัสดุแล้ว')
      setDel(null)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function setStamp(file: File | null) {
    setStampBusy(true)
    try {
      let key: string | null = null
      if (file) key = await uploadCatalogFile(await prepareStampFile(file))
      const r = await api('/api/material-library/stamp', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      })
      if (!r.ok) {
        toast.error(catalogMessage(r.j.error))
        return
      }
      toast.success(file ? 'ตั้งตราประทับแล้ว' : 'เอาตราประทับออกแล้ว')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error && /[ก-๙]/.test(e.message) ? e.message : 'ตั้งตราประทับไม่สำเร็จ เลือกไฟล์รูปภาพแล้วลองใหม่')
    } finally {
      setStampBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <section className="card-surface flex flex-wrap items-center gap-3 p-4">
        <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-surface-2">
          {stampUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- presigned URL ของตราประทับ (§9)
            <img src={stampUrl} alt="ตราประทับบริษัท" className="size-full object-contain" />
          ) : (
            <Stamp className="size-7 text-muted-token" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-ink">ตราประทับบริษัท</h2>
          <p className="text-sm text-muted-token">
            ตอนเลือกแค็ตตาล็อกเข้าหนังสือ ระบบประทับตรานี้มุมขวาล่างของทุกหน้าให้ (ปิดได้ทีละหน้า) — ใช้รูปที่สแกนบนพื้นขาวได้ ไม่ต้องตัดพื้นหลัง
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className={`btn-secondary cursor-pointer ${stampBusy ? 'pointer-events-none opacity-60' : ''}`}>
            {stampBusy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
            {stampUrl ? 'เปลี่ยนตรา' : 'อัปโหลดตรา'}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only"
              onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ''; if (f) void setStamp(f) }} />
          </label>
          {stampUrl && (
            <button type="button" className="btn-ghost text-urgent" disabled={stampBusy} onClick={() => void setStamp(null)}>
              <Trash2 className="size-4" /> เอาออก
            </button>
          )}
        </div>
      </section>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[12rem] flex-1">
          <label htmlFor="ml-q" className="label-base">ค้นหาวัสดุ</label>
          <input id="ml-q" className="input-base" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ชื่อ ยี่ห้อ รุ่น" />
        </div>
        <div>
          <label htmlFor="ml-cat" className="label-base">หมวด</label>
          <select id="ml-cat" className="input-base" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">ทุกหมวด</option>
            {allCats.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <button type="button" className="btn-secondary" onClick={() => setCatDialog(true)}>
          <FolderPlus className="size-4" /> เพิ่มหมวด
        </button>
        {cat && (
          <>
            <button type="button" className="btn-secondary" onClick={() => { setRenameTo(cat); setCatAction('rename') }}>
              <FolderPen className="size-4" /> เปลี่ยนชื่อหมวด
            </button>
            <button type="button" className="btn-ghost text-urgent" onClick={() => setCatAction('delete')}>
              <FolderX className="size-4" /> ลบหมวด
            </button>
          </>
        )}
        {hiddenCount > 0 && (
          <label className="flex items-center gap-1.5 pb-2.5 text-sm text-ink-2">
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
            แสดงที่ซ่อน ({hiddenCount})
          </label>
        )}
        <button type="button" className="btn-primary" onClick={startNew}>
          <Plus className="size-4" /> เพิ่มวัสดุ
        </button>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={Package} message="ยังไม่มีวัสดุในคลัง — เพิ่มวัสดุที่ใช้ประจำพร้อมแค็ตตาล็อก แล้วตอนทำหนังสือเลือกมาได้เลย" action={<button type="button" className="btn-primary" onClick={startNew}><Plus className="size-4" /> เพิ่มวัสดุ</button>} />
      ) : shown.length === 0 ? (
        <EmptyState icon={Package} message="ไม่พบวัสดุที่ตรงกับที่ค้นหา" />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((it) => (
            <li key={it.id} className={`card-surface flex flex-col overflow-hidden ${it.isActive ? '' : 'opacity-60'}`}>
              <div className="grid h-36 place-items-center border-b border-line-soft bg-surface-2">
                {it.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- presigned URL (§9)
                  <img src={it.thumbUrl} alt="" className="h-full w-full object-contain" />
                ) : (
                  <span className="text-sm text-muted-token">ไม่มีแค็ตตาล็อก</span>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-1 p-3">
                <p className="break-words text-base font-semibold text-ink">{it.name}</p>
                {it.detail && <p className="break-words text-sm text-ink-2">{it.detail}</p>}
                <p className="flex flex-wrap gap-x-2 text-xs text-muted-token">
                  {it.category && <span>{it.category}</span>}
                  <span className="tabular-nums">{it.pages.length} หน้า</span>
                  {!it.isActive && <span className="font-semibold text-urgent">ซ่อนอยู่</span>}
                </p>
              </div>
              <div className="flex flex-wrap gap-1 border-t border-line-soft p-1.5">
                <button type="button" className="btn-ghost px-2" disabled={loadingId === it.id} onClick={() => void startEdit(it)}>
                  {loadingId === it.id ? <Loader2 className="size-4 animate-spin" /> : <Pencil className="size-4" />} แก้ไข
                </button>
                <button type="button" className="btn-ghost px-2" disabled={loadingId === it.id} onClick={() => void toggleHidden(it)}>
                  {it.isActive ? <EyeOff className="size-4" /> : <Eye className="size-4" />} {it.isActive ? 'ซ่อน' : 'แสดง'}
                </button>
                <button type="button" className="btn-ghost ml-auto px-2 text-urgent" onClick={() => setDel(it)}>
                  <Trash2 className="size-4" /> ลบ
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog.Root open={catAction !== null} onOpenChange={(v) => { if (!catBusy && !v) setCatAction(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-surface p-5 shadow-e3 animate-pop-in">
            <Dialog.Title className="text-lg font-bold text-ink">{catAction === 'rename' ? 'เปลี่ยนชื่อหมวด' : 'ลบหมวด'} &ldquo;{cat}&rdquo;</Dialog.Title>
            {catAction === 'rename' ? (
              <>
                <Dialog.Description className="mt-0.5 text-sm text-muted-token">
                  {catCount > 0 ? `วัสดุในหมวดนี้ ${catCount} รายการ (รวมที่ซ่อน) จะเปลี่ยนไปอยู่หมวดชื่อใหม่ทั้งหมด` : 'หมวดนี้ยังไม่มีวัสดุ'}
                </Dialog.Description>
                <input className="input-base mt-3" autoFocus value={renameTo} maxLength={CATALOG_LIMITS.category} aria-label="ชื่อหมวดใหม่"
                  onChange={(e) => setRenameTo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void applyCategory() } }} />
              </>
            ) : (
              <Dialog.Description className="mt-0.5 text-sm text-muted-token">
                {catCount > 0
                  ? `วัสดุในหมวดนี้ ${catCount} รายการ (รวมที่ซ่อน) จะ "ไม่มีหมวด" — วัสดุและแค็ตตาล็อกไม่ถูกลบ หนังสือเก่าไม่เปลี่ยน`
                  : isDefaultCat && !extraCats.includes(cat) ? 'หมวดมาตรฐานลบออกจากรายการไม่ได้' : 'หมวดนี้ยังไม่มีวัสดุ — เอาออกจากรายการ'}
              </Dialog.Description>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close disabled={catBusy} className="btn-secondary">ยกเลิก</Dialog.Close>
              <button type="button" disabled={catBusy} onClick={() => void applyCategory()} className={catAction === 'delete' ? 'btn-primary bg-urgent' : 'btn-primary'}>
                {catBusy && <Loader2 className="size-4 animate-spin" />}
                {catAction === 'rename' ? 'เปลี่ยนชื่อ' : 'ลบหมวด'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={catDialog} onOpenChange={(v) => { setCatDialog(v); if (!v) setNewCat('') }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-surface p-5 shadow-e3 animate-pop-in">
            <Dialog.Title className="text-lg font-bold text-ink">เพิ่มหมวดวัสดุ</Dialog.Title>
            <Dialog.Description className="mt-0.5 text-sm text-muted-token">
              พิมพ์ชื่อหมวดใหม่ เช่น โต๊ะ-เก้าอี้ · หมวดจะอยู่ถาวรเมื่อมีวัสดุอยู่ในหมวดนั้น (กดเพิ่มวัสดุต่อได้เลย)
            </Dialog.Description>
            <input
              className="input-base mt-3"
              autoFocus
              value={newCat}
              maxLength={CATALOG_LIMITS.category}
              placeholder="ชื่อหมวด"
              aria-label="ชื่อหมวด"
              onChange={(e) => setNewCat(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCategory() } }}
            />
            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close className="btn-secondary">ยกเลิก</Dialog.Close>
              <button type="button" className="btn-primary" onClick={addCategory}><FolderPlus className="size-4" /> เพิ่มหมวด</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={open} onOpenChange={(v) => { if (!busy) setOpen(v) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
          <Dialog.Content className={DIALOG}>
            <div className="flex items-start justify-between gap-3 border-b border-line-soft p-4">
              <div className="min-w-0">
                <Dialog.Title className="text-lg font-bold text-ink">{draft.id ? 'แก้ไขวัสดุ' : 'เพิ่มวัสดุเข้าคลัง'}</Dialog.Title>
                <Dialog.Description className="text-sm text-muted-token">
                  ชื่อและรายละเอียดนี้จะเติมลงรายการขออนุมัติให้ · แค็ตตาล็อกเลือกได้ทั้งรูปและไฟล์ PDF
                </Dialog.Description>
              </div>
              <Dialog.Close disabled={busy} className="btn-ghost" aria-label="ปิด"><X className="size-4" /></Dialog.Close>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor="mld-name" className="label-base">ชื่อวัสดุ</label>
                  <input id="mld-name" className="input-base" value={draft.name} maxLength={CATALOG_LIMITS.name}
                    placeholder="เช่น ปูนก่อผนัง / ตู้โหลดเซ็นเตอร์ 50A" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="mld-detail" className="label-base">รายละเอียดที่ขออนุมัติใช้</label>
                  <input id="mld-detail" className="input-base" value={draft.detail} maxLength={CATALOG_LIMITS.detail}
                    placeholder="เช่น ยี่ห้อ CHANG รุ่น MV-18" onChange={(e) => setDraft({ ...draft, detail: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="mld-cat" className="label-base">หมวด</label>
                  <input id="mld-cat" className="input-base" list="mld-cats" value={draft.category} maxLength={CATALOG_LIMITS.category}
                    onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
                  <datalist id="mld-cats">
                    {allCats.map((c) => <option key={c} value={c} />)}
                  </datalist>
                </div>
                <div>
                  <label htmlFor="mld-note" className="label-base">หมายเหตุเริ่มต้น</label>
                  <input id="mld-note" className="input-base" list="mld-notes" value={draft.note} maxLength={CATALOG_LIMITS.note}
                    onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
                  <datalist id="mld-notes">{MA_NOTE_OPTIONS.map((o) => <option key={o} value={o} />)}</datalist>
                </div>
              </div>

              <div>
                <p className="label-base">แค็ตตาล็อก <span className="font-normal text-muted-token tabular-nums">({pages.length}/{CATALOG_LIMITS.pages} หน้า)</span></p>
                <label className={`btn-secondary cursor-pointer ${busy ? 'pointer-events-none opacity-60' : ''}`}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
                  {busy ? progress || 'กำลังทำงาน…' : 'เพิ่มรูป / ไฟล์ PDF'}
                  <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.pdf" multiple className="sr-only"
                    onChange={(e) => { void addFiles(e.target.files); e.target.value = '' }} />
                </label>
                {pages.length > 0 && (
                  <ul className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                    {pages.map((p, i) => (
                      <li key={p.key ?? p.url} className="overflow-hidden rounded-md border border-line bg-surface">
                        {/* eslint-disable-next-line @next/next/no-img-element -- blob/presigned URL */}
                        <img src={p.url} alt="" className="h-28 w-full bg-surface-2 object-contain" />
                        <div className="flex items-center justify-between border-t border-line-soft px-1 py-0.5">
                          <span className="px-1 text-xs tabular-nums text-muted-token">หน้า {i + 1}</span>
                          <span className="flex">
                            <button type="button" className="btn-ghost px-1.5 py-1" aria-label="เลื่อนขึ้น" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-3.5" /></button>
                            <button type="button" className="btn-ghost px-1.5 py-1" aria-label="เลื่อนลง" disabled={i === pages.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-3.5" /></button>
                            <button type="button" className="btn-ghost px-1.5 py-1 text-urgent" aria-label="ลบหน้านี้" onClick={() => removePage(i)}><Trash2 className="size-3.5" /></button>
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {draft.id && <p className="mt-2 text-xs text-muted-token">หน้าที่หนังสือเก่าใช้อยู่ลบไม่ได้ — ถ้าลบแล้วบันทึกไม่ผ่าน ให้เก็บหน้านั้นไว้</p>}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-line-soft p-3">
              <Dialog.Close disabled={busy} className="btn-secondary">ยกเลิก</Dialog.Close>
              <button type="button" className="btn-primary" disabled={busy} onClick={() => void save()}>
                {busy && <Loader2 className="size-4 animate-spin" />} บันทึก
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(del)} onOpenChange={(v) => { if (!busy && !v) setDel(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-surface p-5 shadow-e3 animate-pop-in">
            <Dialog.Title className="text-lg font-bold text-ink">ลบวัสดุนี้?</Dialog.Title>
            <Dialog.Description className="mt-1 break-words text-sm text-muted-token">
              “{del?.name}” พร้อมแค็ตตาล็อก {del?.pages.length ?? 0} หน้า จะถูกลบถาวร · ถ้ามีหนังสือใช้แค็ตตาล็อกนี้อยู่จะลบไม่ได้ ให้กด “ซ่อน” แทน
            </Dialog.Description>
            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close disabled={busy} className="btn-secondary">ยกเลิก</Dialog.Close>
              <button type="button" className="btn-danger" disabled={busy} onClick={() => void doDelete()}>
                {busy && <Loader2 className="size-4 animate-spin" />} ลบ
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
