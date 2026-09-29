import { MessageCircle } from 'lucide-react'
import { headers } from 'next/headers'
import { DataError } from '@/components/ui/data-error'
import { PageHeader } from '@/components/ui/page-header'
import { PAGE_SIZE } from '@/lib/constants'
import { getSupabaseServer } from '@/lib/supabase/server'
import { KeysForm, type KeyState } from './keys-form'
import { LinkPanel } from './link-panel'
import { QuotaCard } from './quota-card'

export const metadata = { title: 'LINE บอท' }

type KeyStatus = { channel_secret: KeyState; access_token: KeyState }

/**
 * ตั้งค่า LINE บอท (เจ้าของเท่านั้น — ด่านอยู่ใน layout.tsx)
 * คีย์ทั้งสองตัวเก็บใน Supabase Vault ไม่ใช่ env/Vercel
 */
export default async function LineSettingsPage() {
  const sb = await getSupabaseServer()
  const [status, accounts] = await Promise.all([
    sb.rpc('line_key_status'),
    sb
      .from('line_accounts')
      .select('id, display_name, created_at')
      .order('created_at', { ascending: false })
      .range(0, PAGE_SIZE - 1),
  ])

  if (status.error || accounts.error) {
    console.error('[line-settings] อ่านค่าไม่ได้', status.error?.message ?? accounts.error?.message)
    return (
      <div className="space-y-5">
        <PageHeader title="LINE บอท" backHref="/settings" className="mb-0" />
        <DataError message="โหลดการตั้งค่า LINE ไม่สำเร็จ" />
      </div>
    )
  }

  const keys = status.data as unknown as KeyStatus
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  const webhookUrl = `${proto}://${host}/api/line/webhook`

  return (
    <div className="space-y-5">
      <PageHeader
        title="LINE บอท"
        subtitle="สั่งงานและอนุมัติจากแชท LINE · ใช้ได้เฉพาะเจ้าของ"
        backHref="/settings"
        className="mb-0"
      />

      <section className="rounded-lg border border-line bg-surface">
        <div className="flex items-center gap-2.5 border-b border-line-soft px-4 py-3">
          <MessageCircle className="size-4 shrink-0 text-brand" strokeWidth={1.8} />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">คีย์เชื่อมต่อ LINE</h2>
            <p className="mt-0.5 text-xs text-muted-token">
              คัดลอกจาก LINE Developers · เก็บเข้ารหัสในฐานข้อมูล หน้านี้เห็นได้แค่ 4 ตัวท้าย
            </p>
          </div>
        </div>
        <KeysForm secret={keys.channel_secret} token={keys.access_token} />
      </section>

      <QuotaCard hasToken={keys.access_token.set} />

      <LinkPanel
        webhookUrl={webhookUrl}
        hasKeys={keys.channel_secret.set && keys.access_token.set}
        hasToken={keys.access_token.set}
        accounts={accounts.data ?? []}
      />
    </div>
  )
}
