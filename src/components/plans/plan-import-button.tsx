'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileUp, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { planMessage } from '@/lib/boq/plan-store'

/**
 * นำเข้าแผนงานจากไฟล์ .json (R31b) — ไฟล์ที่เตรียมไว้ให้ครบ (หมวด/งาน/รายการ/วัน + ผลงาน) แล้วบันทึกเป็นแผนใหม่ในเว็บ
 * · รูปไฟล์ `{ ruaynaePlan: 1, plan, progress? }` · ตัวตรวจเต็มอยู่ที่เซิร์ฟเวอร์ (`POST /api/plans`) · ไม่ลบ/ไม่ทับแผนเดิม
 */
export function PlanImportButton() {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function onFile(file: File | undefined) {
    if (!file) return
    setBusy(true)
    try {
      let data: { ruaynaePlan?: number; plan?: unknown; progress?: unknown }
      try {
        data = JSON.parse(await file.text())
      } catch {
        return void toast.error('อ่านไฟล์ไม่ได้ — ต้องเป็นไฟล์แผนงาน .json')
      }
      if (data.ruaynaePlan !== 1 || !data.plan) return void toast.error('ไม่ใช่ไฟล์แผนงานของระบบนี้')
      const res = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan: data.plan, progress: data.progress }),
      })
      const j = (await res.json().catch(() => ({}))) as { id?: string; error?: string }
      if (!res.ok || !j.id) return void toast.error(planMessage(j.error ?? ''))
      toast.success('นำเข้าแผนงานแล้ว — ผูกกับโครงการได้ที่หน้านี้')
      router.push(`/plans/${j.id}`)
      router.refresh()
    } catch {
      toast.error('นำเข้าไม่สำเร็จ ตรวจการเชื่อมต่อแล้วลองใหม่')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input ref={input} type="file" accept=".json,application/json" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
      <button type="button" className="btn-secondary" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
        นำเข้าแผนงานจากไฟล์ (.json)
      </button>
    </div>
  )
}
