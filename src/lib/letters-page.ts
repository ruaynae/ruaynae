import 'server-only'

import { getBranding } from '@/lib/branding'
import { getSupabaseServer } from '@/lib/supabase/server'
import { todayInBangkok } from '@/lib/format'
import { currentLetterhead } from '@/lib/letters-server'
import type { RegisterEntry } from '@/lib/letters'
import type { FormLetter, SeriesOption } from '@/components/letters/letter-form'
import type { SiteContract } from '@/components/letters/letter-contract-picker'

/**
 * ข้อมูลที่ฟอร์มหนังสือต้องใช้ — โหลดพร้อมกันทั้งก้อน (หน้า `/letters/new` และ `/letters/[id]`)
 *
 * ทะเบียนส่งไปแค่ 1,000 ฉบับล่าสุด (เพดานของ PostgREST · §7) — พอสำหรับเลขถัดไป
 * ของปีนี้ ตัวนับ "ครั้งที่" และกล่องอ้างถึง · เลขซ้ำที่หลุดรอดถูกกันที่ฐานข้อมูลอีกชั้น
 */
export async function loadLetterFormContext() {
  const sb = await getSupabaseServer()
  const [seriesRes, entriesRes, letterhead, branding, sitesRes, fullRes, financeRes] = await Promise.all([
    sb
      .from('letter_series')
      .select('id, label, prefix, site_id, recipient, contract_ref, intro, signer_title, is_active')
      .order('label', { ascending: true })
      .range(0, 199),
    sb
      .from('letters')
      .select('id, series_id, seq, year_ce, letter_date, subject')
      .order('letter_date', { ascending: false })
      .order('seq', { ascending: false })
      .range(0, 999),
    currentLetterhead(),
    getBranding(),
    // "อ้างถึงสัญญาของโครงการ" — เลขที่/วันที่สัญญาอยู่ที่ `site_finance` (เจ้าของเท่านั้น เหมือนเมนูนี้)
    sb.from('sites').select('id, name, status, address').order('name', { ascending: true }).range(0, 499),
    // ชื่อเต็มอ่านแยก — ยังไม่รัน migration `20261022120000` ฟอร์มหนังสือต้องไม่พัง (ใช้ชื่อย่อแทน)
    sb.from('sites').select('id, full_name').order('id').range(0, 499),
    sb.from('site_finance').select('site_id, contract_no, contract_date').order('site_id').range(0, 499),
  ])
  if (sitesRes.error) console.error('[letters] อ่านรายชื่อโครงการไม่ได้', sitesRes.error.message)
  if (financeRes.error) console.error('[letters] อ่านสัญญาโครงการไม่ได้', financeRes.error.message)
  if (fullRes.error) console.error('[letters] อ่านชื่อโครงการเต็มไม่ได้', fullRes.error.message)
  const fullNames = new Map((fullRes.data ?? []).map((r) => [r.id, r.full_name]))
  const finance = new Map((financeRes.data ?? []).map((f) => [f.site_id, f]))
  const contracts: SiteContract[] = (sitesRes.data ?? []).map((s) => ({
    siteId: s.id,
    name: s.name,
    fullName: fullNames.get(s.id)?.trim() || null,
    address: s.address?.trim() || null,
    active: s.status !== 'done' && s.status !== 'cancelled',
    contractNo: finance.get(s.id)?.contract_no?.trim() || null,
    contractDate: finance.get(s.id)?.contract_date ?? null,
  }))
  if (seriesRes.error) console.error('[letters] อ่านชุดเลขไม่ได้', seriesRes.error.message)
  if (entriesRes.error) console.error('[letters] อ่านทะเบียนไม่ได้', entriesRes.error.message)

  const series: SeriesOption[] = (seriesRes.data ?? []).map((s) => ({
    id: s.id,
    label: s.label,
    prefix: s.prefix,
    siteId: s.site_id,
    recipient: s.recipient,
    contractRef: s.contract_ref,
    intro: s.intro,
    signerTitle: s.signer_title,
    isActive: s.is_active,
  }))
  const entries: RegisterEntry[] = (entriesRes.data ?? []).map((e) => ({
    id: e.id,
    seriesId: e.series_id,
    seq: e.seq,
    yearCe: e.year_ce ?? Number(e.letter_date.slice(0, 4)),
    date: e.letter_date,
    subject: e.subject,
  }))

  return {
    series,
    entries,
    contracts,
    letterhead,
    logoUrl: branding.logoUrl,
    today: todayInBangkok(),
    failed: Boolean(seriesRes.error || entriesRes.error),
  }
}

export const LETTER_COLUMNS =
  'id, series_id, seq, letter_date, subject, recipient, refs, attachments, body, closing, intro, signer_title, show_receipt, template_id, fields, letterhead'

type LetterRowData = {
  id: string
  series_id: string
  seq: number
  letter_date: string
  subject: string
  recipient: string
  refs: string[]
  attachments: string[]
  body: string
  closing: string
  intro: string | null
  signer_title: string
  show_receipt: boolean
  template_id: string | null
  fields: unknown
}

export function toFormLetter(r: LetterRowData): FormLetter {
  const fields: Record<string, string> = {}
  if (r.fields && typeof r.fields === 'object' && !Array.isArray(r.fields)) {
    for (const [k, v] of Object.entries(r.fields as Record<string, unknown>)) fields[k] = String(v ?? '')
  }
  return {
    id: r.id,
    seriesId: r.series_id,
    seq: r.seq,
    date: r.letter_date,
    subject: r.subject,
    recipient: r.recipient,
    refs: r.refs,
    attachments: r.attachments,
    body: r.body,
    closing: r.closing,
    intro: r.intro,
    signerTitle: r.signer_title,
    showReceipt: r.show_receipt,
    templateId: r.template_id,
    fields,
  }
}
