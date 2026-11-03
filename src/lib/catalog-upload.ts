import { toast } from 'sonner'
import { openPdf, pdfErrorText } from '@/lib/pdf-pages'

/**
 * เตรียม/อัปโหลดไฟล์แค็ตตาล็อกของคลังวัสดุ (R27) — ฝั่งเบราว์เซอร์
 * · รูป → JPEG ไม่เกิน 1600px บีบ ≤ 0.6 MB · PDF → รูปทีละหน้า (pdf.js จาก CDN ตอนกดเท่านั้น — `pdf-pages.ts`)
 * · 🔴 คัดลอกรายชื่อไฟล์ก่อน await เสมอ (FileList เป็นของสด · §17 ข้อ 42) — ผู้เรียกส่ง `File[]` มาแล้ว
 * · อัปตรงเข้า R2 ด้วยลิงก์ที่ `/api/uploads/sign` (purpose `catalog`) — ไบต์ไม่ผ่าน Vercel
 */

/** ไฟล์ที่เลือก → รูปพร้อมอัป (PDF แตกเป็นหน้า) · `room` = ที่ว่างที่เหลือ · เกิน = ข้าม + แจ้ง */
export async function prepareCatalogFiles(files: File[], room: number, onProgress?: (text: string) => void): Promise<File[]> {
  const out: File[] = []
  if (room <= 0) {
    toast.error('แค็ตตาล็อกเต็มแล้ว')
    return out
  }
  const { default: compress } = await import('browser-image-compression')
  for (const f of files) {
    if (out.length >= room) {
      toast.error(`ใส่ได้อีก ${room} หน้า — ไฟล์ที่เกินถูกข้าม`)
      break
    }
    if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
      try {
        const pdf = await openPdf(f)
        try {
          const n = Math.min(pdf.pages, room - out.length)
          for (let i = 1; i <= n; i++) {
            onProgress?.(`กำลังแปลง ${f.name} หน้า ${i}/${pdf.pages}`)
            out.push(await pdf.page(i))
          }
          if (pdf.pages > n) toast.error(`${f.name}: ใส่ได้อีก ${n} หน้า — หน้าที่เกินถูกข้าม`)
        } finally {
          pdf.close()
        }
      } catch (e) {
        toast.error(pdfErrorText(e))
      }
      continue
    }
    if (!f.type.startsWith('image/')) {
      toast.error(`${f.name}: รองรับเฉพาะรูปภาพและ PDF`)
      continue
    }
    try {
      onProgress?.(`กำลังย่อรูป ${f.name}`)
      const o = await compress(f, { maxWidthOrHeight: 1600, maxSizeMB: 0.6, fileType: 'image/jpeg', useWebWorker: true })
      out.push(new File([o], f.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }))
    } catch {
      toast.error(`${f.name}: เปิดไฟล์รูปนี้ไม่ได้`)
    }
  }
  return out
}

/** รูปตราประทับ: คงพื้นโปร่งใส (PNG) ย่อไม่เกิน 600px — ระบบประทับเล็กลงเองตอนแนบ */
export async function prepareStampFile(f: File): Promise<File> {
  if (!f.type.startsWith('image/')) throw new Error('STAMP_TYPE')
  const { default: compress } = await import('browser-image-compression')
  const o = await compress(f, { maxWidthOrHeight: 600, maxSizeMB: 0.4, fileType: 'image/png', useWebWorker: true })
  return new File([o], 'stamp.png', { type: 'image/png' })
}

/** อัปไฟล์หนึ่งไฟล์เข้า R2 → คีย์ `catalog/…` (โยน Error ข้อความไทยถ้าไม่สำเร็จ) */
export async function uploadCatalogFile(file: File): Promise<string> {
  const s = await fetch('/api/uploads/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ purpose: 'catalog', contentType: file.type || 'image/jpeg', byteSize: file.size }),
  })
  const j = (await s.json().catch(() => ({}))) as { key?: string; url?: string; contentType?: string }
  if (!s.ok || !j.key || !j.url) throw new Error('อัปโหลดไม่สำเร็จ ตรวจสัญญาณแล้วลองใหม่')
  const put = await fetch(j.url, { method: 'PUT', headers: { 'content-type': j.contentType ?? 'image/jpeg' }, body: file })
  if (!put.ok) throw new Error('อัปโหลดไม่สำเร็จ ตรวจสัญญาณแล้วลองใหม่')
  return j.key
}
