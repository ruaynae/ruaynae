import 'server-only'

import { fmtDateTime } from '@/lib/format'
import { compose, textImage, type Rendered } from '@/lib/line/render'
import { baht, thaiDate } from './util'

// ใบสรุปค่าแรงคงค้างของคนหนึ่งคน (รูป PNG ที่เจ้าของส่งต่อให้คนงานได้)
// ตัวเลขทุกตัวมาจาก bot_wage_detail() = payroll_balances() สูตรเดียวกับหน้า /payroll

export type WageDetail = {
  ok: true
  company: string | null
  name: string
  job: string | null
  days: number
  base: number
  extra: number
  deduct: number
  accrued: number
  owed: number
  advanced: number
  balance: number
  from: string | null
  to: string | null
  sites: { name: string; units: number; amount: number }[]
  adjustments: { name: string; kind: 'add' | 'deduct'; times: number; total: number }[]
  owed_items: OwedItem[]
  owed_count: number
  advances: { date: string; amount: number; open: number }[]
  advance_count: number
}

type OwedItem = { date: string; amount: number; category: string | null; site: string | null; note: string | null }

const W = 1080
const PAD = 56
const INNER = W - PAD * 2
const INK = '#0f172a'
const MUTED = '#64748b'
const BRAND = '#1d4ed8'
const LINE = '#e2e8f0'
const MAX_ROWS = 25

const n = (v: unknown) => Number(v ?? 0) || 0
const units = (v: number) => new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }).format(v)

type Block =
  | { kind: 'text'; img: Rendered; gap: number }
  | { kind: 'row'; left: Rendered; right: Rendered; gap: number }
  | { kind: 'rule'; gap: number }
  | { kind: 'total'; left: Rendered; right: Rendered; gap: number; bg: string }

async function row(label: string, value: string, o: { bold?: boolean; color?: string; size?: number } = {}) {
  const size = o.size ?? 30
  const weight = o.bold ? ('bold' as const) : ('regular' as const)
  const right = await textImage(value, { size, color: o.color ?? INK, weight, strut: 'start' })
  const left = await textImage(label, { size, color: INK, weight, width: INNER - right.width - 32 })
  return { left, right }
}

export async function wageSlipImage(d: WageDetail, now = new Date()): Promise<Buffer> {
  const items = Array.isArray(d.owed_items) ? d.owed_items : []
  const blocks: Block[] = []
  const text = async (body: string, size: number, color = INK, gap = 8, bold = false) =>
    blocks.push({ kind: 'text', img: await textImage(body, { size, color, weight: bold ? 'bold' : 'regular', width: INNER }), gap })

  if (d.company) await text(d.company, 28, BRAND, 0, true)
  await text('สรุปค่าแรงคงค้าง', 36, INK, 6, true)
  await text(d.name, 56, INK, 4, true)
  if (d.job) await text(d.job, 28, MUTED, 2)
  const period = d.from && d.to ? (d.from === d.to ? thaiDate(d.from) : `${thaiDate(d.from)} – ${thaiDate(d.to)}`) : null
  if (period) await text(`งานที่ยังไม่ได้จ่าย: ${period}`, 26, MUTED, 4)
  await text(`ข้อมูล ณ ${fmtDateTime(now.toISOString())}`, 26, MUTED, 2)
  blocks.push({ kind: 'rule', gap: 24 })

  // ── ค่าแรง ─────────────────────────────────────────────────────────
  await text(`ค่าแรง · ${units(n(d.days))} แรง`, 34, INK, 20, true)
  for (const s of d.sites.slice(0, MAX_ROWS)) {
    const r = await row(`${s.name} · ${units(n(s.units))} แรง`, baht(n(s.amount)))
    blocks.push({ kind: 'row', ...r, gap: 0 })
  }
  for (const a of d.adjustments) {
    const add = a.kind === 'add'
    const r = await row(`${add ? '+' : '−'} ${a.name} × ${a.times}`, `${add ? '' : '−'}${baht(n(a.total))}`)
    blocks.push({ kind: 'row', ...r, gap: 0 })
  }
  blocks.push({ kind: 'row', ...(await row('รวมค่าแรง', baht(n(d.accrued)), { bold: true })), gap: 14 })

  // ── ออกเงินให้ก่อน ─────────────────────────────────────────────────
  if (n(d.owed) > 0) {
    blocks.push({ kind: 'rule', gap: 20 })
    await text('ออกเงินให้บริษัทก่อน (คืนให้)', 34, INK, 20, true)
    for (const o of items.slice(0, MAX_ROWS)) {
      const label = [thaiDate(o.date), o.category, o.note ?? o.site].filter(Boolean).join(' · ')
      blocks.push({ kind: 'row', ...(await row(label, baht(n(o.amount)))), gap: 0 })
    }
    if (n(d.owed_count) > items.length) await text(`และอีก ${n(d.owed_count) - items.length} รายการ`, 26, MUTED, 8)
    blocks.push({ kind: 'row', ...(await row('รวมที่ออกให้ก่อน', `+${baht(n(d.owed))}`, { bold: true })), gap: 14 })
  }

  // ── เบิกล่วงหน้า ───────────────────────────────────────────────────
  if (n(d.advanced) > 0) {
    blocks.push({ kind: 'rule', gap: 20 })
    await text('เบิกล่วงหน้า (หักคืน)', 34, INK, 20, true)
    for (const a of d.advances.slice(0, MAX_ROWS)) {
      const partial = n(a.open) < n(a.amount)
      const label = partial ? `${thaiDate(a.date)} · เบิก ${baht(n(a.amount))} เหลือหัก` : thaiDate(a.date)
      blocks.push({ kind: 'row', ...(await row(label, `−${baht(n(a.open))}`)), gap: 0 })
    }
    if (n(d.advance_count) > d.advances.length) {
      await text(`และอีก ${n(d.advance_count) - d.advances.length} ใบ`, 26, MUTED, 8)
    }
    blocks.push({ kind: 'row', ...(await row('รวมเบิก', `−${baht(n(d.advanced))}`, { bold: true })), gap: 14 })
  }

  // ── ยอดสุดท้าย ─────────────────────────────────────────────────────
  const bal = n(d.balance)
  const over = bal < 0
  const color = over ? '#b91c1c' : '#15803d'
  const t = await row(over ? 'เบิกเกิน (หักรอบหน้า)' : 'คงเหลือต้องจ่าย', baht(Math.abs(bal)), { bold: true, color, size: 44 })
  blocks.push({ kind: 'total', ...t, gap: 32, bg: over ? '#fef2f2' : '#f0fdf4' })
  await text('ยอดก่อนกดจ่ายค่าแรง ถ้ามีการลงชื่อหรือเบิกเพิ่ม ยอดจะเปลี่ยนตาม', 24, MUTED, 20)

  // ── วางตำแหน่ง ─────────────────────────────────────────────────────
  const boxes: Parameters<typeof compose>[3] = []
  const layers: Parameters<typeof compose>[4] = []
  let y = PAD
  for (const b of blocks) {
    y += b.gap
    if (b.kind === 'text') {
      layers.push({ input: b.img.input, top: y, left: PAD })
      y += b.img.height
    } else if (b.kind === 'rule') {
      boxes.push({ x: PAD, y, w: INNER, h: 3, fill: LINE })
      y += 3
    } else if (b.kind === 'row') {
      const h = Math.max(b.left.height, b.right.height)
      layers.push({ input: b.left.input, top: y, left: PAD }, { input: b.right.input, top: y, left: W - PAD - b.right.width })
      y += h
    } else {
      const padY = 26
      const h = Math.max(b.left.height, b.right.height) + padY * 2
      boxes.push({ x: PAD - 20, y, w: INNER + 40, h, fill: b.bg, r: 20 })
      layers.push(
        { input: b.left.input, top: y + padY, left: PAD + 8 },
        { input: b.right.input, top: y + padY, left: W - PAD - 8 - b.right.width },
      )
      y += h
    }
  }
  return compose(W, y + PAD, '#ffffff', boxes, layers)
}
