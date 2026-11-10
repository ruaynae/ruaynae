'use client'

import { ImagePlus, Loader2, Plus, Trash2, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  RM_LIMITS, RM_PHOTO_MAX_CHARS, RM_PHOTO_PX, RM_TOTAL_MAX_CHARS, emptyReturnItem, rmPhotoChars, type ReturnItem, type ReturnMaterials,
} from '@/lib/return-materials'

const readAsDataUrl = (f: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(new Error('read'))
    r.readAsDataURL(f)
  })

/**
 * การ์ด "ตารางวัสดุที่จะส่งคืน" (หนังสือส่งคืนวัสดุจากการรื้อถอน) — รายการ · จำนวน · หน่วย · รูปประกอบ 1–4 รูปต่อรายการ
 * · รูปย่อเป็น JPEG เล็กที่เบราว์เซอร์แล้วเก็บกับหนังสือเลย (ไม่ผ่าน R2) · `accept` ไม่ใส่ `image/*` (§17 ข้อ 12)
 */
export function ReturnMaterialsSection({ value, onChange }: { value: ReturnMaterials; onChange: (s: ReturnMaterials) => void }) {
  const [busy, setBusy] = useState<number | null>(null)
  const target = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  const used = rmPhotoChars(value)

  const patch = (i: number, p: Partial<ReturnItem>) => onChange({ ...value, items: value.items.map((x, k) => (k === i ? { ...x, ...p } : x)) })

  async function addPhotos(i: number, files: File[]) {
    if (!files.length) return
    const cur = value.items[i]?.photos ?? []
    const room = RM_LIMITS.photos - cur.length
    if (room <= 0) return toast.error(`ใส่ได้ไม่เกิน ${RM_LIMITS.photos} รูปต่อรายการ`)
    setBusy(i)
    try {
      const { default: compress } = await import('browser-image-compression')
      const added: string[] = []
      let total = used
      for (const f of files.slice(0, room)) {
        if (!f.type.startsWith('image/')) { toast.error('รองรับเฉพาะไฟล์รูปภาพ'); continue }
        try {
          let url = ''
          for (const mb of [0.035, 0.025, 0.018]) {
            const out = await compress(f, { maxWidthOrHeight: RM_PHOTO_PX, maxSizeMB: mb, fileType: 'image/jpeg', useWebWorker: true })
            url = await readAsDataUrl(out)
            if (url.length <= RM_PHOTO_MAX_CHARS) break
          }
          if (url.length > RM_PHOTO_MAX_CHARS) { toast.error('รูปนี้ใหญ่เกินไป ลองรูปอื่น'); continue }
          if (total + url.length > RM_TOTAL_MAX_CHARS) { toast.error('รูปทั้งหมดในหนังสือนี้ใหญ่รวมกันเกินไป — เอารูปบางรูปออกก่อน'); break }
          total += url.length
          added.push(url)
        } catch {
          toast.error('เปิดไฟล์รูปนี้ไม่ได้ ลองเลือกรูปอื่น')
        }
      }
      if (files.length > room) toast.error(`ใส่ได้อีก ${room} รูป — รูปที่เกินถูกข้าม`)
      if (added.length) patch(i, { photos: [...cur, ...added] })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="card-surface space-y-3.5 p-4">
      <h2 className="text-base font-semibold text-ink">ตารางวัสดุที่จะส่งคืน</h2>
      <p className="text-sm text-muted-token">พิมพ์เป็นตารางต่อท้ายหนังสือ (ลำดับ · รายการ · จำนวน · หน่วย · ภาพประกอบ) · ไฟล์ Word ไม่มีตารางนี้ — ใช้ปุ่มพิมพ์ / PDF</p>
      <button type="button" className="btn-secondary" disabled={value.items.length >= RM_LIMITS.rows} onClick={() => onChange({ ...value, items: [...value.items, emptyReturnItem()] })}>
        <Plus className="size-4" /> เพิ่มรายการ
      </button>

      {value.items.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-3 py-6 text-center text-sm text-muted-token">ยังไม่มีรายการ — กด &ldquo;เพิ่มรายการ&rdquo;</p>
      ) : (
        <ul className="space-y-3">
          {value.items.map((it, i) => (
            <li key={i} className="rounded-md border border-line-soft p-3">
              <div className="flex items-start gap-3">
                <span className="mt-2 w-6 shrink-0 text-center text-sm font-semibold tabular-nums">{i + 1}</span>
                <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[1fr_6rem_7rem]">
                  <label className="block sm:col-span-1"><span className="label-base">รายการ</span>
                    <input className="input-base" value={it.name} maxLength={RM_LIMITS.text} onChange={(e) => patch(i, { name: e.target.value })} placeholder="เช่น เครื่องปรับอากาศแบบแขวน" />
                  </label>
                  <label className="block"><span className="label-base">จำนวน</span>
                    <input inputMode="decimal" className="input-base tabular-nums" value={it.qty} maxLength={30} onChange={(e) => patch(i, { qty: e.target.value })} />
                  </label>
                  <label className="block"><span className="label-base">หน่วย</span>
                    <input className="input-base" value={it.unit} maxLength={RM_LIMITS.unit} onChange={(e) => patch(i, { unit: e.target.value })} placeholder="ชุด / ตัว" />
                  </label>
                  <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
                    {it.photos.map((p, k) => (
                      <span key={k} className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p} alt="" className="size-16 rounded-md border border-line-soft object-cover" />
                        <button type="button" aria-label={`เอารูปที่ ${k + 1} ออก`} onClick={() => patch(i, { photos: it.photos.filter((_, j) => j !== k) })}
                          className="absolute -right-1.5 -top-1.5 rounded-full border border-line bg-surface p-0.5"><X className="size-3.5" /></button>
                      </span>
                    ))}
                    {it.photos.length < RM_LIMITS.photos && (
                      <button type="button" className="btn-secondary" disabled={busy === i} onClick={() => { target.current = i; input.current?.click() }}>
                        {busy === i ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
                        ใส่รูป ({it.photos.length}/{RM_LIMITS.photos})
                      </button>
                    )}
                  </div>
                </div>
                <button type="button" className="btn-ghost" aria-label={`ลบรายการที่ ${i + 1}`} onClick={() => onChange({ ...value, items: value.items.filter((_, k) => k !== i) })}>
                  <Trash2 className="size-4 text-urgent" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {used > 0 && <p className="text-xs text-muted-token">รูปทั้งหมดใช้พื้นที่ {Math.round((used / RM_TOTAL_MAX_CHARS) * 100)}% ของเพดานต่อหนังสือหนึ่งฉบับ</p>}
      <input
        ref={input}
        type="file"
        multiple
        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : [] // อ่านก่อน await (§17 ข้อ 42)
          const i = target.current
          e.target.value = ''
          void addPhotos(i, files)
        }}
      />
    </section>
  )
}
