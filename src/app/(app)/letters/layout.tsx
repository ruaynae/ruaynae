import type { ReactNode } from 'react'
import { OwnerOnly } from '@/components/owner-only-layout'

/**
 * หนังสือบริษัทออกในนามห้างและลงชื่อผู้ลงนาม — เจ้าของเท่านั้น (R19 · D1)
 * · เช็ค role ที่ layout ไม่ใช่ที่ page — ไม่งั้น `loading.tsx` จะกลืนการเด้ง
 *   แล้วหัวข้อความกลายเป็น 200 (CLAUDE.md §17 ข้อ 6)
 */
export default function Layout({ children }: { children: ReactNode }) {
  return <OwnerOnly>{children}</OwnerOnly>
}
