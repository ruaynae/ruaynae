'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { Search, X } from 'lucide-react'
import { useState } from 'react'
import { formatLetterNo, thaiDate, type RegisterEntry } from '@/lib/letters'

/**
 * "อ้างถึงหนังสือในทะเบียน" — เลือกฉบับเก่าแล้วได้บรรทัดอ้างถึงรูปแบบเดียวกับที่ห้างเขียนเอง
 * (`reg028`: "หนังสือขอปรึกษาหารือพื้นปูกระเบื้อง F1,F2 เลขที่ reg017/2569 ลงวันที่ 20 กรกฎาคม 2569")
 */
export function letterRefLine(e: RegisterEntry, prefix: string) {
  return `หนังสือ${e.subject} เลขที่ ${formatLetterNo(prefix, e.seq, e.yearCe)} ลงวันที่ ${thaiDate(e.date)}`
}

export function LetterRefPicker({
  open,
  onOpenChange,
  entries,
  prefix,
  onPick,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** หนังสือของชุดเลขเดียวกัน ใหม่สุดก่อน */
  entries: RegisterEntry[]
  prefix: string
  onPick: (line: string) => void
}) {
  const [q, setQ] = useState('')
  const term = q.trim().toLowerCase()
  const list = entries
    .filter((e) => !term || e.subject.toLowerCase().includes(term) || formatLetterNo(prefix, e.seq, e.yearCe).includes(term))
    .slice(0, 100)

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setQ('') }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[min(36rem,calc(100svh-2rem))] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-line bg-surface shadow-e3 animate-pop-in">
          <div className="flex items-start gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-lg font-bold text-ink">อ้างถึงหนังสือในทะเบียน</Dialog.Title>
              <Dialog.Description className="text-sm text-muted-token">
                เลือกฉบับที่ต้องการอ้างถึง — ระบบเติมเลขที่และวันที่ให้
              </Dialog.Description>
            </div>
            <Dialog.Close className="btn-ghost" aria-label="ปิด"><X className="size-4" /></Dialog.Close>
          </div>
          <div className="px-4 pt-3">
            <label className="relative block">
              <span className="sr-only">ค้นหา</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-token" />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="ค้นหาเลขที่ หรือ เรื่อง…"
                className="input-base pl-9"
              />
            </label>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {list.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => { onPick(letterRefLine(e, prefix)); onOpenChange(false); setQ('') }}
                  className="flex w-full items-baseline gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-2"
                >
                  <span className="shrink-0 font-semibold tnum text-ink">{formatLetterNo(prefix, e.seq, e.yearCe)}</span>
                  <span className="min-w-0 flex-1 text-sm text-ink-2">{e.subject}</span>
                  <span className="shrink-0 text-xs text-muted-token">{thaiDate(e.date)}</span>
                </button>
              </li>
            ))}
            {list.length === 0 && (
              <li className="px-2 py-6 text-center text-sm text-muted-token">
                {entries.length === 0 ? 'ยังไม่มีหนังสือในชุดเลขนี้' : 'ไม่พบหนังสือที่ตรงกับคำค้น'}
              </li>
            )}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
