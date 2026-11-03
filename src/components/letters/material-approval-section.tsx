'use client'

import { ArrowDown, ArrowUp, FileSpreadsheet, ListChecks, Loader2, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  MA_LIMITS, MA_NOTE_OPTIONS, MA_UNSPECIFIED, emptyMaItem, maItems, moveMaItem,
  type MaItem, type MaStyle, type MaterialApproval,
} from '@/lib/material-approval'

/**
 * การ์ด "รายการวัสดุที่ขออนุมัติ" ในหนังสือแบบ "ขออนุมัติใช้วัสดุ" (R26)
 * · รายการชุดเดียวใช้ได้ทั้งสองรูปแบบ — ระบุในเนื้อหา = ใช้แค่ รายการ + รายละเอียด · แนบตาราง = ครบ 7 คอลัมน์
 * · แก้แล้วเนื้อหาหนังสือ (แบบที่ 1) / ตารางแนบ (แบบที่ 2) ตามทันที
 */
export function MaterialApprovalSection({
  value,
  onChange,
  style,
  contractHint,
  letterSubject,
  contractor,
}: {
  value: MaterialApproval
  onChange: (ma: MaterialApproval) => void
  style: MaStyle
  /** สัญญาจ้างที่ดึงจากบรรทัด "อ้างถึง" — ใช้เมื่อช่องสัญญาว่าง */
  contractHint: string
  letterSubject: string
  /** ชื่อผู้รับจ้าง (หัวกระดาษ) */
  contractor: string
}) {
  const [exporting, setExporting] = useState(false)
  const table = style === 'table'
  const count = maItems(value).length

  const setItem = (i: number, patch: Partial<MaItem>) =>
    onChange({ ...value, items: value.items.map((it, k) => (k === i ? { ...it, ...patch } : it)) })

  function add() {
    if (value.items.length >= MA_LIMITS.rows) { toast.error(`ใส่ได้สูงสุด ${MA_LIMITS.rows} รายการ`); return }
    onChange({ ...value, items: [...value.items, emptyMaItem()] })
  }

  function remove(i: number) {
    const before = value
    const items = value.items.filter((_, k) => k !== i)
    onChange({ ...value, items: items.length ? items : [emptyMaItem()] })
    if (before.items[i] && (before.items[i].name.trim() || before.items[i].detail.trim())) {
      toast('ลบรายการแล้ว (ยังไม่บันทึก)', { action: { label: 'เลิกทำ', onClick: () => onChange(before) } })
    }
  }

  async function exportXlsx() {
    if (exporting) return
    if (count === 0) { toast.error('ยังไม่มีรายการวัสดุ'); return }
    setExporting(true)
    try {
      const { buildMaterialApprovalXlsx, materialApprovalFileName } = await import('@/lib/material-approval-xlsx')
      const buf = await buildMaterialApprovalXlsx(value, { contract: value.contract.trim() || contractHint, subject: letterSubject, contractor })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      a.download = materialApprovalFileName(letterSubject)
      document.body.appendChild(a)
      a.click()
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 10_000)
      toast.success('ดาวน์โหลดตารางรายการขออนุมัติใช้วัสดุแล้ว')
    } catch {
      toast.error('สร้างไฟล์ Excel ไม่สำเร็จ ลองใหม่อีกครั้ง')
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className="card-surface p-4">
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-ink">
        <ListChecks className="size-5 text-brand" /> รายการวัสดุที่ขออนุมัติ
        <span className="ml-auto text-xs font-normal text-muted-token tabular-nums">{count} รายการ</span>
      </h2>
      <p className="mb-3 text-sm text-muted-token">
        {table
          ? 'ระบบทำ “ตารางรายการขออนุมัติใช้วัสดุ” แนวนอนต่อท้ายหนังสือให้ · ช่องที่เว้นว่างพิมพ์เป็น “- ไม่ระบุ”'
          : 'รายการเป็นข้อ 1. 2. … ในเนื้อหาหนังสือ (รายการ + รายละเอียด) · แนบแค็ตตาล็อกเป็นรูปท้ายหนังสือ'}
      </p>

      {table && (
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="ma-project" className="label-base">โครงการ (หัวตาราง)</label>
            <input id="ma-project" className="input-base" value={value.project} maxLength={MA_LIMITS.header}
              onChange={(e) => onChange({ ...value, project: e.target.value })} />
          </div>
          <div>
            <label htmlFor="ma-contract" className="label-base">สัญญาจ้าง (หัวตาราง)</label>
            <input id="ma-contract" className="input-base" value={value.contract} maxLength={MA_LIMITS.header}
              placeholder={contractHint || '5/2569 ลงวันที่ 16 มิถุนายน 2569'}
              onChange={(e) => onChange({ ...value, contract: e.target.value })} />
            {!value.contract.trim() && contractHint && <p className="mt-1 text-xs text-muted-token">เว้นว่าง = ใช้จากบรรทัด “อ้างถึง”</p>}
          </div>
        </div>
      )}

      <ol className="space-y-3">
        {value.items.map((it, i) => (
          <li key={i} className="rounded-md border border-line-soft bg-surface-2 p-3">
            <div className="mb-2 flex items-center gap-1">
              <span className="text-sm font-semibold text-ink tabular-nums">ข้อ {i + 1}</span>
              <span className="ml-auto" />
              <button type="button" className="btn-ghost px-2" aria-label="เลื่อนขึ้น" disabled={i === 0}
                onClick={() => onChange({ ...value, items: moveMaItem(value.items, i, -1) })}>
                <ArrowUp className="size-4" />
              </button>
              <button type="button" className="btn-ghost px-2" aria-label="เลื่อนลง" disabled={i === value.items.length - 1}
                onClick={() => onChange({ ...value, items: moveMaItem(value.items, i, 1) })}>
                <ArrowDown className="size-4" />
              </button>
              <button type="button" className="btn-ghost px-2 text-urgent" aria-label="ลบรายการ" onClick={() => remove(i)}>
                <Trash2 className="size-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field id={`ma-${i}-name`} label="รายการวัสดุ" value={it.name} ph="เช่น ปูนก่อผนัง / ตู้โหลดเซ็นเตอร์ 50A"
                onChange={(v) => setItem(i, { name: v })} />
              <Field id={`ma-${i}-detail`} label={table ? 'รายละเอียดขออนุมัติใช้' : 'ยี่ห้อ / รุ่น / รายละเอียด'} value={it.detail}
                ph="เช่น ยี่ห้อ CHANG รุ่น MV-18" multi={table} onChange={(v) => setItem(i, { detail: v })} />
              {table && (
                <>
                  <Field id={`ma-${i}-drawing`} label="รูปแบบรายการ" value={it.drawing} ph={MA_UNSPECIFIED} multi
                    onChange={(v) => setItem(i, { drawing: v })} />
                  <Field id={`ma-${i}-boq`} label="แบบแสดงปริมาณราคา" value={it.boq} ph={MA_UNSPECIFIED} multi
                    onChange={(v) => setItem(i, { boq: v })} />
                  <Field id={`ma-${i}-spec`} label="รายการประกอบแบบ" value={it.spec} ph={MA_UNSPECIFIED} multi
                    onChange={(v) => setItem(i, { spec: v })} />
                  <div>
                    <label htmlFor={`ma-${i}-note`} className="label-base">หมายเหตุ</label>
                    <input id={`ma-${i}-note`} className="input-base" list="ma-note-options" value={it.note} maxLength={MA_LIMITS.text}
                      onChange={(e) => setItem(i, { note: e.target.value })} />
                  </div>
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
      <datalist id="ma-note-options">
        {MA_NOTE_OPTIONS.map((o) => <option key={o} value={o} />)}
      </datalist>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={add} className="btn-secondary">
          <Plus className="size-4" /> เพิ่มรายการ
        </button>
        {table && (
          <button type="button" onClick={exportXlsx} disabled={exporting || count === 0} className="btn-secondary">
            {exporting ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
            ดาวน์โหลด Excel
          </button>
        )}
      </div>
      {table && count > 0 && (
        <p className="mt-2 text-xs text-muted-token">ไฟล์ Word ของหนังสือไม่มีตาราง — ใช้ปุ่มพิมพ์ / PDF ที่มีตารางต่อท้ายให้แล้ว หรือแนบไฟล์ Excel แยก</p>
      )}
    </section>
  )
}

function Field({ id, label, value, ph, multi, onChange }: {
  id: string; label: string; value: string; ph?: string; multi?: boolean; onChange: (v: string) => void
}) {
  return (
    <div>
      <label htmlFor={id} className="label-base">{label}</label>
      {multi ? (
        <textarea id={id} className="input-base" rows={2} value={value} placeholder={ph} maxLength={MA_LIMITS.text}
          onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={id} className="input-base" value={value} placeholder={ph} maxLength={MA_LIMITS.text}
          onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  )
}
