import type { ReactNode } from 'react'
import { OwnerOnly } from '@/components/owner-only-layout'

/**
 * แผนงานก่อสร้างมีค่างานต้นทุนของทุกหมวด — ของเจ้าของเหมือนเอกสารและหนังสือ
 * · เช็ค role ที่ layout ไม่ใช่ที่ page (CLAUDE.md §17 ข้อ 6)
 */
export default function Layout({ children }: { children: ReactNode }) {
  return <OwnerOnly>{children}</OwnerOnly>
}
