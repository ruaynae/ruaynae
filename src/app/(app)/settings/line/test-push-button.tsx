'use client'

import { Loader2, Send } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

const NETWORK = 'เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่'

const REASONS: Record<string, string> = {
  NO_TOKEN: 'ยังไม่ได้ตั้ง access token — กรอกคีย์ที่ด้านบนก่อน',
  TOKEN_REJECTED: 'LINE ไม่รับ access token — กรอกคีย์ใหม่ที่ด้านบน',
  QUOTA_EXCEEDED: 'โควตาข้อความเดือนนี้หมด LINE จึงไม่ยอมส่ง — แจ้งเตือนอัตโนมัติจะไม่ถึงจนกว่าจะขึ้นเดือนใหม่',
  NOT_FOUND: 'ไม่พบบัญชีนี้แล้ว — โหลดหน้าใหม่',
}

type Result = { ok: boolean; message: string }

/** ปุ่มส่งข้อความทดสอบเข้า LINE บัญชีเดียว · กินโควตา 1 ข้อความต่อครั้ง */
export function TestPushButton({ accountId, disabled }: { accountId: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  async function send() {
    if (busy) return
    setBusy(true)
    setResult(null)
    try {
      const r = await fetch('/api/settings/line/test-push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: accountId }),
      })
      const b = (await r.json().catch(() => ({}))) as { error?: string; status?: number }
      if (r.ok) {
        const message = 'ส่งแล้ว — ดูในแชทบอทของบัญชีนี้ ถ้าไม่เห็นข้อความภายในครึ่งนาที ให้ตรวจว่าบล็อกบอทอยู่หรือเปล่า'
        setResult({ ok: true, message })
        toast.success('ส่งข้อความทดสอบแล้ว')
        return
      }
      const known = b.error ? REASONS[b.error] : undefined
      const message =
        known ??
        (b.status ? `LINE ปฏิเสธการส่ง (รหัส ${b.status}) — ลองใหม่อีกครั้ง หรือผูกบัญชีนี้ใหม่` : 'ส่งไม่สำเร็จ ลองใหม่อีกครั้ง')
      setResult({ ok: false, message })
      toast.error('ส่งข้อความทดสอบไม่สำเร็จ')
    } catch {
      setResult({ ok: false, message: NETWORK })
      toast.error(NETWORK)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button type="button" onClick={send} disabled={busy || disabled} className="btn-secondary shrink-0">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        {busy ? 'กำลังส่ง…' : 'ส่งข้อความทดสอบ'}
      </button>
      {result && (
        <p
          role="status"
          className={`max-w-xs text-right text-xs ${result.ok ? 'text-ink-2' : 'text-expense'}`}
        >
          {result.message}
        </p>
      )}
    </div>
  )
}
