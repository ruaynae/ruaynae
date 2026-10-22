'use client'

import { useMemo, useState } from 'react'
import { Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import {
  DOMESTIC_MIN, STEEL_MIN, applyMarks, itemTotal, itemsOf, totals, type DomModel,
} from '@/lib/boq/domestic'
import { fmtMoney } from '@/lib/format'
import { Badge } from '@/components/ui/badge'

/**
 * แผนการใช้พัสดุที่ผลิตภายในประเทศ (R22) — อัปโหลด BOQ → ตารางค่าวัสดุจากแบบ ปร.4 → ดาวน์โหลด Excel
 * · ทุกรายการเริ่มเป็นพัสดุในประเทศ · ติ๊ก "นำเข้า" รายการที่ผลิตจากต่างประเทศ
 * · ติ๊ก "เหล็ก" แก้รายการเหล็กที่ระบบเดาให้ — มีเหล็กอย่างน้อยหนึ่งรายการ = ไฟล์มีชีตแผนการใช้เหล็กด้วย
 * · อ่านไฟล์ในเบราว์เซอร์ ไม่ส่งขึ้นเซิร์ฟเวอร์ (เหมือนแท็บสร้างแผนงาน)
 */

type Marks = Record<string, { steel?: boolean; foreign?: boolean }>
const pct = (x: number) => `${(x * 100).toFixed(2)}%`

export function DomesticBuilder() {
  const [model, setModel] = useState<DomModel | null>(null)
  const [fileName, setFileName] = useState('')
  const [reading, setReading] = useState(false)
  const [over, setOver] = useState(false)
  const [marks, setMarks] = useState<Marks>({})
  const [onlySteel, setOnlySteel] = useState(false)
  const [exporting, setExporting] = useState(false)

  const view = useMemo(() => (model ? applyMarks(model, marks) : null), [model, marks])
  const items = useMemo(() => (view ? itemsOf(view) : []), [view])
  const all = totals(items)
  const steel = totals(items.filter((i) => i.steel))

  async function onFile(file: File | undefined) {
    if (!file) return
    if (!/\.xlsx?$/i.test(file.name)) {
      toast.error('รองรับเฉพาะไฟล์ Excel (.xlsx หรือ .xls)')
      return
    }
    setReading(true)
    try {
      const [{ readBoqGrids }, { parseBoq }, { extractDomestic }] = await Promise.all([
        import('@/lib/boq/workbook'), import('@/lib/boq/core'), import('@/lib/boq/domestic'),
      ])
      const grids = await readBoqGrids(await file.arrayBuffer())
      const boq = parseBoq(grids)
      const m = extractDomestic(grids, boq.categories.map((c) => c.source), boq.project.name)
      if (!itemsOf(m).length) {
        toast.error('ไม่พบรายการค่าวัสดุในไฟล์ — ตรวจว่าเป็น BOQ ที่มีแบบ ปร.4 ช่อง "ราคาค่าวัสดุ"')
        return
      }
      setModel(m)
      setMarks({})
      setFileName(file.name)
      toast.success(`อ่าน BOQ แล้ว · พัสดุ ${itemsOf(m).length} รายการ`)
    } catch (e) {
      const code = e instanceof Error ? e.message : ''
      toast.error(code === 'BOQ_EMPTY' ? 'ไม่พบรายการงานในไฟล์ ตรวจว่าเป็นไฟล์ BOQ ที่มีแบบ ปร.4 / ปร.5 / ปร.6' : 'อ่านไฟล์ไม่ได้ ตรวจว่าเป็นไฟล์ BOQ ที่เปิดใน Excel ได้ และไม่ได้ตั้งรหัสผ่าน')
    } finally {
      setReading(false)
    }
  }

  const mark = (id: string, k: 'steel' | 'foreign', v: boolean) => setMarks((m) => ({ ...m, [id]: { ...m[id], [k]: v } }))

  async function onExport() {
    if (!view) return
    setExporting(true)
    try {
      const { buildDomesticXlsx } = await import('@/lib/boq/domestic-xlsx')
      const buf = await buildDomesticXlsx(view)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      a.download = `แผนการใช้พัสดุในประเทศ_${(view.project || 'โครงการ').slice(0, 60).replace(/[\\/:*?"<>|]/g, '')}.xlsx`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
      toast.success('สร้างไฟล์แล้ว')
    } catch {
      toast.error('สร้างไฟล์ไม่สำเร็จ ลองใหม่อีกครั้ง')
    } finally {
      setExporting(false)
    }
  }

  const upload = (
    <label
      className={`card-surface flex flex-wrap items-center gap-4 border-dashed p-4 transition-colors ${over ? 'border-brand bg-brand-tint' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void onFile(e.dataTransfer.files[0]) }}
    >
      <FileSpreadsheet className="size-8 shrink-0 text-brand" />
      <div className="min-w-0 flex-1">
        <div className="break-words font-semibold text-ink">{fileName || 'ยังไม่ได้เลือกไฟล์ BOQ'}</div>
        <div className="text-sm text-muted-token">ไฟล์ .xlsx หรือ .xls ที่มีแบบ ปร.4 (ช่องราคาค่าวัสดุ) · ไฟล์ไม่ถูกส่งขึ้นเซิร์ฟเวอร์</div>
      </div>
      <span className={`btn-primary cursor-pointer ${reading ? 'pointer-events-none opacity-60' : ''}`}>
        {reading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        {fileName ? 'เปลี่ยนไฟล์' : 'เลือกไฟล์ BOQ'}
      </span>
      <input
        type="file"
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        className="sr-only"
        onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = '' }}
      />
    </label>
  )

  if (!view) {
    return (
      <div className="min-w-0 space-y-4">
        {upload}
        <div className="card-surface p-5 text-sm text-ink-2">
          <div className="mb-2 font-semibold text-ink">ระบบทำอะไรให้</div>
          <ol className="list-decimal space-y-1 pl-5">
            <li>อ่านส่วนรายละเอียดของแบบ ปร.4 เอาเฉพาะ <b>ราคาค่าวัสดุ</b> (ราคา/หน่วย × จำนวน) — งานรื้อถอนและรายการค่าแรงล้วนไม่อยู่ในตาราง</li>
            <li>ทุกรายการเริ่มเป็นพัสดุในประเทศ · ติ๊ก &quot;นำเข้า&quot; รายการที่ผลิตจากต่างประเทศ</li>
            <li>ระบบเดารายการเหล็ก (เหล็กเส้น ข้ออ้อย รูปพรรณ ท่อเหล็ก มอก.20/24/107 …) — แก้ได้ · มีเหล็ก = ไฟล์มีชีตแผนการใช้เหล็กด้วย</li>
            <li>ดาวน์โหลด Excel: ชีตสรุปมูลค่า + ตารางแยกตามชีตของ BOQ (ตามแบบที่ห้างใช้ยื่นอยู่เดิม) พร้อมเทียบเกณฑ์ พัสดุ ≥ 60% · เหล็ก ≥ 90%</li>
          </ol>
        </div>
      </div>
    )
  }

  const domPct = all.total ? all.domestic / all.total : 0
  const steelPct = steel.total ? steel.domestic / steel.total : 0

  return (
    <div className="min-w-0 space-y-5">
      {upload}

      <section className="card-surface grid grid-cols-2 gap-4 p-4 lg:grid-cols-4">
        {[
          ['พัสดุทั้งโครงการ', `${all.count} รายการ`, `${fmtMoney(all.total)} บาท`],
          ['ผลิตในประเทศ', pct(domPct), `${fmtMoney(all.domestic)} บาท`],
          ['ผลิตจากต่างประเทศ', pct(all.total ? all.foreign / all.total : 0), `${fmtMoney(all.foreign)} บาท`],
          ['เหล็ก', steel.count ? `${steel.count} รายการ · ${pct(steelPct)}` : 'ไม่มีรายการเหล็ก', steel.count ? `${fmtMoney(steel.total)} บาท` : 'ไม่ต้องทำแผนการใช้เหล็ก'],
        ].map(([l, v, s]) => (
          <div key={l} className="min-w-0">
            <div className="text-xs text-muted-token">{l}</div>
            <div className="text-xl font-bold tabular-nums text-ink">{v}</div>
            <div className="text-xs tabular-nums text-muted-token">{s}</div>
          </div>
        ))}
        <div className="col-span-full flex flex-wrap gap-2">
          <Badge tone={domPct >= DOMESTIC_MIN ? 'done' : 'urgent'} dot>
            พัสดุในประเทศ {domPct >= DOMESTIC_MIN ? 'ผ่าน' : 'ต่ำกว่า'}เกณฑ์ {Math.round(DOMESTIC_MIN * 100)}%
          </Badge>
          {steel.count > 0 && (
            <Badge tone={steelPct >= STEEL_MIN ? 'done' : 'urgent'} dot>
              เหล็กในประเทศ {steelPct >= STEEL_MIN ? 'ผ่าน' : 'ต่ำกว่า'}เกณฑ์ {Math.round(STEEL_MIN * 100)}%
            </Badge>
          )}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={onlySteel} onChange={(e) => setOnlySteel(e.target.checked)} />
          เฉพาะรายการเหล็ก ({steel.count})
        </label>
        <button type="button" className="btn-primary ml-auto" disabled={exporting} onClick={() => void onExport()}>
          {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          ดาวน์โหลด Excel
        </button>
      </div>

      {view.sheets.map((s) => {
        const rows = s.rows.filter((r) => (r.kind === 'head' && !onlySteel) || (r.kind === 'item' && (!onlySteel || r.steel)))
        if (onlySteel && !rows.some((r) => r.kind === 'item')) return null
        return (
          <section key={s.sheet} className="space-y-2">
            <h2 className="text-lg font-semibold text-ink">{s.sheet}</h2>
            <div className="panel overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="bg-surface-2 text-left text-xs text-muted-token">
                    <th className="px-3 py-2">รายการ</th>
                    <th className="px-3 py-2 text-right">จำนวน</th>
                    <th className="px-3 py-2 text-right">ราคา/หน่วย</th>
                    <th className="px-3 py-2 text-right">รวม (บาท)</th>
                    <th className="px-3 py-2 text-center">เหล็ก</th>
                    <th className="px-3 py-2 text-center">นำเข้า</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) =>
                    r.kind === 'head' ? (
                      <tr key={i} className="border-t border-line bg-surface-2 font-semibold text-ink">
                        <td colSpan={6} className="px-3 py-1.5">{r.code} {r.name}</td>
                      </tr>
                    ) : r.kind === 'item' ? (
                      <tr key={r.id} className={`border-t border-line-soft ${r.foreign ? 'bg-status-progress-bg' : ''}`}>
                        <td className="min-w-[280px] px-3 py-1.5 text-ink">
                          {r.code && <span className="tabular-nums text-muted-token">{r.code} </span>}
                          {r.name.trim().replace(/^[-–]\s*/, '')}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{r.qty.toLocaleString('th-TH')} {r.unit}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{fmtMoney(r.price)}</td>
                        <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-ink">{fmtMoney(itemTotal(r))}</td>
                        <td className="px-3 py-1.5 text-center">
                          <input type="checkbox" className="size-4 accent-[var(--brand)]" aria-label="รายการเหล็ก" checked={r.steel} onChange={(e) => mark(r.id, 'steel', e.target.checked)} />
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <input type="checkbox" className="size-4 accent-[var(--brand)]" aria-label="ผลิตจากต่างประเทศ" checked={r.foreign} onChange={(e) => mark(r.id, 'foreign', e.target.checked)} />
                        </td>
                      </tr>
                    ) : null,
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}
    </div>
  )
}
