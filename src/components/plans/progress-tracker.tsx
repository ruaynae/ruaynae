'use client'

import { useState } from 'react'
import { FileCheck2, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import type { ProgressReport } from '@/lib/boq/progress-core'
import { ProgressReportView } from './progress-report'

/**
 * ติดตามผลงาน — อัปโหลดไฟล์แผนงาน (ที่ดาวน์โหลดจากแท็บแรก) หลังกรอกผลงานรายงวดแล้ว
 * แล้วเห็นแผนเทียบจริงทันที · อ่านในเบราว์เซอร์ ไม่บันทึกที่ไหน (ไฟล์คือที่เก็บข้อมูล)
 */

const MESSAGES: Record<string, string> = {
  NOT_PLAN_FILE: 'ไม่ใช่ไฟล์แผนงานจากระบบนี้ — ใช้ไฟล์ที่ดาวน์โหลดจากแท็บ "สร้างแผนงาน" แล้วกรอกผลงานรายงวด',
}

export function ProgressTracker() {
  const [report, setReport] = useState<ProgressReport | null>(null)
  const [fileName, setFileName] = useState('')
  const [reading, setReading] = useState(false)
  const [over, setOver] = useState(false)

  async function onFile(file: File | undefined) {
    if (!file) return
    if (!/\.xlsx$/i.test(file.name)) {
      toast.error('รองรับเฉพาะไฟล์ Excel (.xlsx)')
      return
    }
    setReading(true)
    try {
      const { readPlanFile } = await import('@/lib/boq/workbook')
      const r = await readPlanFile(await file.arrayBuffer())
      setReport(r)
      setFileName(file.name)
      if (!r.installments.length) toast.info('ไฟล์นี้ยังไม่มีการกรอกผลงาน — กรอก % แล้วเสร็จที่ชีตหมวด (คอลัมน์ "งวดที่") และวันที่ส่งงวดที่ชีต "สรุปผลเบิกจ่าย" แล้วอัปโหลดใหม่')
      else if (r.installments.some((p) => !p.date)) toast.warning('มีงวดที่ยังไม่ใส่วันที่ส่งงวด — งวดนั้นเทียบกับแผนไม่ได้')
      else if (r.start && r.installments.some((p) => p.date && p.date < r.start!))
        toast.warning('มีวันที่ส่งงวดก่อนวันเริ่มสัญญาในไฟล์ — ตรวจวันที่ในแถว "วันที่ส่งงวด"')
    } catch (e) {
      const code = e instanceof Error ? e.message : ''
      toast.error(MESSAGES[code] ?? 'อ่านไฟล์ไม่ได้ — ถ้าไฟล์เปิดอยู่ใน Excel ให้ปิดก่อนแล้วลองใหม่')
    } finally {
      setReading(false)
    }
  }

  const upload = (
    <label
      className={`card-surface flex flex-wrap items-center gap-4 border-dashed p-4 transition-colors ${over ? 'border-brand bg-brand-tint' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void onFile(e.dataTransfer.files[0]) }}
    >
      <FileCheck2 className="size-8 shrink-0 text-brand" />
      <div className="min-w-0 flex-1">
        <div className="break-words font-semibold text-ink">{fileName || 'ยังไม่ได้เลือกไฟล์แผนงาน'}</div>
        <div className="text-sm text-muted-token">
          ไฟล์แผนงานที่ดาวน์โหลดจากระบบ และกรอกผลงานรายงวดแล้ว · ปิดไฟล์ใน Excel ก่อนเลือก
        </div>
      </div>
      <span className={`btn-primary cursor-pointer ${reading ? 'pointer-events-none opacity-60' : ''}`}>
        {reading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        {fileName ? 'เปลี่ยนไฟล์' : 'เลือกไฟล์แผนงาน'}
      </span>
      <input
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = '' }}
      />
    </label>
  )

  if (!report) {
    return (
      <div className="min-w-0 space-y-4">
        {upload}
        <div className="card-surface p-5 text-sm text-ink-2">
          <div className="mb-2 font-semibold text-ink">ใช้อย่างไร</div>
          <ol className="list-decimal space-y-1 pl-5">
            <li>ส่งงวดเมื่อไหร่ เปิดไฟล์แผนงานที่ดาวน์โหลดไว้ ใส่วันที่ส่งงวดที่ชีต &quot;สรุปผลเบิกจ่าย&quot;</li>
            <li>ที่ชีตหมวด (เช่น &quot;1 งานสถาปัตยกรรม&quot;) กรอก % แล้วเสร็จสะสมของแต่ละรายการในคอลัมน์ &quot;งวดที่ …&quot; (ช่องสีเหลือง) แล้วบันทึกไฟล์</li>
            <li>อัปโหลดไฟล์ที่นี่ — เห็น S-Curve แผนเทียบจริง และงานไหนเร็ว/ช้ากว่าแผน</li>
          </ol>
        </div>
      </div>
    )
  }

  return (
    <div className="min-w-0 space-y-5">
      {upload}
      <ProgressReportView report={report} />
    </div>
  )
}
