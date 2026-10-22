import type { ReactNode } from 'react'
import { OwnerOnly } from '@/components/owner-only-layout'

/**
 * คลังเอกสาร (R21) — สัญญาและ BOQ มีค่างาน/ราคากลางทั้งก้อน · ของเจ้าของเหมือน site_finance
 * · เช็ค role ที่ layout ไม่ใช่ที่ page (CLAUDE.md §17 ข้อ 6)
 */
export default function Layout({ children }: { children: ReactNode }) {
  return <OwnerOnly>{children}</OwnerOnly>
}
