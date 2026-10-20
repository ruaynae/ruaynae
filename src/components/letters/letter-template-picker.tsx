'use client'

import { Search } from 'lucide-react'
import { useState } from 'react'
import { LETTER_TEMPLATES } from '@/lib/letter-templates'

/**
 * ขั้นที่ 1 — เลือกแบบหนังสือ · เรียงตามที่ห้างใช้บ่อย (วัสดุ · Shop Drawing · ขยายเวลา …)
 * ป้ายใต้ชื่อบอกว่าเคยออกแบบนี้ไปกี่ฉบับในชุดเลขนี้ ช่วยให้หาแบบที่ใช้ประจำได้เร็ว
 */
export function LetterTemplatePicker({
  selected,
  usage,
  onPick,
}: {
  selected: string | null
  usage: Record<string, number>
  onPick: (id: string) => void
}) {
  const [q, setQ] = useState('')
  const term = q.trim().toLowerCase()
  const list = LETTER_TEMPLATES.filter(
    (t) => !term || t.name.toLowerCase().includes(term) || t.subject.toLowerCase().includes(term),
  )

  return (
    <div>
      <label className="relative mb-2.5 block">
        <span className="sr-only">ค้นหาแบบหนังสือ</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-token" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ค้นหา เช่น วัสดุ, Shop Drawing, ขยายเวลา…"
          className="input-base pl-9"
        />
      </label>
      <div className="grid max-h-72 grid-cols-1 gap-2 overflow-y-auto p-0.5 sm:grid-cols-2">
        {list.map((t) => {
          const n = usage[t.id] ?? 0
          const on = selected === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onPick(t.id)}
              aria-pressed={on}
              className={`flex min-w-0 flex-col items-start rounded-md border px-3 py-2 text-left transition-colors ${
                on ? 'border-brand bg-brand-tint' : 'border-line bg-surface hover:border-brand'
              }`}
            >
              <span className={`text-sm font-semibold ${on ? 'text-brand-on-tint' : 'text-ink'}`}>{t.name}</span>
              <span className="text-xs text-muted-token">
                {n > 0 ? `เคยออก ${n} ฉบับ` : t.id === 'blank' ? 'พิมพ์เรื่องและเนื้อความเอง' : 'แบบมาตรฐาน'}
              </span>
            </button>
          )
        })}
        {list.length === 0 && <p className="px-1 py-2 text-sm text-muted-token">ไม่พบแบบหนังสือ</p>}
      </div>
    </div>
  )
}
