'use client'

import { bahtText } from '@/lib/baht-text'
import type { LetterTemplate } from '@/lib/letter-templates'

/**
 * ขั้นที่ 2 — ช่องเฉพาะของแบบที่เลือก (ครั้งที่ · งาน · ช่วงวันที่ · จำนวนเงิน …)
 * แก้ช่องนี้แล้วเรื่อง/สิ่งที่ส่งมาด้วย/เนื้อความเติมใหม่ให้ — เฉพาะข้อความที่ยังไม่ได้แก้เอง
 */
export function LetterQuickFields({
  template,
  values,
  onChange,
}: {
  template: LetterTemplate
  values: Record<string, string>
  onChange: (k: string, v: string) => void
}) {
  const fields = template.fields ?? []
  if (fields.length === 0) return null

  return (
    <div className="grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-2">
      {fields.map((f) => {
        const id = `lq-${f.k}`
        const v = values[f.k] ?? ''
        const amount = f.type === 'money' ? Number(v.replace(/,/g, '')) : NaN
        return (
          <div key={f.k} className={f.wide ? 'sm:col-span-2' : ''}>
            <label htmlFor={id} className="label-base">
              {f.label}
              {f.auto && (
                <span className="ml-1.5 rounded-xs bg-status-done-bg px-1.5 py-0.5 text-xs font-semibold text-status-done">
                  นับให้อัตโนมัติ
                </span>
              )}
            </label>
            {f.type === 'select' ? (
              <select id={id} value={v} onChange={(e) => onChange(f.k, e.target.value)} className="input-base">
                {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <>
                <input
                  id={id}
                  type={f.type === 'number' ? 'number' : 'text'}
                  inputMode={f.type === 'money' ? 'decimal' : f.type === 'number' ? 'numeric' : undefined}
                  min={f.type === 'number' ? 1 : undefined}
                  value={v}
                  placeholder={f.ph}
                  list={f.list ? `${id}-list` : undefined}
                  onChange={(e) => onChange(f.k, e.target.value)}
                  className="input-base"
                />
                {f.list && (
                  <datalist id={`${id}-list`}>
                    {f.list.map((o) => <option key={o} value={o} />)}
                  </datalist>
                )}
              </>
            )}
            {f.type === 'money' && v.trim() !== '' && Number.isFinite(amount) && (
              <p className="mt-1 text-xs text-muted-token">{bahtText(amount)}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}
