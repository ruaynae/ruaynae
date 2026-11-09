'use client'

import { Download, Loader2, Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { buildPdf } from '@/lib/pdf-build'
import { useIsClient } from '@/lib/use-is-client'
import type { StatementData } from '@/lib/site-statement'
import { canvasToJpeg, drawStatementPages } from './finance-canvas'

/**
 * ปุ่ม "แชร์เข้า LINE" (มือถือ → เมนูแชร์) และ "ดาวน์โหลด PDF" (คอม) ของรายงานรายรับ-รายจ่ายรายโครงการ
 * 🔴 สร้างไฟล์ล่วงหน้าตั้งแต่เปิดหน้า แล้วปุ่มแค่ส่งไฟล์ที่พร้อมแล้ว — iOS ให้เรียก `navigator.share` เฉพาะในจังหวะที่เพิ่งแตะ
 *    (วิธีเดียวกับใบเสร็จ · `documents/doc-pdf-buttons.tsx`)
 */
export function StatementActions({ data, fileName }: { data: StatementData; fileName: string }) {
  const isClient = useIsClient()
  const [file, setFile] = useState<File | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const canvases = await drawStatementPages(data)
        const pages = []
        for (const c of canvases) pages.push({ jpeg: await canvasToJpeg(c), width: c.width, height: c.height })
        const bytes = buildPdf(pages, 595.28, 841.89, fileName)
        if (!cancelled) setFile(new File([bytes as BlobPart], `${fileName}.pdf`, { type: 'application/pdf' }))
      } catch (e) {
        console.error('[sites] สร้างรายงาน PDF ไม่สำเร็จ', e)
        if (!cancelled) setFailed(true)
      }
    })()
    return () => { cancelled = true }
  }, [data, fileName])

  const canShare = isClient && file !== null && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
  const busy = !file && !failed

  const share = async () => {
    if (!file) return
    try {
      await navigator.share({ files: [file], title: fileName })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast.error('แชร์ไม่สำเร็จ ลองกด "ดาวน์โหลด PDF" แทน')
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
    <div className="flex flex-wrap gap-2">
      {canShare && (
        <button type="button" onClick={share} className="btn-primary">
          <Share2 className="size-4" /> แชร์เข้า LINE
        </button>
      )}
      <button type="button" onClick={save} disabled={!file} className={canShare ? 'btn-secondary' : 'btn-primary'}
        title={failed ? 'สร้างไฟล์ PDF ไม่สำเร็จ ลองรีเฟรชหน้านี้' : undefined}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        ดาวน์โหลด PDF
      </button>
      {failed && <p className="w-full text-sm text-urgent">สร้างไฟล์ PDF ไม่สำเร็จ ลองรีเฟรชหน้านี้อีกครั้ง</p>}
    </div>
  )
}
