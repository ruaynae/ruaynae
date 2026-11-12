'use client'

import { openPdf } from '@/lib/pdf-pages'

/**
 * R41 · เตรียมไฟล์บิลที่เบราว์เซอร์ → อัปตรงเข้า R2 → ลงทะเบียน → ให้ AI อ่านทีละใบ
 * · PDF ที่สแกนทีละปึก = 1 หน้า 1 บิล (แยกเป็นรูปทีละหน้า) · รูปถูกย่อเป็น JPEG 1600px
 * · อ่านด้วย AI ทีละใบเรียงกัน (โควตาแบบฟรีจำกัดต่อนาที) · โควตาหมด/ไม่มีคีย์ = หยุด บิลที่เหลือค้าง "รออ่าน" กดอ่านต่อได้
 */

export type Prepared = { file: File; fileName: string; pageNo: number | null }

/** File[] (รูป/PDF) → รูป JPEG พร้อมอัป · `onProgress` = ข้อความความคืบหน้าบนจอ */
export async function prepareBillFiles(files: File[], onProgress: (s: string) => void): Promise<{ ready: Prepared[]; skipped: string[] }> {
  const ready: Prepared[] = []
  const skipped: string[] = []
  const { default: compress } = await import('browser-image-compression')
  for (const f of files) {
    if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
      const pdf = await openPdf(f)
      try {
        for (let i = 1; i <= pdf.pages; i += 1) {
          onProgress(`แปลง ${f.name} หน้า ${i}/${pdf.pages}`)
          ready.push({ file: await pdf.page(i), fileName: f.name, pageNo: pdf.pages > 1 ? i : null })
        }
      } finally {
        pdf.close()
      }
      continue
    }
    if (!f.type.startsWith('image/')) {
      skipped.push(f.name)
      continue
    }
    try {
      onProgress(`ย่อรูป ${f.name}`)
      const out = await compress(f, { maxWidthOrHeight: 1600, maxSizeMB: 0.6, fileType: 'image/jpeg', useWebWorker: true })
      ready.push({ file: new File([out], f.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }), fileName: f.name, pageNo: null })
    } catch {
      skipped.push(f.name)
    }
  }
  return { ready, skipped }
}

class Fail extends Error {
  constructor(public code: string) {
    super(code)
    this.name = 'BillFail'
  }
}
export const failCode = (e: unknown) => (e instanceof Fail ? e.code : 'SAVE_FAILED')

/** อัปขึ้น R2 ทีละไฟล์ แล้วลงทะเบียนเป็นก้อนละ 50 → id ของบิลตามลำดับ */
export async function uploadBills(items: Prepared[], onProgress: (s: string) => void): Promise<string[]> {
  const registered: string[] = []
  for (let at = 0; at < items.length; at += 50) {
    const batch = items.slice(at, at + 50)
    const files: { key: string; contentType: string; fileName: string; pageNo: number | null }[] = []
    for (const [k, it] of batch.entries()) {
      onProgress(`อัปโหลด ${at + k + 1}/${items.length}`)
      const s = await fetch('/api/uploads/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose: 'bill', contentType: it.file.type, byteSize: it.file.size }),
      })
      const j = (await s.json().catch(() => ({}))) as { key?: string; url?: string; contentType?: string; error?: string }
      if (!s.ok || !j.key || !j.url) throw new Fail(j.error ?? 'SAVE_FAILED')
      const put = await fetch(j.url, { method: 'PUT', headers: { 'content-type': j.contentType ?? it.file.type }, body: it.file })
      if (!put.ok) throw new Fail('FILE_NOT_UPLOADED')
      files.push({ key: j.key, contentType: j.contentType ?? it.file.type, fileName: it.fileName, pageNo: it.pageNo })
    }
    const r = await fetch('/api/bills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files }) })
    const j = (await r.json().catch(() => ({}))) as { ids?: (string | null)[]; error?: string }
    if (!r.ok || !j.ids) throw new Fail(j.error ?? 'SAVE_FAILED')
    registered.push(...j.ids.filter((x): x is string => Boolean(x)))
  }
  return registered
}

export type ReadOutcome = { read: number; matched: number; failed: number; stoppedBy: string | null }

/** ให้ AI อ่านทีละใบ · หยุดเมื่อโควตาหมด/ไม่มีคีย์ (บิลที่เหลือยังเป็น "รออ่าน") */
export async function readBills(ids: string[], onProgress: (s: string) => void): Promise<ReadOutcome> {
  const out: ReadOutcome = { read: 0, matched: 0, failed: 0, stoppedBy: null }
  for (const [i, id] of ids.entries()) {
    onProgress(`AI อ่านบิล ${i + 1}/${ids.length}`)
    const r = await fetch(`/api/bills/${id}/read`, { method: 'POST' })
    const j = (await r.json().catch(() => ({}))) as { status?: string; matched?: string | null; error?: string }
    if (r.status === 409 || r.status === 429) {
      out.stoppedBy = j.error ?? 'BILL_AI_FAILED'
      break
    }
    if (!r.ok) { out.failed += 1; continue }
    if (j.status === 'failed') out.failed += 1
    else out.read += 1
    if (j.matched) out.matched += 1
    // เว้นจังหวะเล็กน้อย — แบบฟรีจำกัดจำนวนครั้งต่อนาที
    if (i < ids.length - 1) await new Promise((res) => setTimeout(res, 1200))
  }
  return out
}
