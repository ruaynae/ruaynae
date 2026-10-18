'use client'

import { CheckCircle2, Loader2, PlugZap, Save } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { lvMessage } from './loyverse-messages'

type Option = { id: string; name: string; type?: string | null }
type TestResult = { stores: Option[]; paymentTypes: Option[]; itemCount: number }
type Current = {
  storeId: string | null
  storeName: string | null
  paymentTypeId: string | null
  paymentTypeName: string | null
}

/** ปุ่มทดสอบโทเคน → เลือกร้าน + วิธีชำระเงิน "เบิกใช้งาน" → บันทึก */
export function ConnectPanel({ hasToken, current }: { hasToken: boolean; current: Current }) {
  const router = useRouter()
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)
  const [storeId, setStoreId] = useState(current.storeId ?? '')
  const [paymentId, setPaymentId] = useState(current.paymentTypeId ?? '')

  const test = async () => {
    if (testing) return
    setTesting(true)
    try {
      const r = await fetch('/api/settings/loyverse/test', { method: 'POST' })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        setResult(null)
        toast.error(lvMessage(b.error, 'ทดสอบไม่สำเร็จ'))
        return
      }
      const res = b as TestResult
      setResult(res)
      if (!storeId && res.stores.length === 1) setStoreId(res.stores[0].id)
      if (!paymentId) {
        const guess = res.paymentTypes.find((p) => p.name.includes('เบิก'))
        if (guess) setPaymentId(guess.id)
      }
      toast.success(`เชื่อมต่อได้ · พบสินค้า ${res.itemCount.toLocaleString('th-TH')} รายการ`)
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setTesting(false)
    }
  }

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      const r = await fetch('/api/settings/loyverse/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, paymentTypeId: paymentId }),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(lvMessage(b.error, 'บันทึกไม่สำเร็จ'))
        return
      }
      toast.success('บันทึกร้านและวิธีชำระเงินแล้ว')
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setSaving(false)
    }
  }

  const noWithdrawType = result && !result.paymentTypes.some((p) => p.name.includes('เบิก'))

  return (
    <div className="space-y-4 px-4 py-4">
      {current.storeId && (
        <p className="flex items-start gap-2 text-sm text-ink-2">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-income" />
          <span>
            ใช้ร้าน <span className="font-medium text-ink">{current.storeName ?? 'ร้าน'}</span> · บิลเบิกคือบิลที่จ่ายด้วย{' '}
            <span className="font-medium text-ink">{current.paymentTypeName ?? 'วิธีที่เลือก'}</span>
          </span>
        </p>
      )}

      <button type="button" onClick={test} disabled={!hasToken || testing} className="btn-secondary">
        {testing ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
        {testing ? 'กำลังทดสอบ…' : 'ทดสอบการเชื่อมต่อ'}
      </button>
      {!hasToken && <p className="text-xs text-muted-token">ตั้งโทเคนก่อนจึงจะทดสอบได้</p>}

      {result && (
        <div className="space-y-3">
          <div>
            <label htmlFor="lv-store" className="label-base">ร้าน</label>
            <select id="lv-store" value={storeId} onChange={(e) => setStoreId(e.target.value)} className="input-base">
              <option value="">เลือกร้าน</option>
              {result.stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="lv-pay" className="label-base">วิธีชำระเงินที่ใช้กับบิลเบิกของช่าง</label>
            <select id="lv-pay" value={paymentId} onChange={(e) => setPaymentId(e.target.value)} className="input-base">
              <option value="">เลือกวิธีชำระเงิน</option>
              {result.paymentTypes.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {noWithdrawType && (
              <p className="mt-1 text-xs text-expense">
                ยังไม่มีวิธีชำระเงินชื่อ &ldquo;เบิกใช้งาน&rdquo; — สร้างใน Loyverse Back Office → ตั้งค่า → ประเภทการชำระเงิน แล้วกดทดสอบใหม่
              </p>
            )}
          </div>
          <button type="button" onClick={save} disabled={!storeId || !paymentId || saving} className="btn-primary">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {saving ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        </div>
      )}
    </div>
  )
}
