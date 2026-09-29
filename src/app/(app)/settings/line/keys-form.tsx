'use client'

import { KeyRound, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

export type KeyState = { set: boolean; last4: string | null }

const MESSAGES: Record<string, string> = {
  KEYS_EMPTY: 'กรุณากรอกอย่างน้อยหนึ่งช่อง',
  SECRET_INVALID: 'Channel secret ไม่ถูกต้อง — ต้องเป็นตัวอักษรและตัวเลข 32 ตัว',
  TOKEN_INVALID: 'Channel access token ไม่ถูกต้อง — คัดลอกมาไม่ครบหรือมีช่องว่างปน',
  FORBIDDEN: 'เฉพาะเจ้าของเท่านั้นที่ตั้งค่านี้ได้',
}

function Status({ label, state }: { label: string; state: KeyState }) {
  return (
    <p className="mt-1 text-xs text-muted-token">
      {label}:{' '}
      {state.set ? (
        <span className="tabular-nums text-ink-2">ตั้งแล้ว ลงท้าย ••••{state.last4}</span>
      ) : (
        <span className="text-expense">ยังไม่ได้ตั้ง</span>
      )}
    </p>
  )
}

/**
 * ฟอร์มวางคีย์ของ LINE — คีย์เก็บใน Supabase Vault ไม่ใช่ Vercel
 *
 * ไม่มีทางอ่านคีย์กลับมา: หน้านี้เห็นแค่ 4 ตัวท้าย · ช่องที่เว้นว่าง = คงค่าเดิม
 */
export function KeysForm({ secret, token }: { secret: KeyState; token: KeyState }) {
  const router = useRouter()
  const [s, setS] = useState('')
  const [t, setT] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (!s.trim() && !t.trim()) return toast.error(MESSAGES.KEYS_EMPTY)
    setBusy(true)
    try {
      const r = await fetch('/api/settings/line/keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelSecret: s, accessToken: t }),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(MESSAGES[b.error as string] ?? 'บันทึกคีย์ไม่สำเร็จ')
        return
      }
      toast.success('บันทึกคีย์แล้ว')
      setS('')
      setT('')
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
        <label htmlFor="line-secret" className="label-base">Channel secret</label>
        <input
          id="line-secret"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={s}
          onChange={(e) => setS(e.target.value)}
          placeholder={secret.set ? 'เว้นว่างไว้ = ใช้ค่าเดิม' : 'วางจากหน้า Basic settings'}
          className="input-base"
        />
        <Status label="สถานะ" state={secret} />
      </div>
      <div>
        <label htmlFor="line-token" className="label-base">Channel access token (long-lived)</label>
        <input
          id="line-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={t}
          onChange={(e) => setT(e.target.value)}
          placeholder={token.set ? 'เว้นว่างไว้ = ใช้ค่าเดิม' : 'วางจากหน้า Messaging API'}
          className="input-base"
        />
        <Status label="สถานะ" state={token} />
      </div>
      <button type="submit" disabled={busy} className="btn-primary">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
        {busy ? 'กำลังบันทึก…' : 'บันทึกคีย์'}
      </button>
    </form>
  )
}
