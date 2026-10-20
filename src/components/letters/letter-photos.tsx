'use client'

import { ArrowUp, ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { LETTER_LIMITS } from '@/lib/letters'

export type LetterPhoto = { file: File; url: string; caption: string }

/**
 * รูปแนบท้ายหนังสือ (ไม่บังคับ · D9) — เช่นเส้นทางเข้า-ออก แบบป้าย ภาพผลงานงวด
 *
 * 🔴 บีบเป็น JPEG 1600px ที่เบราว์เซอร์ก่อน — คำขอสร้างไฟล์ Word ต้องไม่ชนเพดาน body
 * ของ Vercel · รูปไม่ถูกเก็บ (หายเมื่อปิดหน้า) ต้องแนบใหม่ถ้าจะออกไฟล์ซ้ำ
 * · `accept` ไม่ใส่ `image/*` — iOS จะส่ง HEIC ดิบมาแล้วบีบไม่ได้ (§17 ข้อ 12)
 */
export function LetterPhotos({
  photos,
  onChange,
  title,
  onTitle,
  layout,
  onLayout,
}: {
  photos: LetterPhoto[]
  onChange: (next: LetterPhoto[]) => void
  title: string
  onTitle: (v: string) => void
  layout: '1' | '2'
  onLayout: (v: '1' | '2') => void
}) {
  const [busy, setBusy] = useState(false)

  async function add(files: FileList | null) {
    if (!files?.length) return
    const room = LETTER_LIMITS.photos - photos.length
    if (room <= 0) {
      toast.error(`แนบรูปได้ไม่เกิน ${LETTER_LIMITS.photos} รูปต่อฉบับ`)
      return
    }
    setBusy(true)
    try {
      // นำเข้าแบบ dynamic — ไลบรารีบีบรูปหนัก และหนังสือส่วนใหญ่ไม่มีรูป
      const { default: compress } = await import('browser-image-compression')
      const added: LetterPhoto[] = []
      for (const f of Array.from(files).slice(0, room)) {
        if (!f.type.startsWith('image/')) {
          toast.error('รองรับเฉพาะไฟล์รูปภาพ')
          continue
        }
        try {
          const out = await compress(f, { maxWidthOrHeight: 1600, maxSizeMB: 0.6, fileType: 'image/jpeg', useWebWorker: true })
          const file = new File([out], f.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
          added.push({ file, url: URL.createObjectURL(file), caption: '' })
        } catch {
          toast.error('เปิดไฟล์รูปนี้ไม่ได้ ลองเลือกรูปอื่น')
        }
      }
      if (files.length > room) toast.error(`แนบได้อีก ${room} รูป — รูปที่เกินถูกข้าม`)
      onChange([...photos, ...added])
    } finally {
      setBusy(false)
    }
  }

  const remove = (i: number) => {
    URL.revokeObjectURL(photos[i].url)
    onChange(photos.filter((_, j) => j !== i))
  }
  const moveUp = (i: number) => {
    if (i === 0) return
    const next = [...photos]
    ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
    onChange(next)
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
        <div>
          <label htmlFor="lp-title" className="label-base">หัวข้อหน้ารูปแนบ</label>
          <input id="lp-title" value={title} onChange={(e) => onTitle(e.target.value)} placeholder="เช่น เส้นทางสัญจรเข้า-ออกโครงการ" className="input-base" />
        </div>
        <div>
          <label htmlFor="lp-layout" className="label-base">การจัดวาง</label>
          <select id="lp-layout" value={layout} onChange={(e) => onLayout(e.target.value === '2' ? '2' : '1')} className="input-base">
            <option value="1">1 รูปต่อแถว (รูปใหญ่)</option>
            <option value="2">2 รูปต่อแถว (ตาราง)</option>
          </select>
        </div>
      </div>

      <label className={`btn-secondary w-full cursor-pointer sm:w-auto ${busy ? 'pointer-events-none opacity-60' : ''}`}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
        {busy ? 'กำลังย่อรูป…' : 'เลือกรูปภาพ'}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="sr-only"
          onChange={(e) => { void add(e.target.files); e.target.value = '' }}
        />
      </label>

      {photos.length > 0 && (
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {photos.map((p, i) => (
            <li key={p.url} className="overflow-hidden rounded-md border border-line bg-surface">
              {/* eslint-disable-next-line @next/next/no-img-element -- blob URL ของรูปที่เพิ่งเลือก */}
              <img src={p.url} alt="" className="h-24 w-full object-cover" />
              <input
                value={p.caption}
                onChange={(e) => onChange(photos.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)))}
                placeholder="คำอธิบายใต้รูป"
                aria-label={`คำอธิบายใต้รูปที่ ${i + 1}`}
                className="w-full border-t border-line bg-surface px-2 py-1.5 text-sm text-ink focus:outline-none"
              />
              <div className="flex justify-between border-t border-line-soft px-1 py-0.5">
                <button type="button" onClick={() => moveUp(i)} disabled={i === 0} className="btn-ghost px-1.5 py-1 text-xs">
                  <ArrowUp className="size-3.5" /> เลื่อนขึ้น
                </button>
                <button type="button" onClick={() => remove(i)} className="btn-ghost px-1.5 py-1 text-xs text-urgent">
                  <Trash2 className="size-3.5" /> ลบ
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-token">
        รูปจะอยู่ท้ายหนังสือในไฟล์ Word และตอนพิมพ์ · ไม่ถูกเก็บในทะเบียน — เปิดหนังสือเดิมอีกครั้งต้องแนบใหม่
      </p>
    </div>
  )
}
