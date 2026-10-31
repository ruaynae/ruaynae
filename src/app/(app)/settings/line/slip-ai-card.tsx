'use client'

import { FlaskConical, KeyRound, Loader2, ScanText } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import type { KeyState } from './keys-form'

const NETWORK = 'เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่'

const MESSAGES: Record<string, string> = {
  KEY_INVALID: 'คีย์ไม่ถูกต้อง — คัดลอกมาไม่ครบหรือมีช่องว่างปน',
  FORBIDDEN: 'เฉพาะเจ้าของเท่านั้นที่ตั้งค่านี้ได้',
  NOT_INSTALLED: 'ระบบยังไม่พร้อม — ต้องรันไฟล์อัปเดตฐานข้อมูลของการอ่านสลิปก่อน',
  OFF: 'ยังไม่ได้ใส่คีย์',
  QUOTA: 'คีย์ใช้ได้ แต่โควตาฟรีของวันนี้หมดแล้ว — พรุ่งนี้ใช้ได้ใหม่',
  KEY_REJECTED: 'Google ไม่รับคีย์นี้ — สร้างคีย์ใหม่แล้ววางอีกครั้ง',
  ERROR: 'ติดต่อ Google ไม่สำเร็จ ลองใหม่อีกครั้ง',
}

/**
 * อ่านสลิปด้วย AI ในบอท LINE (31 ต.ค. 2569) — คีย์ Gemini API เก็บใน Vault
 * ใส่คีย์ = เปิด · ล้างคีย์ = ปิด · ปุ่มทดสอบยิงคำขอจริงหนึ่งครั้ง
 */
export function SlipAiCard({ state, installed }: { state: KeyState; installed: boolean }) {
  const router = useRouter()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState<'save' | 'off' | 'test' | null>(null)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  async function save(value: string, mode: 'save' | 'off') {
    if (busy) return
    if (mode === 'save' && !value.trim()) return toast.error('วางคีย์ก่อนกดบันทึก')
    setBusy(mode)
    setResult(null)
    try {
      const r = await fetch('/api/settings/line/slip-ai', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: value }),
      })
      const b = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) {
        toast.error(MESSAGES[b.error ?? ''] ?? 'บันทึกไม่สำเร็จ')
        return
      }
      toast.success(mode === 'save' ? 'เปิดอ่านสลิปแล้ว — กดทดสอบคีย์ได้เลย' : 'ปิดอ่านสลิปแล้ว')
      setKey('')
      router.refresh()
    } catch {
      toast.error(NETWORK)
    } finally {
      setBusy(null)
    }
  }

  async function test() {
    if (busy) return
    setBusy('test')
    setResult(null)
    try {
      const r = await fetch('/api/settings/line/slip-ai', { method: 'POST' })
      const b = (await r.json().catch(() => ({}))) as { error?: string }
      if (r.ok) setResult({ ok: true, message: 'คีย์ใช้ได้ — ลองส่งรูปสลิปเข้าแชทบอทได้เลย' })
      else setResult({ ok: false, message: MESSAGES[b.error ?? ''] ?? MESSAGES.ERROR })
    } catch {
      setResult({ ok: false, message: NETWORK })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className="flex items-center gap-2.5 border-b border-line-soft px-4 py-3">
        <ScanText className="size-4 shrink-0 text-brand" strokeWidth={1.8} />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">อ่านสลิปอัตโนมัติ (AI)</h2>
          <p className="mt-0.5 text-xs text-muted-token">
            ส่งรูปสลิปเข้าแชท บอทอ่านยอด วันที่ ผู้รับเงิน ให้กดยืนยันทีเดียว · ใช้ Google Gemini
          </p>
        </div>
      </div>

      <div className="space-y-3 px-4 py-4">
        {!installed ? (
          <p className="text-sm text-expense">
            ยังเปิดใช้ไม่ได้ — ต้องรันไฟล์อัปเดตฐานข้อมูล <span className="font-mono text-xs">20261031090000_slip_ai_key.sql</span> ก่อน
          </p>
        ) : (
          <>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-2">
              <li>
                เปิด{' '}
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-brand underline">
                  Google AI Studio
                </a>{' '}
                ล็อกอินด้วยบัญชี Google แล้วกด Create API key
              </li>
              <li>คัดลอกคีย์มาวางในช่องด้านล่าง แล้วกดบันทึก</li>
              <li>กดทดสอบคีย์ ถ้าผ่านก็ส่งรูปสลิปเข้าแชทบอทได้เลย</li>
            </ol>
            <p className="rounded-md bg-surface-2 px-3 py-2 text-xs text-muted-token">
              แบบฟรีของ Google มีโควตาจำกัดต่อวัน และ Google อาจนำรูปที่ส่งไปใช้พัฒนาระบบของเขา (รวมชื่อและเลขบัญชีบนสลิป)
              · โควตาหมดเมื่อไหร่ บอทจะถามยอดให้พิมพ์เองเหมือนเดิม
            </p>

            <div>
              <label htmlFor="slip-ai-key" className="label-base">Gemini API key</label>
              <input
                id="slip-ai-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={state.set ? 'เว้นว่างไว้ = ใช้คีย์เดิม' : 'วางคีย์ที่ขึ้นต้นด้วย AIza…'}
                className="input-base"
              />
              <p className="mt-1 text-xs text-muted-token">
                สถานะ:{' '}
                {state.set ? (
                  <span className="tabular-nums text-ink-2">เปิดอยู่ · คีย์ลงท้าย ••••{state.last4}</span>
                ) : (
                  <span className="text-expense">ปิดอยู่ (ยังไม่มีคีย์)</span>
                )}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => save(key, 'save')} disabled={!!busy} className="btn-primary">
                {busy === 'save' ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                {busy === 'save' ? 'กำลังบันทึก…' : 'บันทึกคีย์'}
              </button>
              {state.set && (
                <>
                  <button type="button" onClick={test} disabled={!!busy} className="btn-secondary">
                    {busy === 'test' ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}
                    {busy === 'test' ? 'กำลังทดสอบ…' : 'ทดสอบคีย์'}
                  </button>
                  <button type="button" onClick={() => save('', 'off')} disabled={!!busy} className="btn-secondary">
                    {busy === 'off' && <Loader2 className="size-4 animate-spin" />}
                    ปิดอ่านสลิป
                  </button>
                </>
              )}
            </div>
            {result && (
              <p role="status" className={`text-sm ${result.ok ? 'text-ink-2' : 'text-expense'}`}>
                {result.message}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  )
}
