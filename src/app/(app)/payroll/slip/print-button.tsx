'use client'

import { Printer } from 'lucide-react'

/** พิมพ์เฉพาะกระดาษ (`.paper`) — กติกาใน globals.css ซ่อนเปลือกแอปให้เอง */
export function SlipPrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="btn-secondary px-4 py-2">
      <Printer className="size-4" />
      พิมพ์
    </button>
  )
}
