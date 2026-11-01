'use client'

import { AlertTriangle, FileSpreadsheet, Loader2, Pencil, Table2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ChangeOrderEditor } from '@/components/letters/change-order-editor'
import { coMoney, coTotals, hasItems, type ChangeOrder } from '@/lib/change-order'

/**
 * การ์ด "ตารางงานเพิ่ม-ลด" ในหน้าหนังสือแบบ "ขออนุมัติงานเพิ่ม / งานลด" (R25)
 * · สรุปยอด + ปุ่มแก้ตาราง / ดาวน์โหลด Excel · ยอดส่วนต่างไหลไปช่อง "ประเภท" และ "จำนวนเงิน" ของใบปะหน้าเอง
 */
export function ChangeOrderSection({
  value,
  onChange,
  newTable,
  siteId,
  headerFromProject,
  onSave,
  saving,
  stale,
  onFixText,
}: {
  value: ChangeOrder | null
  onChange: (co: ChangeOrder | null) => void
  /** ตารางเปล่าพร้อมหัวตารางจากโครงการ */
  newTable: () => ChangeOrder
  siteId: string | null
  headerFromProject: () => Pick<ChangeOrder, 'project' | 'location' | 'owner'>
  onSave: () => void
  saving: boolean
  /** เนื้อความหนังสือถูกแก้เองแล้ว ยอดในเนื้อความไม่ตรงกับตาราง */
  stale: boolean
  onFixText: () => void
}) {
  const [open, setOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const t = value ? coTotals(value) : null
  const filled = hasItems(value)

  async function exportXlsx() {
    if (!value || exporting) return
    setExporting(true)
    try {
      const { buildChangeOrderXlsx, changeOrderFileName } = await import('@/lib/change-order-xlsx')
      const buf = await buildChangeOrderXlsx(value)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      a.download = changeOrderFileName(value)
      document.body.appendChild(a)
      a.click()
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 10_000)
      toast.success('ดาวน์โหลดตารางงานเพิ่ม-ลดแล้ว')
    } catch {
      toast.error('สร้างไฟล์ Excel ไม่สำเร็จ ลองใหม่อีกครั้ง')
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className="card-surface p-4">
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-ink">
        <Table2 className="size-5 text-brand" /> ตารางงานเพิ่ม-ลด
      </h2>
      <p className="mb-3 text-sm text-muted-token">
        กรอกรายการงานลด/งานเพิ่ม แล้วระบบเติม &ldquo;ประเภท&rdquo; กับ &ldquo;จำนวนเงิน&rdquo; ในหนังสือให้ · ตารางพิมพ์ต่อท้ายหนังสือ (ปุ่มพิมพ์ / PDF)
      </p>

      {t && filled ? (
        <dl className="mb-3 grid grid-cols-3 gap-2 text-center tabular-nums">
          <Stat label={`งานลด · ${t.cut.items} รายการ`} value={t.cut.total} />
          <Stat label={`งานเพิ่ม · ${t.add.items} รายการ`} value={t.add.total} />
          <Stat label={`ส่วนต่าง${t.kind ? ` (${t.kind})` : ''}`} value={t.amount} strong />
        </dl>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => { if (!value) onChange(newTable()); setOpen(true) }}
          className={filled ? 'btn-secondary' : 'btn-primary'}
        >
          {filled ? <Pencil className="size-4" /> : <Table2 className="size-4" />}
          {filled ? 'แก้ตาราง' : 'สร้างตารางงานเพิ่ม-ลด'}
        </button>
        {filled && (
          <>
            <button type="button" onClick={exportXlsx} disabled={exporting} className="btn-secondary">
              {exporting ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
              ดาวน์โหลด Excel
            </button>
            <button
              type="button"
              onClick={() => {
                const before = value
                onChange(null)
                toast('เอาตารางออกจากหนังสือแล้ว (ยังไม่บันทึก)', { action: { label: 'เลิกทำ', onClick: () => onChange(before) } })
              }}
              className="btn-ghost text-urgent"
            >
              <Trash2 className="size-4" /> เอาตารางออก
            </button>
          </>
        )}
      </div>
      {stale && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-status-progress-ring bg-status-progress-bg px-3 py-2 text-sm text-status-progress">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">ยอดในเนื้อความหนังสือไม่ตรงกับส่วนต่างในตาราง (เนื้อความถูกแก้เองไว้)</span>
          <button type="button" onClick={onFixText} className="btn-ghost text-status-progress">ใช้ข้อความตามตาราง</button>
        </div>
      )}
      {filled && (
        <p className="mt-2 text-xs text-muted-token">ไฟล์ Word ของหนังสือไม่มีตาราง — แนบไฟล์ Excel แยก หรือใช้ปุ่มพิมพ์ / PDF ที่มีตารางต่อท้ายให้แล้ว</p>
      )}

      {value && (
        <ChangeOrderEditor
          open={open}
          onOpenChange={setOpen}
          value={value}
          onChange={onChange}
          siteId={siteId}
          onFillHeader={() => onChange({ ...value, ...headerFromProject() })}
          onSave={onSave}
          saving={saving}
        />
      )}
    </section>
  )
}

function Stat({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`rounded-md border px-2 py-2 ${strong ? 'border-brand bg-brand-tint' : 'border-line-soft bg-surface-2'}`}>
      <dt className="text-xs text-muted-token">{label}</dt>
      <dd className={`mt-0.5 font-semibold ${strong ? 'text-lg text-brand' : 'text-base text-ink'}`}>฿{coMoney(value, false)}</dd>
    </div>
  )
}
