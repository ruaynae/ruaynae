import { Gauge } from 'lucide-react'
import { Suspense } from 'react'
import { Skeleton } from '@/components/ui/states'
import { fmtMoney } from '@/lib/format'
import { getQuota, type LineQuota } from '@/lib/line/client'

/**
 * โควตาข้อความ push ของเดือนนี้ (เหมือนหน้าตั้งค่าของระบบหวย)
 *
 * นับเฉพาะ push · reply ที่บอทตอบเมื่อเจ้าของพิมพ์มาไม่กินโควตา
 * LINE ล่ม/คีย์ผิด ต้องไม่ทำให้หน้าตั้งค่าทั้งหน้าพัง (ต้องกรอกคีย์ใหม่ได้จากหน้านี้)
 */

type State = LineQuota | 'error' | null

async function readQuota(hasToken: boolean): Promise<State> {
  if (!hasToken) return null
  try {
    return await getQuota()
  } catch {
    return 'error'
  }
}

function Body({ state }: { state: State }) {
  if (state === null) {
    return <p className="px-4 py-4 text-sm text-muted-token">ตั้ง access token ก่อนจึงจะเห็นโควตา</p>
  }
  if (state === 'error') {
    return <p className="px-4 py-4 text-sm text-expense">อ่านโควตาจาก LINE ไม่ได้ ลองโหลดหน้าใหม่</p>
  }
  if (state.limit === null) {
    return (
      <p className="px-4 py-4 text-sm text-ink-2">
        ไม่จำกัดจำนวน · เดือนนี้ใช้ไป <span className="tabular-nums">{fmtMoney(state.used)}</span> ข้อความ
      </p>
    )
  }
  const left = Math.max(0, state.limit - state.used)
  const pct = state.limit > 0 ? Math.min(100, Math.round((state.used / state.limit) * 100)) : 100
  const low = state.limit > 0 && left / state.limit <= 0.1
  return (
    <div className="px-4 py-4">
      <p className="text-sm text-ink-2">
        เหลือ <span className={`font-semibold tabular-nums ${low ? 'text-expense' : 'text-ink'}`}>{fmtMoney(left)}</span>{' '}
        จาก <span className="tabular-nums">{fmtMoney(state.limit)}</span> ข้อความ · ใช้ไป{' '}
        <span className="tabular-nums">{fmtMoney(state.used)}</span>
      </p>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={state.limit}
        aria-valuenow={Math.min(state.used, state.limit)}
        aria-label="โควตาข้อความที่ใช้ไป"
      >
        <div className={`h-full ${low ? 'bg-expense-ring' : 'bg-brand'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

async function QuotaBody({ hasToken }: { hasToken: boolean }) {
  return <Body state={await readQuota(hasToken)} />
}

export function QuotaCard({ hasToken }: { hasToken: boolean }) {
  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className="flex items-center gap-2.5 border-b border-line-soft px-4 py-3">
        <Gauge className="size-4 shrink-0 text-brand" strokeWidth={1.8} />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">โควตาข้อความเดือนนี้</h2>
          <p className="mt-0.5 text-xs text-muted-token">
            นับเฉพาะข้อความที่บอทส่งหาเจ้าของเอง (แจ้งเตือน) · ที่บอทตอบเมื่อพิมพ์มาไม่นับ
          </p>
        </div>
      </div>
      <Suspense fallback={<Skeleton className="m-4 h-10 w-64 max-w-full" />}>
        <QuotaBody hasToken={hasToken} />
      </Suspense>
    </section>
  )
}
