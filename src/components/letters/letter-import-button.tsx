'use client'

import { Loader2, Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { letterMessage } from '@/lib/letters'

/**
 * นำเข้าไฟล์สำรอง (.json) จากโปรแกรมออกหนังสือแบบไฟล์เดียว — ทางเดียวที่หนังสือเก่า
 * ของห้างเข้าระบบ (D7: ข้อความลูกค้าห้ามอยู่ใน migration ของ repo public)
 * · กดซ้ำได้ ฉบับที่มีอยู่แล้วถูกข้าม (R19-API-08)
 */
export function LetterImportButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function onFile(file: File | undefined) {
    if (!file) return
    setBusy(true)
    try {
      let data: unknown
      try {
        data = JSON.parse(await file.text())
      } catch {
        toast.error(letterMessage('IMPORT_INVALID'))
        return
      }
      const r = await fetch('/api/letters/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(letterMessage(j.error))
        return
      }
      const parts = [
        `นำเข้า ${j.imported} ฉบับ`,
        j.seriesCreated ? `สร้างชุดเลขใหม่ ${j.seriesCreated} ชุด` : '',
        j.duplicates ? `ข้ามฉบับที่มีอยู่แล้ว ${j.duplicates}` : '',
        j.skipped ? `ข้อมูลไม่ครบ ${j.skipped}` : '',
      ].filter(Boolean)
      toast.success(parts.join(' · '))
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(false)
    }
  }

  return (
    <label className={`btn-secondary cursor-pointer ${busy ? 'pointer-events-none opacity-60' : ''}`}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
      นำเข้าไฟล์สำรอง
      <input
        type="file"
        accept=".json,application/json"
        className="sr-only"
        onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = '' }}
      />
    </label>
  )
}
