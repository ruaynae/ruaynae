'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { mrMessage } from '@/lib/materials'

/**
 * ปุ่ม "จ่ายของแล้ว" (แคชเชียร์/เจ้าของ) หรือ "ยกเลิกใบนี้" (คนยื่น/เจ้าของ) พร้อมกล่องยืนยัน
 * สิทธิ์จริงอยู่ใน RPC — ปุ่มนี้แค่ไม่ถูกวาดให้คนที่ไม่มีสิทธิ์
 */
export function RequestAction({
  id,
  requestNo,
  kind,
  big = false,
}: {
  id: string
  requestNo: string
  kind: 'issue' | 'cancel'
  big?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const issue = kind === 'issue'

  const run = async () => {
    if (busy) return
    setBusy(true)
    try {
      const r = await fetch(`/api/materials/${id}/${kind}`, { method: 'POST' })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(mrMessage(b.error, issue ? 'บันทึกการจ่ายของไม่สำเร็จ' : 'ยกเลิกไม่สำเร็จ'))
        if (r.status === 409) router.refresh()
        return
      }
      toast.success(issue ? `จ่ายของตาม ${requestNo} แล้ว` : `ยกเลิก ${requestNo} แล้ว`)
      setOpen(false)
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !busy && setOpen(v)}>
      <Dialog.Trigger asChild>
        {issue ? (
          <button type="button" className={`btn-primary ${big ? 'w-full py-3 text-base' : ''}`}>
            <CheckCircle2 className="size-5" />
            จ่ายของแล้ว
          </button>
        ) : (
          <button type="button" className="btn-ghost text-expense">
            <XCircle className="size-4" />
            ยกเลิกใบนี้
          </button>
        )}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-surface p-5 shadow-e3 animate-pop-in">
          <Dialog.Title className="text-base font-bold text-ink">
            {issue ? `จ่ายของตาม ${requestNo} แล้วใช่ไหม` : `ยกเลิก ${requestNo} ใช่ไหม`}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-ink-2">
            {issue
              ? 'กดเมื่อช่างรับของครบตามใบแล้ว · อย่าลืมออกบิลใน Loyverse โดยใส่เลขใบนี้ในหมายเหตุ และจ่ายด้วย "เบิกใช้งาน"'
              : 'ใบที่ยกเลิกแล้วจะหายจากหน้าจอแคชเชียร์ และเปิดกลับไม่ได้ — ถ้าต้องการของอีกให้คีย์ใบใหม่'}
          </Dialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close className="btn-secondary" disabled={busy}>ไม่ใช่</Dialog.Close>
            <button type="button" onClick={run} disabled={busy} className={issue ? 'btn-primary' : 'btn-danger'}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {issue ? 'ยืนยันจ่ายของแล้ว' : 'ยืนยันยกเลิก'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
