'use client'

import * as Dialog from '@radix-ui/react-dialog'
import {
  ArrowDown, ArrowRightLeft, ArrowUp, Heading, ListPlus, Loader2, Plus, Save, Table2, Trash2, X,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ChangeOrderBoqPicker } from '@/components/letters/change-order-boq-picker'
import {
  appendRows, coMoney, coTotals, emptyItem, endsEquip, itemTotals, moveRow, num,
  type ChangeOrder, type CoBlock, type CoGroup, type CoItem, type CoRow, type CoSide,
} from '@/lib/change-order'

/**
 * กล่องแก้ตารางงานเพิ่ม-ลด (R25) — เต็มจอ เพราะตาราง 10 คอลัมน์แก้ในครึ่งจอไม่ไหว
 * · แก้แล้วมีผลทันทีกับใบปะหน้า/ตัวอย่างกระดาษ (state อยู่ที่ฟอร์มหนังสือ) · เก็บลงฐานข้อมูลตอนกดบันทึก
 * · ตัวเลขทุกตัวคิดจาก `change-order.ts` ชุดเดียวกับกระดาษและ Excel
 */
export function ChangeOrderEditor({
  open,
  onOpenChange,
  value,
  onChange,
  siteId,
  onFillHeader,
  onSave,
  saving,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  value: ChangeOrder
  onChange: (co: ChangeOrder) => void
  /** โครงการของชุดเลขหนังสือ — แผนงาน (BOQ) ของโครงการนี้ขึ้นก่อนในกล่องเลือก */
  siteId: string | null
  /** หัวตารางจากโครงการ (ชื่อเต็ม · ที่ตั้ง · ผู้ว่าจ้าง) */
  onFillHeader: () => void
  onSave: () => void
  saving: boolean
}) {
  const [side, setSide] = useState<CoSide>('cut')
  const [boqOpen, setBoqOpen] = useState(false)
  const co = value
  const t = coTotals(co)
  const block = co[side]

  const setHead = <K extends 'work' | 'project' | 'location' | 'owner' | 'drawingNo'>(k: K, v: string) =>
    onChange({ ...co, [k]: v })
  const setBlock = (s: CoSide, b: CoBlock) => onChange({ ...co, [s]: b })
  const setRows = (rows: CoRow[]) => setBlock(side, { ...block, rows })
  const setRow = (i: number, r: CoRow) => setRows(block.rows.map((x, j) => (j === i ? r : x)))
  const add = (r: CoRow) => setRows([...block.rows, r])

  function copyToOther(i: number) {
    const r = block.rows[i]
    if (r.t !== 'item') return
    const other: CoSide = side === 'cut' ? 'add' : 'cut'
    // หัวข้อที่อยู่เหนือรายการนี้ไปด้วย (ถ้าอีกฝั่งยังไม่มีหัวข้อเดียวกันเป็นแถวสุดท้าย) — งานเพิ่มมักเป็นรายการเดิมที่แก้ขนาด
    const head = [...block.rows.slice(0, i)].reverse().find((x) => x.t === 'head')
    const src = block.rows.slice(0, i)
    const srcGroup = [...src].reverse().find((x): x is CoGroup => x.t === 'group')
    const lastHead = [...co[other].rows].reverse().find((x) => x.t === 'head')
    const add: CoRow[] = []
    if (head && head.t === 'head' && !(lastHead && lastHead.t === 'head' && lastHead.text === head.text)) add.push({ ...head })
    add.push({ ...r })
    // รายการครุภัณฑ์ต้องไปเป็นครุภัณฑ์ที่อีกฝั่งด้วย (พาแถวหมวดไปเมื่อสถานะต่างกัน)
    const rows = appendRows(co[other].rows, add, endsEquip(src), srcGroup)
    setBlock(other, { ...co[other], rows })
    toast.success(`คัดลอกไป${other === 'cut' ? 'งานลด' : 'งานเพิ่ม'}แล้ว — แก้จำนวน/ขนาดที่นั่นได้เลย`)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
        <Dialog.Content className="fixed inset-0 z-50 flex flex-col bg-canvas sm:inset-4 sm:rounded-lg sm:border sm:border-line sm:shadow-e3">
          <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3 sm:rounded-t-lg">
            <Table2 className="size-5 shrink-0 text-brand" />
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate text-lg font-bold text-ink">ตารางงานเพิ่ม-ลด</Dialog.Title>
              <Dialog.Description className="truncate text-xs text-muted-token">
                ยอดส่วนต่างไปลงใบปะหน้าหนังสือให้เอง · ตารางพิมพ์ต่อท้ายหนังสือ
              </Dialog.Description>
            </div>
            <Dialog.Close className="btn-ghost" aria-label="ปิด">
              <X className="size-5" />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="mx-auto max-w-5xl space-y-4">
              <details className="card-surface p-4" open={!co.project || undefined}>
                <summary className="cursor-pointer text-base font-semibold text-ink">
                  หัวตาราง <span className="text-sm font-normal text-muted-token">— {co.project || 'ยังไม่ได้กรอกชื่อโครงการ'}</span>
                </summary>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Text id="co-work" label="กลุ่มงาน/งาน" value={co.work} onChange={(v) => setHead('work', v)} ph="งานสถาปัตยกรรม" />
                  <Text id="co-dno" label="แบบเลขที่" value={co.drawingNo} onChange={(v) => setHead('drawingNo', v)} ph="ไม่บังคับ" />
                  <div className="sm:col-span-2">
                    <Text id="co-project" label="ชื่อโครงการ/งานก่อสร้าง" value={co.project} onChange={(v) => setHead('project', v)} />
                  </div>
                  <Text id="co-loc" label="สถานที่ก่อสร้าง" value={co.location} onChange={(v) => setHead('location', v)} />
                  <Text id="co-owner" label="หน่วยงานเจ้าของโครงการ" value={co.owner} onChange={(v) => setHead('owner', v)} />
                  <div>
                    <label htmlFor="co-factor" className="label-base">Factor F</label>
                    <NumInput id="co-factor" value={co.factor} onChange={(n) => n !== null && n >= 1 && n <= 3 && onChange({ ...co, factor: n })} />
                    <p className="mt-1 text-xs text-muted-token">ตามแบบ ปร.5 ของสัญญา · ครุภัณฑ์ที่คิดแค่ VAT ใส่ 1.07</p>
                  </div>
                  <div className="flex items-end">
                    <button type="button" onClick={onFillHeader} className="btn-secondary w-full">เติมหัวตารางจากโครงการ</button>
                  </div>
                </div>
              </details>

              <div role="tablist" className="grid grid-cols-2 gap-2">
                {(['cut', 'add'] as const).map((s) => {
                  const bt = s === 'cut' ? t.cut : t.add
                  const on = s === side
                  return (
                    <button
                      key={s}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => setSide(s)}
                      className={`rounded-md border px-3 py-2 text-left transition-colors ${on ? 'border-brand bg-brand-tint' : 'border-line bg-surface hover:bg-surface-2'}`}
                    >
                      <span className="block text-base font-semibold text-ink">{s === 'cut' ? 'งานลด' : 'งานเพิ่ม'}</span>
                      <span className="block text-xs text-muted-token tabular-nums">
                        {bt.items} รายการ · ฿{coMoney(bt.total, false)}
                      </span>
                    </button>
                  )
                })}
              </div>

              <div className="card-surface space-y-3 p-4">
                <Text
                  id="co-title"
                  label="ชื่อบล็อก"
                  value={block.title}
                  onChange={(v) => setBlock(side, { ...block, title: v })}
                  ph={side === 'cut' ? 'งานลด' : 'งานเพิ่ม (ทางเลือกที่ 3)'}
                />

                {block.rows.length === 0 && (
                  <p className="rounded-md border border-dashed border-line px-3 py-6 text-center text-sm text-muted-token">
                    ยังไม่มีรายการ{side === 'cut' ? 'งานลด' : 'งานเพิ่ม'} — เพิ่มหมวด/หัวข้อ/รายการด้านล่าง หรือเลือกจาก BOQ
                  </p>
                )}

                <ol className="space-y-2">
                  {block.rows.map((r, i) => (
                    <li key={i} className={`rounded-md border px-3 py-2.5 ${r.t === 'item' ? 'border-line bg-surface' : 'border-line-soft bg-surface-2'}`}>
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <RowFields row={r} onChange={(x) => setRow(i, x)} />
                        </div>
                        <div className="flex shrink-0 flex-col gap-0.5 sm:flex-row">
                          <IconBtn label="ขึ้น" onClick={() => setRows(moveRow(block.rows, i, -1))} disabled={i === 0}><ArrowUp className="size-4" /></IconBtn>
                          <IconBtn label="ลง" onClick={() => setRows(moveRow(block.rows, i, 1))} disabled={i === block.rows.length - 1}><ArrowDown className="size-4" /></IconBtn>
                          {r.t === 'item' && (
                            <IconBtn label={`คัดลอกไป${side === 'cut' ? 'งานเพิ่ม' : 'งานลด'}`} onClick={() => copyToOther(i)}>
                              <ArrowRightLeft className="size-4" />
                            </IconBtn>
                          )}
                          <IconBtn label="ลบแถว" onClick={() => setRows(block.rows.filter((_, j) => j !== i))} danger><Trash2 className="size-4" /></IconBtn>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>

                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-secondary" onClick={() => add(emptyItem())}><Plus className="size-4" /> รายการ</button>
                  <button type="button" className="btn-secondary" onClick={() => add({ t: 'head', text: '' })}><Heading className="size-4" /> หัวข้อ</button>
                  <button type="button" className="btn-secondary" onClick={() => add({ t: 'group', no: '', text: '' })}><ListPlus className="size-4" /> หมวด</button>
                  <button type="button" className="btn-secondary" onClick={() => setBoqOpen(true)}><Table2 className="size-4" /> เลือกจาก BOQ</button>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-line bg-surface px-4 py-3 sm:rounded-b-lg">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-2">
              <dl className="flex flex-1 flex-wrap gap-x-5 gap-y-1 text-sm tabular-nums">
                <div><dt className="inline text-muted-token">งานลด </dt><dd className="inline font-semibold text-ink">฿{coMoney(t.cut.total, false)}</dd></div>
                <div><dt className="inline text-muted-token">งานเพิ่ม </dt><dd className="inline font-semibold text-ink">฿{coMoney(t.add.total, false)}</dd></div>
                <div>
                  <dt className="inline text-muted-token">ส่วนต่าง{t.kind ? ` (${t.kind})` : ''} </dt>
                  <dd className="inline text-base font-bold text-brand">฿{coMoney(t.amount, false)}</dd>
                </div>
              </dl>
              <button type="button" onClick={onSave} disabled={saving} className="btn-primary">
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                บันทึก
              </button>
            </div>
          </div>

          <ChangeOrderBoqPicker
            open={boqOpen}
            onOpenChange={setBoqOpen}
            siteId={siteId}
            target={side}
            onPick={(rows, factor) => {
              const next = { ...co, [side]: { ...block, rows: appendRows(block.rows, rows) } }
              // ตารางใหม่ยังไม่มีรายการ → Factor F ของสัญญามาด้วย
              if (factor && t.cut.items + t.add.items === 0) next.factor = factor
              onChange(next)
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function RowFields({ row, onChange }: { row: CoRow; onChange: (r: CoRow) => void }) {
  if (row.t === 'group') {
    return (
      <div className="space-y-2">
        <div className="flex gap-2">
          <input aria-label="เลขหมวด" value={row.no} onChange={(e) => onChange({ ...row, no: e.target.value })} placeholder="1.6" className="input-base w-20 font-semibold" />
          <input aria-label="ชื่อหมวด" value={row.text} onChange={(e) => onChange({ ...row, text: e.target.value })} placeholder="หมวด เช่น งานตกแต่งภายใน" className="input-base min-w-0 flex-1 font-semibold" />
        </div>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={Boolean(row.equip)}
            onChange={(e) => onChange({ t: 'group', no: row.no, text: row.text, ...(e.target.checked ? { equip: true } : {}) })}
            className="size-4"
          />
          หมวดครุภัณฑ์ <span className="text-muted-token">(ไม่คูณ Factor F · บวก VAT 7% แทน)</span>
        </label>
      </div>
    )
  }
  if (row.t === 'head') {
    return (
      <input aria-label="หัวข้อ" value={row.text} onChange={(e) => onChange({ ...row, text: e.target.value })} placeholder="หัวข้อ เช่น Built In ตู้เตี้ยเก็บเอกสาร : B-01" className="input-base font-semibold" />
    )
  }
  return <ItemFields row={row} onChange={onChange} />
}

function ItemFields({ row, onChange }: { row: CoItem; onChange: (r: CoItem) => void }) {
  const x = itemTotals(row)
  const set = <K extends keyof CoItem>(k: K, v: CoItem[K]) => onChange({ ...row, [k]: v })
  return (
    <div className="space-y-2">
      <input aria-label="รายการ" value={row.text} onChange={(e) => set('text', e.target.value)} placeholder="รายการ เช่น ตู้เก็บเอกสาร กว้าง 0.60 ม. ยาว 3.50 ม. สูง 0.90 ม." className="input-base" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[6rem_5rem_minmax(0,1fr)_minmax(0,1fr)_7rem]">
        <Small label="จำนวน"><NumInput aria-label="จำนวน" value={row.qty} onChange={(n) => set('qty', n)} /></Small>
        <Small label="หน่วย"><input aria-label="หน่วย" value={row.unit} onChange={(e) => set('unit', e.target.value)} placeholder="ชุด" className="input-base" /></Small>
        <Small label="ค่าวัสดุ/หน่วย"><NumInput aria-label="ราคาค่าวัสดุต่อหน่วย" value={row.mat} onChange={(n) => set('mat', n)} /></Small>
        <Small label="ค่าแรง/หน่วย"><NumInput aria-label="ราคาค่าแรงต่อหน่วย" value={row.lab} onChange={(n) => set('lab', n)} /></Small>
        <Small label="หมายเหตุ"><input aria-label="หมายเหตุ" value={row.note} onChange={(e) => set('note', e.target.value)} className="input-base" /></Small>
      </div>
      <p className="text-right text-sm text-muted-token tabular-nums">
        รวม <span className="font-semibold text-ink">฿{coMoney(x.total, false)}</span>
        {x.lab > 0 && <span> (วัสดุ {coMoney(x.mat)} · แรง {coMoney(x.lab)})</span>}
      </p>
    </div>
  )
}

/**
 * ช่องตัวเลข — เก็บข้อความที่กำลังพิมพ์ไว้เอง ("12." ยังพิมพ์ต่อได้) แต่ถ้าค่าข้างนอกเปลี่ยน
 * (เลือกจาก BOQ · ย้ายแถว) แสดงค่าข้างนอกแทน
 */
function NumInput({ value, onChange, id, ...rest }: { value: number | null; onChange: (n: number | null) => void; id?: string; 'aria-label'?: string }) {
  const [txt, setTxt] = useState(value === null ? '' : String(value))
  const shown = num(txt) === value ? txt : value === null ? '' : String(value)
  return (
    <input
      id={id}
      {...rest}
      inputMode="decimal"
      value={shown}
      onChange={(e) => { setTxt(e.target.value); onChange(num(e.target.value)) }}
      className="input-base text-right tabular-nums"
    />
  )
}

function Small({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="mb-0.5 block text-xs text-muted-token">{label}</span>
      {children}
    </div>
  )
}

function Text({ id, label, value, onChange, ph }: { id: string; label: string; value: string; onChange: (v: string) => void; ph?: string }) {
  return (
    <div>
      <label htmlFor={id} className="label-base">{label}</label>
      <input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={ph} className="input-base" />
    </div>
  )
}

function IconBtn({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`grid size-9 place-items-center rounded-md text-muted-token transition-colors hover:bg-surface-2 disabled:opacity-30 ${danger ? 'hover:text-urgent' : 'hover:text-brand'}`}
    >
      {children}
    </button>
  )
}
