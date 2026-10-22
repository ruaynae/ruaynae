'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { Building2, Search, X } from 'lucide-react'
import { useState } from 'react'
import { BLANK, thaiDate } from '@/lib/letters'

/** โครงการ + เลขที่/วันที่สัญญาจาก `site_finance` (กรอกที่หน้าโครงการ → แก้ไข) */
export type SiteContract = {
  siteId: string
  name: string
  /** ยังไม่ปิดงาน/ยกเลิก — โชว์ก่อน */
  active: boolean
  contractNo: string | null
  contractDate: string | null
}

/** บรรทัดอ้างถึงแบบที่ห้างเขียนเอง: "สัญญาจ้างเลขที่ 04/2570 ลงวันที่ 12 ตุลาคม 2569" */
export const contractRefLine = (c: SiteContract) =>
  `สัญญาจ้างเลขที่ ${c.contractNo || BLANK} ลงวันที่ ${c.contractDate ? thaiDate(c.contractDate) : BLANK}`

/**
 * ใส่บรรทัดสัญญาลงช่องอ้างถึง — มีบรรทัด "สัญญาจ้างเลขที่ …" อยู่แล้ว (ค่าตั้งต้นของชุดเลข/แบบว่าง) = แทนที่
 * ไม่งั้นต่อท้าย · อ้างถึงสัญญาซ้ำสองบรรทัดไม่มีความหมาย
 */
export function putContractRef(refs: string, line: string) {
  const lines = refs.split(/\r?\n/)
  const i = lines.findIndex((l) => /^\s*(\d+[.)]\s*)?สัญญาจ้าง/.test(l))
  if (i >= 0) return lines.map((l, j) => (j === i ? line : l)).join('\n')
  return refs.trim() ? `${refs.trim()}\n${line}` : line
}

/**
 * "อ้างถึงสัญญาของโครงการ" (เจ้าของขอ 22 ต.ค. 2569) — เลือกโครงการที่สร้างไว้ แล้วได้เลขที่/วันที่สัญญา
 * · โครงการของชุดเลขนี้ขึ้นก่อน · โครงการที่ยังไม่กรอกสัญญาเลือกได้ แต่บอกให้ไปกรอกที่หน้าโครงการ
 */
export function LetterContractPicker({
  open, onOpenChange, contracts, preferSiteId, onPick,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  contracts: SiteContract[]
  preferSiteId: string | null
  onPick: (line: string) => void
}) {
  const [q, setQ] = useState('')
  const term = q.trim().toLowerCase()
  const rank = (c: SiteContract) => (c.siteId === preferSiteId ? 0 : c.active ? 1 : 2)
  const list = contracts
    .filter((c) => !term || c.name.toLowerCase().includes(term) || (c.contractNo ?? '').toLowerCase().includes(term))
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 100)

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setQ('') }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[min(36rem,calc(100svh-2rem))] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-line bg-surface shadow-e3 animate-pop-in">
          <div className="flex items-start gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-lg font-bold text-ink">อ้างถึงสัญญาของโครงการ</Dialog.Title>
              <Dialog.Description className="text-sm text-muted-token">
                เลือกโครงการ — ระบบเติมเลขที่และวันที่สัญญาจากหน้าโครงการให้
              </Dialog.Description>
            </div>
            <Dialog.Close className="btn-ghost" aria-label="ปิด"><X className="size-4" /></Dialog.Close>
          </div>
          <div className="px-4 pt-3">
            <label className="relative block">
              <span className="sr-only">ค้นหา</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-token" />
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อโครงการ หรือ เลขที่สัญญา…" className="input-base pl-9" />
            </label>
          </div>
          <ul className="min-h-0 flex-1 divide-y divide-line-soft overflow-y-auto px-2 py-2">
            {list.map((c) => (
              <li key={c.siteId}>
                <button
                  type="button"
                  onClick={() => { onPick(contractRefLine(c)); onOpenChange(false); setQ('') }}
                  className="flex w-full items-start gap-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-surface-2"
                >
                  <Building2 className="mt-0.5 size-4 shrink-0 text-brand" />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-semibold text-ink">
                      {c.name}
                      {c.siteId === preferSiteId && <span className="ml-1.5 text-xs font-normal text-status-done">· โครงการของชุดเลขนี้</span>}
                    </span>
                    {c.contractNo || c.contractDate ? (
                      <span className="block text-sm text-ink-2">{contractRefLine(c)}</span>
                    ) : (
                      <span className="block text-sm text-status-progress">ยังไม่ได้กรอกเลขที่/วันที่สัญญา — กรอกที่หน้าโครงการ → แก้ไข</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
            {!list.length && <li className="px-2 py-6 text-center text-sm text-muted-token">{contracts.length ? 'ไม่พบโครงการที่ค้นหา' : 'ยังไม่มีโครงการ — สร้างที่เมนูโครงการก่อน'}</li>}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
