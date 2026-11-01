'use client'

import { ExternalLink, FileText, Loader2, Paperclip, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { FILE_MAX_BYTES, extOf, fileMessage, titleFromFileName } from '@/lib/files'
import { LETTER_PDF_MAX, pdfSizeText, type LetterPdf } from '@/lib/letter-pdfs'

async function jsonOrNull(r: Response): Promise<Record<string, string>> {
  try { return (await r.json()) as Record<string, string> } catch { return {} }
}

/**
 * การ์ด "เอกสารแนบ (PDF)" ของหนังสือ — เช่น เอกสารที่เคยเสนองานเพิ่มไปแล้ว
 * · อัปโหลด = ขอลิงก์ (`/api/files/sign`) → PUT ตรงเข้า R2 → บันทึกเข้าคลังเอกสาร (`/api/files`) แล้วผูกกับหนังสือ
 * · รายการอยู่ในหนังสือ (`fields.pdfs`) ต้องกดบันทึกหนังสือด้วย · ลบออกจากหนังสือ = ไฟล์ยังอยู่ในคลังเอกสาร
 * · ไฟล์ PDF ไม่ถูกพิมพ์ต่อท้ายหนังสือ — เปิด/พิมพ์แยกจากปุ่ม "เปิด"
 */
export function LetterPdfSection({
  value, onChange, siteId, subject,
}: {
  value: LetterPdf[]
  onChange: (v: LetterPdf[]) => void
  siteId: string | null
  subject: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function upload(files: File[]) {
    // อ่านรายการไฟล์ก่อน await ใด ๆ — ล้างช่องแล้ว FileList ว่างตาม (§17 ข้อ 42)
    const room = LETTER_PDF_MAX - value.length
    if (room <= 0) return toast.error(`แนบได้สูงสุด ${LETTER_PDF_MAX} ไฟล์`)
    setBusy(true)
    const added: LetterPdf[] = []
    for (const f of files.slice(0, room)) {
      if (extOf(f.name) !== 'pdf') { toast.error(`${f.name}: แนบได้เฉพาะไฟล์ PDF`); continue }
      if (f.size === 0) { toast.error(`${f.name}: ${fileMessage('FILE_EMPTY')}`); continue }
      if (f.size > FILE_MAX_BYTES) { toast.error(`${f.name}: ${fileMessage('FILE_TOO_LARGE')}`); continue }
      try {
        const sign = await fetch('/api/files/sign', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ fileName: f.name, byteSize: f.size }),
        })
        const s = await jsonOrNull(sign)
        if (!sign.ok || !s.url || !s.key || !s.contentType) throw new Error(s.error ?? 'SIGN_FAILED')
        const put = await fetch(s.url, { method: 'PUT', headers: { 'content-type': s.contentType }, body: f })
        if (!put.ok) throw new Error('PUT_FAILED')
        const save = await fetch('/api/files', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            objectKey: s.key, fileName: f.name, category: 'other', siteId,
            title: titleFromFileName(f.name), note: subject ? `แนบหนังสือ: ${subject}`.slice(0, 2000) : 'แนบหนังสือ',
          }),
        })
        const r = await jsonOrNull(save)
        if (!save.ok || !r.id) throw new Error(r.error ?? 'SAVE_FAILED')
        added.push({ id: r.id, name: f.name, size: f.size })
      } catch (e) {
        const code = e instanceof Error ? e.message : ''
        toast.error(`${f.name}: ${code === 'PUT_FAILED' ? 'ส่งไฟล์ไม่สำเร็จ ตรวจสัญญาณแล้วลองใหม่' : fileMessage(code)}`)
      }
    }
    setBusy(false)
    if (added.length) {
      onChange([...value, ...added])
      toast.success(`แนบแล้ว ${added.length} ไฟล์ — กดบันทึกหนังสือด้วยนะครับ`)
    }
  }

  return (
    <section className="card-surface p-4">
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-ink">
        <Paperclip className="size-5 text-brand" /> เอกสารแนบ (PDF)
      </h2>
      <p className="mb-3 text-sm text-muted-token">
        แนบไฟล์ PDF เช่น เอกสารที่เคยเสนองานเพิ่มไปแล้ว · เก็บในคลังเอกสารด้วย · ไม่พิมพ์ต่อท้ายหนังสืออัตโนมัติ เปิดพิมพ์แยกจากปุ่ม &ldquo;เปิด&rdquo;
      </p>

      {value.length > 0 && (
        <ul className="mb-3 divide-y divide-line-soft rounded-md border border-line-soft">
          {value.map((p) => (
            <li key={p.id} className="flex items-center gap-2 px-3 py-2">
              <FileText className="size-4 shrink-0 text-muted-token" />
              <span className="min-w-0 flex-1 truncate text-sm text-ink" title={p.name}>{p.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-token">{pdfSizeText(p.size)}</span>
              <a href={`/api/files/${p.id}`} target="_blank" rel="noreferrer" className="btn-ghost shrink-0" aria-label={`เปิด ${p.name}`}>
                <ExternalLink className="size-4" /> เปิด
              </a>
              <button type="button" className="btn-ghost shrink-0 text-urgent" aria-label={`เอา ${p.name} ออกจากหนังสือ`} onClick={() => onChange(value.filter((x) => x.id !== p.id))}>
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={input}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        className="sr-only"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (files.length) void upload(files)
        }}
      />
      <button type="button" className="btn-secondary" disabled={busy || value.length >= LETTER_PDF_MAX} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
        {busy ? 'กำลังอัปโหลด…' : 'แนบไฟล์ PDF'}
      </button>
    </section>
  )
}
