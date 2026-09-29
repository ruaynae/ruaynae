import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'

export function signBody(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64')
}

export function signatureOk(
  rawBody: string,
  header: string | null,
  secret: string | null | undefined,
): boolean {
  if (!header || !secret) return false
  const want = Buffer.from(signBody(rawBody, secret))
  const got = Buffer.from(header)
  return want.length === got.length && timingSafeEqual(want, got)
}
