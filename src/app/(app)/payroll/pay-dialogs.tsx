'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { Gift, Loader2, Plus, Wallet, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { fmtBaht } from '@/lib/format'
import { parseBonus, payError, payNet } from '@/lib/payroll'
import { monthKey, monthShort, nextMonth } from '@/lib/wage-month'

/** ยอดของคนหนึ่งคนที่กล่องจ่ายต้องใช้ — ตัวเลขทั้งหมดมาจาก `payroll_balances_through(สิ้นเดือนที่จ่าย)` */
export type PayRow = {
  employee_id: string
  full_name: string
  days: number
  accrued: number
  /** เงินที่ออกให้บริษัทก่อน (อนุมัติแล้ว ยังไม่คืน) */
  owed: number
  advanced: number
}

const slipHref = (today: string) => `/payroll/slip?date=${today}`

async function post(url: string, body: unknown) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const b = await r.json().catch(() => ({}))
  return { ok: r.ok, body: b as Record<string, unknown> }
}

/**
 * กล่องจ่ายรายคน
 *
 * 🔴 ต้องเห็นทุกบรรทัดก่อนกด — จ่ายแล้ว **ย้อนกลับไม่ได้** (วันที่จ่ายแล้วถูกล็อก
 * แก้ค่าแรงย้อนหลังไม่ได้อีก) · ยอด "จ่ายจริง" ที่เห็นถูกส่งไปเป็น `expected`
 * ถ้าระหว่างนั้นมีคนลงชื่อ/อนุมัติแทรก ฐานข้อมูลจะปฏิเสธ ไม่จ่ายตัวเลขอื่น
 * · `month` = จ่ายถึงสิ้นเดือนนั้น — งาน/เบิกของเดือนถัดไปไม่ถูกนับ (คำขอเจ้าของ 2 ต.ค. 2569)
 */
export function PayOneDialog({
  row,
  today,
  month,
  onClose,
}: {
  row: PayRow | null
  today: string
  month: string
  onClose: () => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [showBonus, setShowBonus] = useState(false)
  const [bonusText, setBonusText] = useState('')
  const [error, setError] = useState('')

  const bonus = parseBonus(bonusText)
  const calc = row ? payNet({ ...row, bonus: bonus ?? 0 }) : null
  const leftOver = row && calc ? Math.max(0, row.advanced - calc.deducted) : 0

  const reset = () => {
    setShowBonus(false)
    setBonusText('')
    setError('')
  }

  const confirm = async () => {
    if (!row || !calc || bonus === null || busy) return
    setBusy(true)
    setError('')
    try {
      const { ok, body } = await post('/api/payroll/pay', {
        employeeId: row.employee_id,
        bonus,
        expected: calc.net,
        month: monthKey(month),
      })
      if (!ok) {
        const msg = payError(body.error as string)
        setError(msg)
        toast.error(msg)
        return
      }
      toast.success(`จ่ายให้ ${row.full_name} แล้ว ${fmtBaht(Number(body.paid ?? 0))}`, {
        action: { label: 'ดูใบสรุป', onClick: () => router.push(slipHref(today)) },
      })
      reset()
      onClose()
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root
      open={row !== null}
      onOpenChange={(v) => {
        if (busy) return
        if (!v) {
          reset()
          onClose()
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90svh] w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-line bg-surface p-5 shadow-e3 animate-pop-in">
          <Dialog.Title className="text-lg font-bold text-ink">จ่ายเงิน — {row?.full_name}</Dialog.Title>
          <Dialog.Description className="mt-0.5 text-sm text-muted-token">
            {row && row.days > 0
              ? `ค่าแรงถึงสิ้นเดือน ${monthShort(month)} · ${row.days} วัน`
              : `ไม่มีวันทำงานค้างถึงสิ้นเดือน ${monthShort(month)} — จ่ายเฉพาะยอดอื่น`}
          </Dialog.Description>

          {row && calc && (
            <dl className="mt-4 space-y-1.5 rounded-lg border border-line-soft bg-surface-2 px-3.5 py-3 text-sm">
              <Line label="ค่าแรง" value={fmtBaht(row.accrued)} />
              {row.owed > 0 && (
                <Line label="คืนเงินที่ออกให้ก่อน" hint="ไม่นับซ้ำเป็นต้นทุน" value={'+ ' + fmtBaht(row.owed)} tone="income" />
              )}
              {(bonus ?? 0) > 0 && <Line label="โบนัส" value={'+ ' + fmtBaht(bonus ?? 0)} tone="income" />}
              <Line label="หักเบิกล่วงหน้า" value={'− ' + fmtBaht(calc.deducted)} tone="muted" />
              <div className="flex items-baseline justify-between gap-2 border-t border-line-soft pt-1.5">
                <dt className="font-medium text-ink-2">จ่ายจริงวันนี้</dt>
                <dd className="tnum text-base font-bold text-income">{fmtBaht(calc.net)}</dd>
              </div>
              {leftOver > 0 && (
                <p className="text-xs text-urgent">
                  ยังเบิกเกินค้าง {fmtBaht(leftOver)} · เป็นเบิกล่วงหน้าของเดือน {monthShort(nextMonth(month))}
                </p>
              )}
            </dl>
          )}

          {/* โบนัสปีละครั้ง (คำตอบเจ้าของ 29 ก.ย. 2569) — ซ่อนไว้ ไม่ให้เกะกะทุกวัน */}
          {showBonus ? (
            <div className="mt-3">
              <label htmlFor="pay-bonus" className="label-base">โบนัส (บาท)</label>
              <input
                id="pay-bonus"
                type="text"
                inputMode="decimal"
                value={bonusText}
                onChange={(e) => setBonusText(e.target.value)}
                placeholder="0"
                aria-invalid={bonus === null ? 'true' : undefined}
                className="input-base tnum"
                autoFocus
              />
              {bonus === null && <p className="mt-1 text-sm text-urgent">ยอดโบนัสไม่ถูกต้อง</p>}
              <p className="mt-1 text-xs text-muted-token">ลงเป็นรายจ่ายส่วนกลางหมวดโบนัสให้อัตโนมัติ</p>
            </div>
          ) : (
            <button type="button" onClick={() => setShowBonus(true)} className="btn-ghost mt-2 px-2 text-sm">
              <Plus className="size-4" /> โบนัส
            </button>
          )}

          <p className="mt-2 text-xs text-muted-token">
            จ่ายแล้ววันทำงานเหล่านี้จะถูกล็อก แก้ค่าแรงย้อนหลังไม่ได้อีก · ยอดนี้ไม่ทำให้ต้นทุนโครงการเพิ่ม
          </p>
          {error && <p className="mt-2 text-sm text-urgent">{error}</p>}

          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close disabled={busy} className="btn-secondary">ยกเลิก</Dialog.Close>
            <button
              type="button"
              onClick={confirm}
              disabled={busy || bonus === null || !calc || calc.pool <= 0}
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Wallet className="size-4" />}
              ยืนยันจ่าย
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/**
 * ปุ่ม + กล่อง "จ่ายทุกคน" (คำตอบเจ้าของข้อ 6)
 *
 * ติ๊กไว้ทุกคนที่มีอะไรต้องจ่าย · เอาบางคนออกได้ก่อนยืนยัน
 * 🔴 ทรานแซกชันเดียว — ใครคนหนึ่งล้ม ไม่มีใครถูกจ่ายเลย และบอกชื่อคนที่ติด
 */
export function PayAllButton({ rows, today, month }: { rows: PayRow[]; today: string; month: string }) {
  const router = useRouter()
  const payable = useMemo(() => rows.filter((r) => r.accrued > 0 || r.owed > 0), [rows])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [off, setOff] = useState<Set<string>>(new Set())
  const [showBonus, setShowBonus] = useState(false)
  const [bonusText, setBonusText] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  const lines = payable.map((r) => {
    const bonus = parseBonus(bonusText[r.employee_id] ?? '')
    return { row: r, bonus, calc: payNet({ ...r, bonus: bonus ?? 0 }), on: !off.has(r.employee_id) }
  })
  const chosen = lines.filter((l) => l.on)
  const total = chosen.reduce((s, l) => s + l.calc.net, 0)
  const invalid = chosen.some((l) => l.bonus === null)

  const toggle = (id: string) =>
    setOff((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const confirm = async () => {
    if (busy || chosen.length === 0 || invalid) return
    setBusy(true)
    setError('')
    try {
      const { ok, body } = await post('/api/payroll/pay-all', {
        items: chosen.map((l) => ({ employeeId: l.row.employee_id, bonus: l.bonus ?? 0, expected: l.calc.net })),
        month: monthKey(month),
      })
      if (!ok) {
        const who = typeof body.name === 'string' ? `${body.name}: ` : ''
        const msg = who + payError(body.error as string) + ' · ยังไม่มีใครถูกจ่าย'
        setError(msg)
        toast.error(msg)
        return
      }
      toast.success(`จ่ายแล้ว ${Number(body.people ?? 0)} คน รวม ${fmtBaht(Number(body.paid ?? 0))}`)
      setOpen(false)
      router.push(slipHref(today))
      router.refresh()
    } catch {
      toast.error('เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่')
    } finally {
      setBusy(false)
    }
  }

  if (payable.length === 0) return null

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (busy) return
        setOpen(v)
        if (v) {
          setOff(new Set())
          setShowBonus(false)
          setBonusText({})
          setError('')
        }
      }}
    >
      <Dialog.Trigger className="btn-primary">
        <Wallet className="size-4" />
        จ่ายทุกคน
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[90svh] w-[min(32rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-e3 animate-pop-in">
          <div className="border-b border-line-soft px-4 py-3">
            <Dialog.Title className="text-lg font-bold text-ink">จ่ายทุกคน — ถึงสิ้นเดือน {monthShort(month)}</Dialog.Title>
            <Dialog.Description className="mt-0.5 text-sm text-muted-token">
              เอาติ๊กออกสำหรับคนที่ยังไม่จ่ายวันนี้ · ยอดคือเงินสดหลังหักเบิกของเดือนนั้นแล้ว
            </Dialog.Description>
          </div>

          <ul className="min-h-0 flex-1 overflow-y-auto">
            {lines.map(({ row: r, bonus, calc, on }) => (
              <li key={r.employee_id} className="border-b border-line-soft px-4 py-2.5 last:border-b-0">
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(r.employee_id)}
                    disabled={busy}
                    className="size-5 shrink-0 accent-brand"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{r.full_name}</span>
                    <span className="block truncate text-xs text-muted-token">
                      ค่าแรง {fmtBaht(r.accrued)}
                      {r.owed > 0 && ` · คืน ${fmtBaht(r.owed)}`}
                      {(bonus ?? 0) > 0 && ` · โบนัส ${fmtBaht(bonus ?? 0)}`}
                      {calc.deducted > 0 && ` · หักเบิก ${fmtBaht(calc.deducted)}`}
                    </span>
                  </span>
                  <span className={'shrink-0 tnum font-bold ' + (on ? 'text-income' : 'text-muted-token line-through')}>
                    {fmtBaht(calc.net)}
                  </span>
                </label>
                {showBonus && on && (
                  <div className="mt-1.5 flex items-center gap-2 pl-8">
                    <Gift className="size-4 shrink-0 text-muted-token" aria-hidden />
                    <input
                      type="text"
                      inputMode="decimal"
                      value={bonusText[r.employee_id] ?? ''}
                      onChange={(e) => setBonusText((cur) => ({ ...cur, [r.employee_id]: e.target.value }))}
                      placeholder="โบนัส (ไม่บังคับ)"
                      aria-label={`โบนัสของ ${r.full_name}`}
                      aria-invalid={bonus === null ? 'true' : undefined}
                      className="input-base py-1.5 tnum"
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>

          <div className="space-y-2 border-t border-line-soft p-3">
            {!showBonus && (
              <button type="button" onClick={() => setShowBonus(true)} className="btn-ghost px-2 text-sm">
                <Plus className="size-4" /> ใส่โบนัส
              </button>
            )}
            {invalid && <p className="text-sm text-urgent">มีช่องโบนัสที่ไม่ใช่ตัวเลข</p>}
            {error && <p className="text-sm text-urgent">{error}</p>}
            <div className="flex items-center gap-2">
              <Dialog.Close disabled={busy} className="btn-secondary">
                <X className="size-4" /> ยกเลิก
              </Dialog.Close>
              <button
                type="button"
                onClick={confirm}
                disabled={busy || chosen.length === 0 || invalid}
                className="btn-primary ml-auto disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Wallet className="size-4" />}
                จ่าย {chosen.length} คน <span className="tnum">{fmtBaht(total)}</span>
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Line({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'income' | 'muted'
}) {
  const color = tone === 'income' ? 'text-income' : tone === 'muted' ? 'text-muted-token' : 'text-ink'
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-token">
        {label}
        {hint && <span className="block text-[11px]">{hint}</span>}
      </dt>
      <dd className={'shrink-0 tnum ' + color}>{value}</dd>
    </div>
  )
}
