'use client'

import { CalendarCheck, FileSearch, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { MP_LIMITS, MP_PER_YEAR, mpLabel, mpMonths, mpOn, mpRemoveRow, mpToggle, type MaintPlan } from '@/lib/maintenance-plan'
import { BoqNamePicker } from '@/components/letters/boq-name-picker'

/**
 * การ์ด "แผนปฏิบัติงานบำรุงรักษาครุภัณฑ์" (R33) — แนบท้ายหนังสือแบบ "ขอส่งแผนบำรุงรักษา"
 * · รายการเลือกจาก BOQ (ครุภัณฑ์ · เครื่องใช้ไฟฟ้า) หรือพิมพ์เอง · เดือนเริ่ม + จำนวนปี + ปีละกี่ครั้งตาม TOR (ค่าตั้งต้น 2 ปี ปีละ 2 ครั้ง)
 * · ทุกช่องติ๊กไว้ให้ — กดช่องในตารางเพื่อเอาออกเฉพาะรายการที่ตรวจไม่ครบทุกครั้ง
 */
export function MaintenancePlanSection({
  value, onChange, siteId, defaultStart,
}: {
  value: MaintPlan
  onChange: (p: MaintPlan) => void
  siteId: string | null
  /** เดือนเริ่มแนะนำ `YYYY-MM` (เดือนถัดจากวันที่หนังสือ) */
  defaultStart: string
}) {
  const [pick, setPick] = useState(false)
  const cols = mpMonths(value)
  const perOk = (n: number) => value.years * n <= MP_LIMITS.cols

  const setItem = (i: number, s: string) => onChange({ ...value, items: value.items.map((x, k) => (k === i ? s : x)) })

  return (
    <section className="card-surface space-y-3.5 p-4">
      <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
        <CalendarCheck className="size-5 text-brand" /> แผนปฏิบัติงานบำรุงรักษาครุภัณฑ์
      </h2>
      <p className="text-sm text-muted-token">พิมพ์เป็นตารางแนวนอนต่อท้ายหนังสือ · ไฟล์ Word ไม่มีตารางนี้ — ใช้ปุ่มพิมพ์ / PDF</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="label-base">โครงการ</span>
          <input className="input-base" value={value.project} onChange={(e) => onChange({ ...value, project: e.target.value })} />
        </label>
        <label className="block"><span className="label-base">สถานที่</span>
          <input className="input-base" value={value.location} onChange={(e) => onChange({ ...value, location: e.target.value })} />
        </label>
        <label className="block"><span className="label-base">เดือนที่เข้าตรวจครั้งแรก</span>
          <input type="month" className="input-base" value={value.start || defaultStart} onChange={(e) => onChange({ ...value, start: e.target.value })} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="label-base">ระยะเวลา (ปี)</span>
            <select className="input-base" value={value.years} onChange={(e) => {
              const y = Number(e.target.value)
              onChange({ ...value, years: y, perYear: y * value.perYear > MP_LIMITS.cols ? 1 : value.perYear, off: [] })
            }}>
              {Array.from({ length: MP_LIMITS.years }, (_, i) => i + 1).map((y) => <option key={y} value={y}>{y} ปี</option>)}
            </select>
          </label>
          <label className="block"><span className="label-base">ปีละ (ครั้ง)</span>
            <select className="input-base" value={value.perYear} onChange={(e) => onChange({ ...value, perYear: Number(e.target.value), off: [] })}>
              {MP_PER_YEAR.filter(perOk).map((n) => <option key={n} value={n}>{n} ครั้ง</option>)}
            </select>
          </label>
        </div>
      </div>
      <p className="text-xs text-muted-token">ตาม TOR — ถ้า TOR ไม่ระบุ ใช้ปีละ 2 ครั้ง · เปลี่ยนความถี่แล้วช่องที่เอาติ๊กออกไว้จะกลับเป็นติ๊กทั้งหมด</p>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={() => setPick(true)}><FileSearch className="size-4" /> เลือกจาก BOQ</button>
        <button type="button" className="btn-secondary" onClick={() => onChange({ ...value, items: [...value.items, ''] })} disabled={value.items.length >= MP_LIMITS.rows}>
          <Plus className="size-4" /> เพิ่มรายการเอง
        </button>
      </div>

      {value.items.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-3 py-6 text-center text-sm text-muted-token">ยังไม่มีรายการ — เลือกจาก BOQ หรือเพิ่มเอง</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-line-soft">
          <table className="w-full min-w-[32rem] text-sm">
            <thead className="bg-surface-2 text-xs text-muted-token">
              <tr>
                <th className="w-10 px-2 py-1.5">ที่</th>
                <th className="px-2 py-1.5 text-left">รายการซ่อมบำรุง</th>
                {cols.map((c, i) => <th key={i} className="px-1 py-1.5 whitespace-nowrap">{mpLabel(c)}</th>)}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {value.items.map((s, i) => (
                <tr key={i} className="border-t border-line-soft">
                  <td className="px-2 text-center tabular-nums">{i + 1}</td>
                  <td className="px-1 py-1">
                    <input aria-label={`รายการที่ ${i + 1}`} className="input-base !min-h-9 py-1" value={s} maxLength={MP_LIMITS.text} onChange={(e) => setItem(i, e.target.value)} />
                  </td>
                  {cols.map((_, c) => (
                    <td key={c} className="px-1 text-center">
                      <input type="checkbox" className="size-4 accent-brand" aria-label={`ตรวจรายการที่ ${i + 1} ครั้งที่ ${c + 1}`} checked={mpOn(value, i, c)} onChange={() => onChange({ ...value, off: mpToggle(value.off, i, c) })} />
                    </td>
                  ))}
                  <td className="px-1 text-center">
                    <button type="button" className="btn-ghost" aria-label={`ลบรายการที่ ${i + 1}`} onClick={() => onChange(mpRemoveRow(value, i))}><Trash2 className="size-4 text-urgent" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <BoqNamePicker
        open={pick}
        onOpenChange={setPick}
        siteId={siteId}
        title="เลือกรายการบำรุงรักษาจาก BOQ"
        confirmLabel="เพิ่มเข้าแผนบำรุงรักษา"
        onPick={(rows) => {
          const have = new Set(value.items.map((x) => x.trim()))
          const add = rows.map((r) => r.name.replace(/\s+/g, ' ').trim()).filter((n) => n && !have.has(n))
          const room = MP_LIMITS.rows - value.items.length
          onChange({ ...value, items: [...value.items, ...add.slice(0, room)] })
          toast.success(add.length ? `เพิ่ม ${Math.min(add.length, room)} รายการ` : 'รายการที่เลือกมีอยู่แล้ว')
        }}
      />
    </section>
  )
}
