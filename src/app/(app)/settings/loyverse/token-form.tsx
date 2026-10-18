'use client'

import { KeyRound, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

export type TokenState = { set: boolean; last4: string | null }

const MESSAGES: Record<string, string> = {
  TOKEN_EMPTY: 'กรุณาวางโทเคน',
  TOKEN_INVALID: 'โทเคนไม่ถูกต้อง — คัดลอกมาไม่ครบหรือมีช่องว่างปน',
  FORBIDDEN: 'เฉพาะเจ้าของเท่านั้นที่ตั้งค่านี้ได้',
}

/** ฟอร์มวางโทเคน Loyverse — เก็บใน Vault · ไม่มีทางอ่านกลับ เห็นแค่ 4 ตัวท้าย */
export function TokenForm({ state }: { state: TokenState }) {
  const router = useRouter()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (!token.trim()) return toast.error(MESSAGES.TOKEN_EMPTY)
    setBusy(true)
    try {
      const r = await fetch('/api/settings/loyverse/token', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(MESSAGES[b.error as string] ?? 'บันทึกโทเคนไม่สำเร็จ')
        return
      }
      toast.success('บันทึกโทเคนแล้ว · กดทดสอบการเชื่อมต่อด้านล่างได้เลย')
      setToken('')
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 px-4 py-4" autoComplete="off">
      <div>
        <label htmlFor="lv-token" className="label-base">Access token</label>
        <input
          id="lv-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={state.set ? 'วางโทเคนใหม่เพื่อเปลี่ยน' : 'วางโทเคนจาก Loyverse Back Office'}
          className="input-base"
        />
        <p className="mt-1 text-xs text-muted-token">
          สถานะ:{' '}
          {state.set ? (
            <span className="tabular-nums text-ink-2">ตั้งแล้ว ลงท้าย ••••{state.last4}</span>
          ) : (
            <span className="text-expense">ยังไม่ได้ตั้ง</span>
          )}
        </p>
      </div>
      <button type="submit" disabled={busy} className="btn-primary">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
        {busy ? 'กำลังบันทึก…' : 'บันทึกโทเคน'}
      </button>
    </form>
  )
}
