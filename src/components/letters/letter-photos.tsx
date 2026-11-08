'use client'

import { ArrowUp, FileText, ImagePlus, Loader2, Stamp, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { LETTER_LIMITS, photoLayoutOf, type PhotoLayout } from '@/lib/letters'
import { openPdf, pdfErrorText } from '@/lib/pdf-pages'

/** `file` = เพิ่งเลือก (ยังไม่อัป) · `key` = อยู่ใน R2 แล้ว (เก็บกับหนังสือ) · `url` = blob หรือลิงก์ presigned */
export type LetterPhoto = { file?: File; key?: string; url: string; caption: string; /** หัวข้อบนหน้านี้ (เฉพาะแบบ 1 รูปต่อ 1 หน้า) */ heading?: string; /** ประทับตราบริษัทมุมขวาล่าง (R27) */ stamped?: boolean; /** หน้าเอกสาร (จาก PDF) — แสดงเต็มหน้ากระดาษ 1 หน้าต่อ 1 แผ่น ไม่ปนในตารางรูป */ asPage?: boolean }

/**
 * รูปแนบท้ายหนังสือ (ไม่บังคับ · D9) — เช่นเส้นทางเข้า-ออก แบบป้าย ภาพผลงานงวด
 *
 * 🔴 บีบเป็น JPEG 1600px ที่เบราว์เซอร์ก่อน · ตอนบันทึกหนังสือ รูปถูกอัปเข้า R2 แล้วเก็บกับหนังสือ
 *    (`letter_photos` · 23 ต.ค. 2569) — เปิดหนังสือเดิมอีกครั้งรูปยังอยู่
 * · `accept` ไม่ใส่ `image/*` — iOS จะส่ง HEIC ดิบมาแล้วบีบไม่ได้ (§17 ข้อ 12)
 */
export function LetterPhotos({
  photos,
  onChange,
  title,
  onTitle,
  layout,
  onLayout,
  stampUrl = null,
}: {
  photos: LetterPhoto[]
  onChange: (next: LetterPhoto[]) => void
  title: string
  onTitle: (v: string) => void
  layout: PhotoLayout
  onLayout: (v: PhotoLayout) => void
  /** มีรูปตราประทับในคลังวัสดุ — ถึงจะโชว์ช่องติ๊ก "ประทับตรา" (R27) */
  stampUrl?: string | null
}) {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')

  async function add(input: FileList | null) {
    // 🔴 คัดลอกรายชื่อไฟล์ก่อน await — ช่องเลือกไฟล์ถูกล้าง (`value = ''`) ทันทีหลังเรียกฟังก์ชันนี้
    //    และ FileList เป็นของสด: รออะไรสักอย่างแล้วค่อยอ่าน = รายการว่าง → เลือกรูปแล้ว "ไม่ขึ้น" (เจ้าของแจ้ง 23 ต.ค. 2569)
    const files = input ? Array.from(input) : []
    if (!files.length) return
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
      for (const f of files.slice(0, room)) {
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

  /** PDF → รูปทีละหน้า แล้วต่อท้ายรูปเดิม (พิมพ์/Word/เก็บกับหนังสือเหมือนรูปปกติ) */
  async function addPdf(input: FileList | null) {
    const files = input ? Array.from(input) : [] // คัดลอกก่อน await (§17 ข้อ 42)
    if (!files.length) return
    let room = LETTER_LIMITS.photos - photos.length
    if (room <= 0) {
      toast.error(`แนบได้ไม่เกิน ${LETTER_LIMITS.photos} หน้า/รูปต่อฉบับ`)
      return
    }
    setBusy(true)
    const added: LetterPhoto[] = []
    try {
      for (const f of files) {
        if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') {
          toast.error('ช่องนี้รับเฉพาะไฟล์ PDF')
          continue
        }
        const pdf = await openPdf(f)
        try {
          const n = Math.min(pdf.pages, room)
          for (let i = 1; i <= n; i++) {
            setProgress(`กำลังแปลงหน้า ${i}/${pdf.pages}`)
            const file = await pdf.page(i)
            added.push({ file, url: URL.createObjectURL(file), caption: '', asPage: true })
          }
          room -= n
          if (pdf.pages > n) toast.error(`แนบได้ ${LETTER_LIMITS.photos} หน้า/รูปต่อฉบับ — หน้าที่เกินถูกข้าม`)
        } finally {
          pdf.close()
        }
        if (room <= 0) break
      }
    } catch (e) {
      toast.error(pdfErrorText(e))
    } finally {
      if (added.length) onChange([...photos, ...added])
      setProgress('')
      setBusy(false)
    }
  }

  const remove = (i: number) => {
    if (photos[i].url.startsWith('blob:')) URL.revokeObjectURL(photos[i].url)
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
          <label htmlFor="lp-title" className="label-base">หัวข้อหน้ารูปแนบ (หัวข้อรวม · ขึ้นหน้าแรก)</label>
          <input id="lp-title" value={title} onChange={(e) => onTitle(e.target.value)} placeholder="เช่น เส้นทางสัญจรเข้า-ออกโครงการ" className="input-base" />
        </div>
        <div>
          <label htmlFor="lp-layout" className="label-base">การจัดวาง</label>
          <select id="lp-layout" value={layout} onChange={(e) => onLayout(photoLayoutOf(e.target.value))} className="input-base">
            <option value="1">1 รูปต่อแถว (รูปใหญ่)</option>
            <option value="2">2 รูปต่อแถว (ตาราง)</option>
            <option value="6">6 รูปต่อหน้า (2 คอลัมน์ × 3 แถว)</option>
            <option value="p">1 รูปต่อ 1 หน้า (แค็ตตาล็อกเต็มหน้า)</option>
          </select>
        </div>
      </div>

      <label className={`btn-secondary w-full cursor-pointer sm:w-auto ${busy ? 'pointer-events-none opacity-60' : ''}`}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
        {busy ? progress || 'กำลังย่อรูป…' : 'เลือกรูปภาพ'}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="sr-only"
          onChange={(e) => { void add(e.target.files); e.target.value = '' }}
        />
      </label>
      <label className={`btn-secondary ml-0 w-full cursor-pointer sm:ml-2 sm:w-auto ${busy ? 'pointer-events-none opacity-60' : ''}`}>
        <FileText className="size-4" />
        แนบไฟล์ PDF
        <input
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="sr-only"
          onChange={(e) => { void addPdf(e.target.files); e.target.value = '' }}
        />
      </label>

      {stampUrl && photos.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-secondary" onClick={() => onChange(photos.map((p) => ({ ...p, stamped: true })))}>
            <Stamp className="size-4" /> ประทับตราทุกหน้า
          </button>
          {photos.some((p) => p.stamped) && (
            <button type="button" className="btn-ghost" onClick={() => onChange(photos.map((p) => ({ ...p, stamped: false })))}>
              เอาตราออกทั้งหมด
            </button>
          )}
        </div>
      )}

      {photos.length > 0 && (
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {photos.map((p, i) => (
            <li key={p.key ?? p.url} className="overflow-hidden rounded-md border border-line bg-surface">
              {/* eslint-disable-next-line @next/next/no-img-element -- blob URL ของรูปที่เพิ่งเลือก */}
              <img src={p.url} alt="" className="h-24 w-full object-cover" />
              {stampUrl && (
                <label className="flex items-center gap-1.5 border-t border-line-soft px-2 py-1 text-xs text-ink-2">
                  <input
                    type="checkbox"
                    checked={p.stamped === true}
                    onChange={(e) => onChange(photos.map((x, j) => (j === i ? { ...x, stamped: e.target.checked } : x)))}
                  />
                  ประทับตราหน้านี้
                </label>
              )}
              {layout !== 'p' && (
                <label className="flex items-center gap-1.5 border-t border-line-soft px-2 py-1 text-xs text-ink-2">
                  <input
                    type="checkbox"
                    checked={p.asPage === true}
                    onChange={(e) => onChange(photos.map((x, j) => (j === i ? { ...x, asPage: e.target.checked } : x)))}
                  />
                  หน้าเอกสาร (เต็มหน้า)
                </label>
              )}
              {layout === 'p' && (
                <input
                  value={p.heading ?? ''}
                  onChange={(e) => onChange(photos.map((x, j) => (j === i ? { ...x, heading: e.target.value } : x)))}
                  placeholder={i === 0 && title.trim() ? 'หัวข้อหน้านี้ (ว่าง = ใช้หัวข้อรวม)' : 'หัวข้อหน้านี้ เช่น ลามิเนต Formica D8202'}
                  aria-label={`หัวข้อบนหน้าที่ ${i + 1}`}
                  className="w-full border-t border-line bg-surface px-2 py-1.5 text-sm font-semibold text-ink focus:outline-none"
                />
              )}
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
      {layout === 'p' && photos.length > 0 && (
        <p className="text-xs text-muted-token">แบบ 1 รูปต่อ 1 หน้า: ช่องหัวข้อหน้านี้ใต้แต่ละรูปคือหัวข้อของหน้านั้น · เว้นว่างไว้ = หน้าแรกใช้หัวข้อรวม หน้าอื่นไม่มีหัวข้อ</p>
      )}
      <p className="text-xs text-muted-token">
        รูปและหน้า PDF จะอยู่ท้ายหนังสือ (PDF แปลงเป็นรูปทีละหน้า · แต่ละหน้า PDF ขึ้นเต็มกระดาษ 1 แผ่น ส่วนรูปถ่ายจัดตามการจัดวางที่เลือก) ในไฟล์ Word และตอนพิมพ์ · เก็บไว้กับหนังสือในทะเบียนเมื่อกดบันทึก/ดาวน์โหลด/พิมพ์
      </p>
    </div>
  )
}
