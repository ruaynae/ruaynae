'use client'

import { Copy, Link2, LayoutGrid, Loader2, Unlink } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

export type LinkedAccount = { id: string; display_name: string | null; created_at: string }

const NETWORK = 'เชื่อมต่อไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่'

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

/** ที่อยู่ webhook · รหัสผูกบัญชี · เมนูล่างของแชท */
export function LinkPanel({
  webhookUrl,
  hasKeys,
  hasToken,
  accounts,
}: {
  webhookUrl: string
  hasKeys: boolean
  hasToken: boolean
  accounts: LinkedAccount[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [code, setCode] = useState<string | null>(null)

  async function call(key: string, url: string, ok: (b: Record<string, unknown>) => void, fail: string, body?: unknown) {
    if (busy) return
    setBusy(key)
    try {
      const r = await fetch(url, {
        method: 'POST',
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) return toast.error(fail)
      ok(b)
    } catch {
      toast.error(NETWORK)
    } finally {
      setBusy(null)
    }
  }

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl)
      toast.success('คัดลอกแล้ว')
    } catch {
      toast.error('คัดลอกไม่ได้ — กดค้างที่ข้อความแล้วเลือกคัดลอก')
    }
  }

  return (
    <div className="space-y-5">
      {/* ── Webhook ─────────────────────────────────────────────── */}
      <section className="rounded-lg border border-line bg-surface">
        <div className="border-b border-line-soft px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">ที่อยู่รับข้อความ (Webhook URL)</h2>
          <p className="mt-0.5 text-xs text-muted-token">
            วางในหน้า Messaging API ของ LINE Developers แล้วเปิด &ldquo;Use webhook&rdquo;
            · ปิด &ldquo;Auto-reply messages&rdquo; และ &ldquo;Greeting message&rdquo;
          </p>
        </div>
        <div className="flex items-center gap-2 px-4 py-4">
          <code className="min-w-0 flex-1 truncate rounded-md bg-surface-2 px-3 py-2 text-sm text-ink-2">
            {webhookUrl}
          </code>
          <button type="button" onClick={copyUrl} className="btn-secondary shrink-0">
            <Copy className="size-4" />
            คัดลอก
          </button>
        </div>
        {!hasKeys && (
          <p className="border-t border-line-soft px-4 py-3 text-xs text-muted-token">
            ต้องบันทึกคีย์ด้านบนก่อน บอทจึงจะรับข้อความได้
          </p>
        )}
      </section>

      {/* ── ผูกบัญชี ───────────────────────────────────────────── */}
      <section className="rounded-lg border border-line bg-surface">
        <div className="border-b border-line-soft px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">ผูกบัญชี LINE ของเจ้าของ</h2>
          <p className="mt-0.5 text-xs text-muted-token">
            บอทตอบเฉพาะบัญชีที่ผูกไว้ · ผูกได้หลายบัญชี (ขอรหัสใหม่ทุกครั้งที่ผูกเพิ่ม) · แจ้งเตือนส่งเข้าทุกบัญชี
          </p>
        </div>
        <div className="space-y-3 px-4 py-4">
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-token">ยังไม่ได้ผูกบัญชี LINE</p>
          ) : (
            accounts.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{a.display_name ?? 'บัญชี LINE'}</p>
                  <p className="text-xs text-muted-token">ผูกเมื่อ {fmtDateTime(a.created_at)}</p>
                </div>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    call(`unlink:${a.id}`, '/api/settings/line/unlink', () => {
                      toast.success('เลิกผูกแล้ว')
                      router.refresh()
                    }, 'เลิกผูกไม่สำเร็จ', { id: a.id })
                  }
                  className="btn-secondary shrink-0"
                >
                  {busy === `unlink:${a.id}` ? <Loader2 className="size-4 animate-spin" /> : <Unlink className="size-4" />}
                  เลิกผูก
                </button>
              </div>
            ))
          )}

          {code && (
            <div className="rounded-md bg-surface-2 px-4 py-3">
              <p className="text-xs text-muted-token">พิมพ์เลขนี้ในแชทของบอท (ใช้ได้ 10 นาที ครั้งเดียว)</p>
              <p className="mt-1 text-3xl font-bold tabular-nums tracking-[0.25em] text-ink">{code}</p>
            </div>
          )}

          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              call('code', '/api/settings/line/link-code', (b) => {
                setCode(String(b.code ?? ''))
              }, 'ขอรหัสไม่สำเร็จ')
            }
            className="btn-primary"
          >
            {busy === 'code' ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
            {accounts.length === 0 ? 'ขอรหัสผูกบัญชี' : 'ขอรหัสผูกบัญชีเพิ่ม'}
          </button>
        </div>
      </section>

      {/* ── เมนูล่าง ───────────────────────────────────────────── */}
      <section className="rounded-lg border border-line bg-surface">
        <div className="border-b border-line-soft px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">เมนูล่างของแชท</h2>
          <p className="mt-0.5 text-xs text-muted-token">
            ปุ่ม 6 ช่อง: คีย์รายจ่าย · คนเข้างาน · รออนุมัติ · เบี้ยเลี้ยง · ค่าแรงคงค้าง · เปิดเว็บ · กดสร้างครั้งเดียว
            (กดซ้ำจะสร้างเมนูใหม่มาแทนของเดิม)
          </p>
        </div>
        <div className="px-4 py-4">
          <button
            type="button"
            disabled={busy !== null || !hasToken}
            onClick={() =>
              call('menu', '/api/settings/line/rich-menu', () => toast.success('สร้างเมนูล่างแล้ว'), 'สร้างเมนูไม่สำเร็จ — ตรวจ access token แล้วลองใหม่')
            }
            className="btn-primary"
          >
            {busy === 'menu' ? <Loader2 className="size-4 animate-spin" /> : <LayoutGrid className="size-4" />}
            {busy === 'menu' ? 'กำลังสร้าง…' : 'สร้างเมนูล่าง'}
          </button>
          {!hasToken && <p className="mt-2 text-xs text-muted-token">ตั้ง access token ก่อนจึงจะสร้างเมนูได้</p>}
        </div>
      </section>
    </div>
  )
}
