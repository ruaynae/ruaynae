'use client'

import { FileSearch, ImagePlus, Loader2, Plus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { EQ_LIMITS, EQ_PHOTO_MAX_CHARS, EQ_PHOTO_PX, emptyEquipItem, type EquipItem, type EquipSummary } from '@/lib/equipment-summary'
import { BoqNamePicker } from '@/components/letters/boq-name-picker'

const readAsDataUrl = (f: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(new Error('read'))
    r.readAsDataURL(f)
  })

/**
 * การ์ด "สรุปรายการครุภัณฑ์" (R34) — รายการจาก BOQ หรือพิมพ์เอง · กรอกยี่ห้อ/ผู้ขาย/ประกัน · ใส่รูปต่อรายการ
 * · รูปย่อเป็น JPEG เล็กที่เบราว์เซอร์แล้วเก็บกับหนังสือเลย (ไม่ผ่าน R2) · `accept` ไม่ใส่ `image/*` (§17 ข้อ 12)
 */
export function EquipmentSummarySection({
  value, onChange, siteId,
}: {
  value: EquipSummary
  onChange: (s: EquipSummary) => void
  siteId: string | null
}) {
  const [pick, setPick] = useState(false)
  const [busy, setBusy] = useState<number | null>(null)
  const fileFor = useRef(0)
  const input = useRef<HTMLInputElement>(null)

  const patch = (i: number, p: Partial<EquipItem>) => onChange({ ...value, items: value.items.map((x, k) => (k === i ? { ...x, ...p } : x)) })

  async function setPhoto(i: number, f: File | undefined) {
    if (!f) return
    if (!f.type.startsWith('image/')) return toast.error('รองรับเฉพาะไฟล์รูปภาพ')
    setBusy(i)
    try {
      const { default: compress } = await import('browser-image-compression')
      let url = ''
      for (const kb of [0.06, 0.04, 0.025]) {
        const out = await compress(f, { maxWidthOrHeight: EQ_PHOTO_PX, maxSizeMB: kb, fileType: 'image/jpeg', useWebWorker: true })
        url = await readAsDataUrl(out)
        if (url.length <= EQ_PHOTO_MAX_CHARS) break
      }
      if (url.length > EQ_PHOTO_MAX_CHARS) return toast.error('รูปนี้ใหญ่เกินไป ลองรูปอื่น')
      patch(i, { photo: url })
    } catch {
      toast.error('เปิดไฟล์รูปนี้ไม่ได้ ลองเลือกรูปอื่น')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="card-surface space-y-3.5 p-4">
      <h2 className="text-base font-semibold text-ink">สรุปรายการครุภัณฑ์ที่ใช้ในโครงการ</h2>
      <p className="text-sm text-muted-token">พิมพ์เป็น &ldquo;แบบฟอร์มบันทึกข้อมูลครุภัณฑ์&rdquo; ต่อท้ายหนังสือ · ไฟล์ Word ไม่มีตารางนี้ — ใช้ปุ่มพิมพ์ / PDF</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={() => setPick(true)}><FileSearch className="size-4" /> เลือกจาก BOQ</button>
        <button type="button" className="btn-secondary" disabled={value.items.length >= EQ_LIMITS.rows} onClick={() => onChange({ ...value, items: [...value.items, emptyEquipItem()] })}>
          <Plus className="size-4" /> เพิ่มรายการเอง
        </button>
      </div>

      {value.items.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-3 py-6 text-center text-sm text-muted-token">ยังไม่มีรายการ — เลือกจาก BOQ หรือเพิ่มเอง</p>
      ) : (
        <ul className="space-y-3">
          {value.items.map((it, i) => (
            <li key={i} className="rounded-md border border-line-soft p-3">
              <div className="flex items-start gap-3">
                <span className="mt-2 w-6 shrink-0 text-center text-sm font-semibold tabular-nums">{i + 1}</span>
                <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                  <label className="block sm:col-span-2"><span className="label-base">ชื่อครุภัณฑ์</span>
                    <input className="input-base" value={it.name} maxLength={EQ_LIMITS.text} onChange={(e) => patch(i, { name: e.target.value })} />
                  </label>
                  <label className="block"><span className="label-base">ยี่ห้อ / รุ่น</span>
                    <input className="input-base" value={it.brand} maxLength={EQ_LIMITS.text} onChange={(e) => patch(i, { brand: e.target.value })} placeholder="เช่น MIKAEL รุ่น PB-341N" />
                  </label>
                  <label className="block"><span className="label-base">ผู้ขาย</span>
                    <input className="input-base" value={it.seller} maxLength={EQ_LIMITS.text} onChange={(e) => patch(i, { seller: e.target.value })} />
                  </label>
                  <label className="block"><span className="label-base">ระยะเวลารับประกัน</span>
                    <input className="input-base" value={it.warranty} maxLength={EQ_LIMITS.text} onChange={(e) => patch(i, { warranty: e.target.value })} placeholder="เช่น 1 ปี" />
                  </label>
                  <div className="flex items-end gap-2">
                    {it.photo && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.photo} alt="" className="h-16 w-16 rounded-md border border-line-soft object-cover" />
                    )}
                    <button type="button" className="btn-secondary" disabled={busy === i} onClick={() => { fileFor.current = i; input.current?.click() }}>
                      {busy === i ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
                      {it.photo ? 'เปลี่ยนรูป' : 'ใส่รูป'}
                    </button>
                    {it.photo && <button type="button" className="btn-ghost" onClick={() => patch(i, { photo: '' })}>เอารูปออก</button>}
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
      <input
        ref={input}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] // อ่านก่อน await (§17 ข้อ 42)
          const i = fileFor.current
          e.target.value = ''
          void setPhoto(i, f)
        }}
      />
      <BoqNamePicker
        open={pick}
        onOpenChange={setPick}
        siteId={siteId}
        title="เลือกครุภัณฑ์จาก BOQ"
        confirmLabel="เพิ่มเข้าสรุปรายการครุภัณฑ์"
        onPick={(rows) => {
          const have = new Set(value.items.map((x) => x.name.trim()))
          const add = rows.map((r) => r.name.replace(/\s+/g, ' ').trim()).filter((n) => n && !have.has(n))
          const room = EQ_LIMITS.rows - value.items.length
          onChange({ ...value, items: [...value.items, ...add.slice(0, room).map((n) => emptyEquipItem(n))] })
          toast.success(add.length ? `เพิ่ม ${Math.min(add.length, room)} รายการ` : 'รายการที่เลือกมีอยู่แล้ว')
        }}
      />
    </section>
  )
}
