'use client'

import { Download, Loader2, Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { buildPdf } from '@/lib/pdf-build'
import { useIsClient } from '@/lib/use-is-client'
import type { SellerSnapshot } from '@/lib/doc-server'
import { canvasToJpeg, drawDocPages } from './doc-canvas'
import type { PaperDoc, PaperLine } from './doc-paper'

/**
 * ปุ่ม "แชร์" (มือถือ → เมนูแชร์ → LINE) และ "บันทึกเป็น PDF" (คอม → ดาวน์โหลดไฟล์)
 *
 * 🔴 สร้างไฟล์ PDF ล่วงหน้าตั้งแต่เปิดหน้า แล้วปุ่มแค่ส่งไฟล์ที่พร้อมแล้ว — iOS ยอมให้เรียก
 * `navigator.share` เฉพาะในจังหวะที่ผู้ใช้เพิ่งแตะ ถ้า `await` วาดรูปก่อนแล้วค่อยแชร์ เมนูแชร์จะไม่ขึ้น
 * 🔴 ร่าง (ยังไม่มีเลขที่) ไม่ให้แชร์/บันทึก — ยังไม่มีข้อมูลผู้ขายและเลขที่เอกสาร
 */
export function DocPdfButtons({
  doc,
  lines,
  seller,
  fileName,
}: {
  doc: PaperDoc
  lines: PaperLine[]
  seller: SellerSnapshot | null
  fileName: string
}) {
  const isClient = useIsClient()
  const [file, setFile] = useState<File | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!seller) return
    let cancelled = false
    ;(async () => {
      try {
        const canvases = await drawDocPages(doc, lines, seller)
        const pages = []
        for (const c of canvases) pages.push({ jpeg: await canvasToJpeg(c), width: c.width, height: c.height })
        const bytes = buildPdf(pages, 595.28, 841.89, fileName)
        if (!cancelled) setFile(new File([bytes as BlobPart], `${fileName}.pdf`, { type: 'application/pdf' }))
      } catch (e) {
        console.error('[documents] สร้าง PDF ไม่สำเร็จ', e)
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [doc, lines, seller, fileName])

  if (!seller) return null

  const canShare = isClient && file !== null && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
  const busy = !file && !failed

  const share = async () => {
    if (!file) return
    try {
      await navigator.share({ files: [file], title: fileName })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast.error('แชร์ไม่สำเร็จ ลองกด "บันทึกเป็น PDF" แทน')
    }
  }

  const save = () => {
    if (!file) return
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  return (
    <>
      {canShare && (
        <button type="button" onClick={share} className="btn-secondary">
          <Share2 className="size-4" />
          แชร์
        </button>
      )}
      <button
        type="button"
        onClick={save}
        disabled={!file}
        title={failed ? 'สร้างไฟล์ PDF ไม่สำเร็จ — ใช้ปุ่มพิมพ์แล้วเลือกบันทึกเป็น PDF' : undefined}
        className="btn-secondary"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        บันทึกเป็น PDF
      </button>
    </>
  )
}

