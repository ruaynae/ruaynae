import type { ReactNode } from 'react'
import { OwnerOnly } from '@/components/owner-only-layout'

export default function LineSettingsLayout({ children }: { children: ReactNode }) {
  return <OwnerOnly to="/settings">{children}</OwnerOnly>
}
