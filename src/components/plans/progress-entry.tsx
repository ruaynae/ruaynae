'use client'

import { useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import type { BoqCategory } from '@/lib/boq/core'
import { itemKey, type PlanProgress } from '@/lib/boq/plan-store'
import { fmtMoney } from '@/lib/format'

/**
 * ช่องกรอกผลงานของงวดหนึ่ง — วันที่ส่งงวด + % แล้วเสร็จสะสมของแต่ละรายการย่อย (ปร.4)
 * · ช่องว่าง = เท่างวดก่อน (ตัวเลขจาง ๆ ในช่องคือค่าที่ยกมา) — กติกาเดียวกับช่องว่างในไฟล์ Excel
 * · "ทั้งงาน" = ใส่ % เดียวกันให้ทุกรายการของงานนั้นในคลิกเดียว (งานที่ไม่ได้แตกรายการ)
 */

const pctText = (x: number) => String(Math.round(x * 10000) / 100)

/** ค่าที่ยกมาจากงวดก่อน ๆ (ไม่มี = 0) */
export const inherited = (vals: (number | null)[] | undefined, k: number) => {
  for (let i = k - 1; i >= 0; i -= 1) if (vals?.[i] != null) return vals[i] as number
  return 0
}

/** ช่อง % — เก็บข้อความระหว่างพิมพ์ แล้วส่งค่าตอนออกจากช่อง/กด Enter (พิมพ์ "12." ได้ไม่ถูกตัด) */
function PctInput({
  value, placeholder, label, onCommit,
}: { value: number | null; placeholder: string; label: string; onCommit: (v: number | null) => void }) {
  const shown = value == null ? '' : pctText(value)
  const [text, setText] = useState(shown)
  const [base, setBase] = useState(shown)
  if (base !== shown) {
    setBase(shown)
    setText(shown)
  }
  function commit() {
    const t = text.trim()
    if (t === '') return onCommit(null)
    const n = Number(t)
    if (!Number.isFinite(n)) return setText(shown)
    const v = Math.min(100, Math.max(0, n)) / 100
    setText(pctText(v))
    onCommit(v)
  }
  return (
    <div className="relative w-24 shrink-0">
      <input
        className="input-base w-full py-1.5 pr-7 text-right tabular-nums"
        inputMode="decimal"
        aria-label={label}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value.replace(/[^\d.]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-muted-token">%</span>
    </div>
  )
}

export function ProgressEntry({
  categories, progress, k, onDate, onItem, onTask,
}: {
  categories: BoqCategory[]
  progress: PlanProgress
  /** งวดที่กำลังกรอก (0 = งวดที่ 1) */
  k: number
  onDate: (iso: string | null) => void
  onItem: (key: string, v: number | null) => void
  onTask: (keys: string[], v: number | null) => void
}) {
  // เลขข้อเหมือนในไฟล์ Excel — หมวด/งานที่ปิดไว้ไม่กินเลข
  const numbers = categories.reduce<{ cat: number; tasks: number[] }[]>((acc, c) => {
    const prev = acc.length ? acc[acc.length - 1].cat : 0
    let n = 0
    acc.push({ cat: c.tasks.some((t) => t.on) ? prev + 1 : prev, tasks: c.tasks.map((t) => (t.on ? ++n : 0)) })
    return acc
  }, [])
  return (
    <div className="space-y-3">
      <label className="block max-w-xs">
        <span className="label-base">วันที่ส่งงวดที่ {k + 1}</span>
        <input
          className="input-base"
          type="date"
          value={progress.dates[k] ?? ''}
          onChange={(e) => onDate(e.target.value || null)}
        />
        <span className="mt-1 block text-xs text-muted-token">
          ต้องมีวันที่ เส้นผลงานจริง (สีส้ม) จึงขึ้นในกราฟ · ยังไม่ใส่แล้วกรอก % = ใช้วันนี้ แก้ได้
        </span>
      </label>

      {categories.map((c, ci) => {
        if (!c.tasks.some((t) => t.on)) return null
        const no = numbers[ci].cat
        const on = c.tasks.flatMap((t, ti) => (t.on ? t.items.map((it, ii) => ({ it, key: itemKey(ci, ti, ii) })) : []))
        const catAmt = on.reduce((s, x) => s + x.it.amount, 0) || 1
        const catPct = on.reduce((s, x) => s + x.it.amount * (progress.items[x.key]?.[k] ?? inherited(progress.items[x.key], k)), 0) / catAmt
        return (
          <details key={ci} open={categories.length === 1} className="panel group">
            <summary className="flex cursor-pointer list-none items-center gap-2 bg-surface-2 px-4 py-2.5 font-semibold text-ink">
              <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-0 -rotate-90" />
              <span className="min-w-0 flex-1 break-words">{no}. {c.name}</span>
              <span className="shrink-0 text-sm font-normal tabular-nums text-muted-token">สะสม {pctText(catPct)}%</span>
            </summary>
            <div className="divide-y divide-line-soft">
              {c.tasks.map((t, ti) => {
                if (!t.on) return null
                const j = numbers[ci].tasks[ti]
                const keys = t.items.map((_, ii) => itemKey(ci, ti, ii))
                const now = keys.map((key) => progress.items[key]?.[k] ?? null)
                const eff = keys.map((key, i) => now[i] ?? inherited(progress.items[key], k))
                const amt = t.items.reduce((s, it) => s + it.amount, 0) || 1
                const taskPct = t.items.reduce((s, it, i) => s + it.amount * eff[i], 0) / amt
                const done = eff.every((x) => x >= 1)
                const single = t.items.length === 1
                return (
                  <div key={ti} className="px-4 py-2.5">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="break-words font-medium text-ink">
                          <span className="tabular-nums text-muted-token">{no}.{j}</span> {t.name}
                        </div>
                        <div className="text-xs text-muted-token">
                          สะสม {pctText(taskPct)}% · ค่างาน {fmtMoney(t.amount)} บาท
                          {done && <Check className="ml-1 inline size-3.5 text-status-done" aria-label="เสร็จแล้ว" />}
                        </div>
                      </div>
                      {single ? (
                        <PctInput
                          label={`% แล้วเสร็จ ${t.name}`}
                          value={now[0]}
                          placeholder={pctText(inherited(progress.items[keys[0]], k))}
                          onCommit={(v) => onItem(keys[0], v)}
                        />
                      ) : (
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className="text-xs text-muted-token">ทั้งงาน</span>
                          <PctInput
                            label={`% แล้วเสร็จทั้งงาน ${t.name}`}
                            value={now.every((x) => x != null && x === now[0]) ? now[0] : null}
                            placeholder="—"
                            onCommit={(v) => v != null && onTask(keys, v)}
                          />
                        </div>
                      )}
                    </div>
                    {!single && (
                      <ul className="mt-2 space-y-1.5 border-l-2 border-line pl-3">
                        {t.items.map((it, ii) => (
                          <li key={ii} className="flex items-center gap-3">
                            <div className="min-w-0 flex-1 text-sm text-ink-2">
                              <span className="break-words">{it.name || '(ไม่มีชื่อรายการ)'}</span>
                              <span className="block text-xs text-muted-token">
                                {it.qty != null && `${it.qty.toLocaleString('th-TH')} ${it.unit} · `}{fmtMoney(it.amount)} บาท
                              </span>
                            </div>
                            <PctInput
                              label={`% แล้วเสร็จ ${it.name}`}
                              value={now[ii]}
                              placeholder={pctText(inherited(progress.items[keys[ii]], k))}
                              onCommit={(v) => onItem(keys[ii], v)}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>
          </details>
        )
      })}
    </div>
  )
}
