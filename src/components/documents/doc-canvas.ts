/**
 * วาดใบเสนอราคา/ใบแจ้งหนี้/ใบเสร็จ ลง canvas หน้า A4 ในเบราว์เซอร์ — ใช้สร้างไฟล์ PDF (แชร์เข้า LINE / บันทึกลงเครื่อง)
 *
 * ผังตาม `doc-paper.tsx` (กระดาษที่พิมพ์) ทุกกล่อง ทุกเส้น · ตัวเลข/ข้อความทุกอย่างอ่านจากสำเนาในแถว
 * (`doc` · `lines` · `seller`) เหมือนกระดาษ · เงินใช้ `money()` ตัวเดียวกับกระดาษ
 *
 * 🔴 ทำไมวาดเองแทนการถ่ายภาพหน้าจอ HTML: วิธีถ่าย HTML (SVG foreignObject) ทำให้ canvas
 * ถูกล็อก (tainted) บน Safari ของไอโฟนซึ่งเป็นเครื่องที่ใช้แชร์เข้า LINE จริง · `fillText` ของ canvas
 * ให้เบราว์เซอร์จัดสระ/วรรณยุกต์ไทยเอง และใช้ฟอนต์เดียวกับหน้าเว็บ
 * 🔴 แก้ผังกระดาษ (`doc-paper.tsx`) ต้องแก้ที่นี่คู่กัน
 */
import { DOC_KIND_LABEL, SECOND_DATE_LABEL } from '@/lib/documents'
import type { SellerSnapshot } from '@/lib/doc-server'
import { money, slashDate, SIGN_LABELS, type PaperDoc, type PaperLine } from './doc-paper'

/** A4 ที่ 96 dpi · ขอบกระดาษตามพิมพ์จริง (padding 12mm 14mm) */
export const PAGE_W = 794
export const PAGE_H = 1123
const SCALE = 2
const PAD_X = 53
const PAD_Y = 45
const CW = PAGE_W - PAD_X * 2
const PAGE_BOTTOM = PAGE_H - PAD_Y

const COLS = [8, 53, 11, 13, 15] as const
const HEAD_H = 34
const SIGN_H = 112
const MIN_TABLE_H = 160

type Ctx = CanvasRenderingContext2D
type Align = 'left' | 'center' | 'right'

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter('th', { granularity: 'word' })
    : null

/** ตัดบรรทัดตามความกว้าง — ไทยไม่มีเว้นวรรค จึงตัดตามคำ (Intl.Segmenter) · คำที่ยาวเกินช่องตัดทีละตัวอักษร */
function wrap(ctx: Ctx, text: string, rawMaxW: number): string[] {
  const maxW = rawMaxW * 0.97 // เผื่อความต่างของฟอนต์ระหว่างวัดกับวาด
  const out: string[] = []
  for (const para of text.split('\n')) {
    if (para === '') {
      out.push('')
      continue
    }
    const words = segmenter ? Array.from(segmenter.segment(para), (s) => s.segment) : Array.from(para)
    const tokens: string[] = []
    for (const w of words) {
      if (ctx.measureText(w).width > maxW) tokens.push(...Array.from(w))
      else tokens.push(w)
    }
    let cur = ''
    for (const t of tokens) {
      if (cur === '' || ctx.measureText(cur + t).width <= maxW) cur += t
      else {
        out.push(cur.trimEnd())
        cur = t.trimStart()
      }
    }
    out.push(cur.trimEnd())
  }
  return out
}

export async function drawDocPages(
  doc: PaperDoc,
  lines: PaperLine[],
  seller: SellerSnapshot | null,
): Promise<HTMLCanvasElement[]> {
  const family = getComputedStyle(document.body).fontFamily || 'sans-serif'
  // ฟอนต์ถูกโหลดเมื่อมีข้อความที่ใช้ตัวนั้นบนหน้าเท่านั้น — สั่งโหลดครบทุกน้ำหนักที่วาดก่อน ไม่งั้นตกไปฟอนต์สำรอง
  await Promise.all(
    ['400', '600', '700'].map((w) => document.fonts.load(`${w} 13px ${family}`, 'กขabc0123')),
  )
  await document.fonts.ready
  // Safari: ฟอนต์ที่โหลดแล้วยังต้อง "ถูกใช้วาด" สักครั้งก่อน measureText จะคืนความกว้างของตัวจริง
  // ไม่งั้นวัดด้วยฟอนต์สำรองแล้ววาดด้วยฟอนต์จริง (กว้างกว่า) → ข้อความล้นกรอบ
  const warm = document.createElement('canvas').getContext('2d')
  if (warm) {
    for (const w of [400, 600, 700]) {
      warm.font = `${w} 14px ${family}`
      warm.fillText('กขคabc0123ภาษาไทยใบเสร็จรับเงิน', 0, 14)
    }
    await new Promise((r) => setTimeout(r, 60))
  }

  const font = (size: number, weight: 400 | 600 | 700 = 400) => `${weight} ${size}px ${family}`
  const company = seller?.companyName ?? ''
  const hasVat = doc.vat_mode !== 'none'

  const canvases: HTMLCanvasElement[] = []
  const newPage = (): Ctx => {
    const c = document.createElement('canvas')
    c.width = PAGE_W * SCALE
    c.height = PAGE_H * SCALE
    const ctx = c.getContext('2d')
    if (!ctx) throw new Error('CANVAS_UNAVAILABLE')
    ctx.scale(SCALE, SCALE)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, PAGE_W, PAGE_H)
    ctx.fillStyle = '#000'
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 1
    ctx.textBaseline = 'middle'
    canvases.push(c)
    return ctx
  }

  // ── เครื่องมือวาด ──────────────────────────────────────────────
  const T = (
    ctx: Ctx,
    s: string,
    x: number,
    cy: number,
    o: { size?: number; weight?: 400 | 600 | 700; align?: Align; maxW?: number } = {},
  ) => {
    ctx.font = font(o.size ?? 13, o.weight ?? 400)
    ctx.fillStyle = '#000'
    // 🔴 ไม่ใช้ ctx.textAlign = center/right — Safari บนไอโฟนคำนวณความกว้างข้อความไทยตอนจัดชิดผิด
    // (ข้อความไทยเริ่มวาดที่จุดกึ่งกลางแล้วล้นออกขวา) · วัดเองด้วย measureText แล้ววาดชิดซ้ายที่ตำแหน่งที่คำนวณ
    ctx.textAlign = 'left'
    const raw = ctx.measureText(s).width
    const w = o.maxW !== undefined && o.maxW > 0 ? Math.min(raw, o.maxW) : raw
    const align = o.align ?? 'left'
    const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x
    // maxW = บีบตัวอักษรแนวนอนให้พอดีช่อง — กันล้นเมื่อฟอนต์กว้างกว่าที่วัดไว้
    if (o.maxW !== undefined && o.maxW > 0 && raw > o.maxW) ctx.fillText(s, left, cy, o.maxW)
    else ctx.fillText(s, left, cy)
  }
  const line = (ctx: Ctx, x1: number, y1: number, x2: number, y2: number, dotted = false) => {
    ctx.setLineDash(dotted ? [1, 2] : [])
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    ctx.setLineDash([])
  }
  const box = (ctx: Ctx, x: number, y: number, w: number, h: number) => ctx.strokeRect(x, y, w, h)
  /** วัดข้อความที่ขนาด/น้ำหนักที่จะวาด — `wrap` ต้องวัดด้วยฟอนต์เดียวกับตอนวาด */
  const measureWith = (ctx: Ctx, size: number, weight: 400 | 600 | 700) => {
    ctx.font = font(size, weight)
  }
  const wrapAt = (ctx: Ctx, s: string, maxW: number, size: number, weight: 400 | 600 | 700 = 400) => {
    measureWith(ctx, size, weight)
    return wrap(ctx, s, maxW)
  }
  const width = (ctx: Ctx, s: string, size: number, weight: 400 | 600 | 700 = 400) => {
    measureWith(ctx, size, weight)
    return ctx.measureText(s).width
  }
  const colEdges: number[] = []
  {
    let acc = 0
    for (const w of COLS) {
      colEdges.push(PAD_X + (CW * acc) / 100)
      acc += w
    }
    colEdges.push(PAD_X + CW)
  }

  // ── วัดทุกส่วนก่อนวาด (ต้องรู้ความสูงของส่วนท้ายเพื่อให้ตารางยืดลงถึงก้น) ─────
  const probe = newPage()
  canvases.pop() // canvas สำหรับวัดอย่างเดียว ไม่ใช่หน้าจริง

  // หัว
  const titleW = Math.min(width(probe, DOC_KIND_LABEL[doc.kind], 16, 700) + 32, CW * 0.55)
  const titleH = 48
  const nameLines = wrapAt(probe, `${company}${seller?.branchLabel ? ` ${seller.branchLabel}` : ''}`, CW - titleW - 16, 20, 700)
  const headH = Math.max(titleH, nameLines.length * 28)

  // ผู้ขาย
  const sellerLines: string[] = []
  if (seller?.address) {
    const pre = doc.kind === 'receipt' ? 'ที่อยู่ที่ได้จดทะเบียนภาษีมูลค่าเพิ่ม : ' : 'ที่อยู่ : '
    sellerLines.push(...wrapAt(probe, pre + seller.address, CW, 13))
  }
  if (seller?.phone || seller?.email) {
    sellerLines.push(`${seller.phone ? `โทร ${seller.phone}` : ''}${seller.phone && seller.email ? ' · ' : ''}${seller.email ?? ''}`)
  }
  if (seller?.taxId) sellerLines.push(`เลขประจำตัวผู้เสียภาษีอากร  ${seller.taxId}`)

  // ลูกค้า / เลขที่-วันที่
  const noW = 208
  const custW = CW - noW - 8
  const lblW = Math.max(width(probe, 'ชื่อลูกค้า / Customers', 12), width(probe, 'ที่อยู่ / Address', 12))
  const valW = custW - 16 - lblW - 8
  const nameVal = wrapAt(probe, doc.customer_name, valW, 13)
  const addrVal = wrapAt(probe, doc.customer_address ?? '', valW, 13)
  const taxText = `เลขประจำตัวผู้เสียภาษี  ${doc.customer_tax_id ?? ''}${doc.customer_branch ? ` · ${doc.customer_branch}` : ''}${doc.customer_phone ? ` · โทร ${doc.customer_phone}` : ''}`
  const taxLines = wrapAt(probe, taxText, custW - 16, 13)
  const nameRowH = Math.max(1, nameVal.length) * 18 + 4
  const addrRowH = Math.max(1, addrVal.length) * 18 + 4
  const custH = 8 + nameRowH + 4 + addrRowH + 4 + taxLines.length * 18 + 8
  const secondLabel = SECOND_DATE_LABEL[doc.kind]
  const noRows = 2 + (doc.valid_until && secondLabel ? 1 : 0)
  const noH = 16 + noRows * 26
  const infoH = Math.max(custH, noH)

  // ส่วนท้าย (ชำระเงิน/ยอดรวม · ตัวอักษร · ลายเซ็น · ท้ายกระดาษ)
  const totalsLeftW = (CW * 61) / 100
  const bankLines = seller?.bankAccount ? wrapAt(probe, seller.bankAccount, totalsLeftW - 12, 12) : []
  const leftNeed = (doc.kind === 'receipt' ? 104 : 0) + (bankLines.length ? bankLines.length * 16 + 8 : 0)
  const totalsH = Math.max(90, leftNeed + 8)
  const wordsLabelW = width(probe, 'ตัวอักษร', 12)
  const wordsBoxW = CW - wordsLabelW - 12
  const wordsLines = wrapAt(probe, `( ${doc.amount_words ?? ''} )`, wordsBoxW - 24, 13, 600)
  const wordsH = 8 + wordsLines.length * 18 + 10
  const footLines = seller?.footer ? wrapAt(probe, seller.footer, CW, 12) : []
  const footH = footLines.length ? 6 + footLines.length * 16 : 0
  const bottomH = totalsH + wordsH + 16 + SIGN_H + footH

  // แถวตาราง
  const descW = (CW * COLS[1]) / 100 - 12
  const qtyW = (CW * COLS[2]) / 100 - 8
  type Row = { h: number; draw: (ctx: Ctx, y: number) => void }
  const rows: Row[] = lines.map((l) => {
    const qty = Number(l.qty)
    const desc = wrapAt(probe, l.description, descW, 13)
    const qtyLines = wrapAt(probe, `${money(qty)}${l.unit ? ` ${l.unit}` : ''}`, qtyW, 13)
    const n = Math.max(desc.length, qtyLines.length, 1)
    return {
      h: n * 18 + 8,
      draw: (ctx, y) => {
        const cy = (i: number) => y + 6 + i * 18 + 9
        T(ctx, String(l.seq), (colEdges[0] + colEdges[1]) / 2, cy(0), { align: 'center', maxW: colEdges[1] - colEdges[0] - 6 })
        desc.forEach((d, i) => T(ctx, d, colEdges[1] + 6, cy(i)))
        qtyLines.forEach((d, i) => T(ctx, d, (colEdges[2] + colEdges[3]) / 2, cy(i), { align: 'center', maxW: colEdges[3] - colEdges[2] - 6 }))
        // ราคา/หน่วยที่พิมพ์คือยอดก่อน VAT ที่หารกลับแล้ว (เหมือนกระดาษ)
        T(ctx, money(qty > 0 ? Number(l.line_total) / qty : 0), colEdges[4] - 6, cy(0), { align: 'right', maxW: colEdges[4] - colEdges[3] - 8 })
        T(ctx, money(Number(l.line_total)), colEdges[5] - 6, cy(0), { align: 'right', maxW: colEdges[5] - colEdges[4] - 8 })
      },
    }
  })
  if (doc.note) {
    const noteLines = wrapAt(probe, doc.note, descW, 12)
    rows.push({
      h: 12 + noteLines.length * 16 + 4,
      draw: (ctx, y) => noteLines.forEach((d, i) => T(ctx, d, colEdges[1] + 6, y + 12 + i * 16 + 8, { size: 12 })),
    })
  }

  // ── จัดหน้า ───────────────────────────────────────────────────
  const firstTop = PAD_Y + headH + (sellerLines.length ? 8 + sellerLines.length * 18 : 0) + (doc.status === 'void' ? 8 + 24 : 0) + 8 + infoH + 8
  type PageRows = { top: number; rows: Row[] }
  const pages: PageRows[] = [{ top: firstTop, rows: [] }]
  let yy = firstTop + HEAD_H
  for (const r of rows) {
    if (yy + r.h > PAGE_BOTTOM && pages[pages.length - 1].rows.length > 0) {
      pages.push({ top: PAD_Y, rows: [] })
      yy = PAD_Y + HEAD_H
    }
    pages[pages.length - 1].rows.push(r)
    yy += r.h
  }
  // แถวสุดท้ายล้นเข้าไปในส่วนท้าย → ส่วนท้ายไปอยู่หน้าใหม่ที่ตารางว่าง
  let lastTop = pages[pages.length - 1].top
  const bottomLimit = PAGE_BOTTOM - bottomH
  if (yy > Math.max(bottomLimit, lastTop + HEAD_H)) {
    pages.push({ top: PAD_Y, rows: [] })
    lastTop = PAD_Y
  }

  // ── วาดทีละหน้า ───────────────────────────────────────────────
  pages.forEach((pg, pi) => {
    const ctx = newPage()
    const isLast = pi === pages.length - 1
    let y = PAD_Y

    if (pi === 0) {
      // หัว
      nameLines.forEach((s, i) => T(ctx, s, PAD_X, y + i * 28 + 14, { size: 20, weight: 700 }))
      box(ctx, PAD_X + CW - titleW, y, titleW, titleH)
      T(ctx, DOC_KIND_LABEL[doc.kind], PAD_X + CW - titleW / 2, y + titleH / 2, { size: 16, weight: 700, align: 'center', maxW: titleW - 12 })
      y += headH

      if (sellerLines.length) {
        y += 8
        sellerLines.forEach((s, i) => T(ctx, s, PAD_X, y + i * 18 + 9))
        y += sellerLines.length * 18
      }
      if (doc.status === 'void') {
        y += 8
        T(ctx, `** ยกเลิก — ${doc.void_reason ?? ''} **`, PAD_X + CW / 2, y + 12, { size: 16, weight: 700, align: 'center' })
        y += 24
      }

      // กรอบลูกค้า
      y += 8
      box(ctx, PAD_X, y, custW, infoH)
      let cy = y + 8
      T(ctx, 'ชื่อลูกค้า / Customers', PAD_X + 8, cy + 9, { size: 12 })
      nameVal.forEach((s, i) => T(ctx, s, PAD_X + 8 + lblW + 8, cy + i * 18 + 9))
      line(ctx, PAD_X + 8 + lblW + 8, cy + nameRowH - 1, PAD_X + custW - 8, cy + nameRowH - 1, true)
      cy += nameRowH + 4
      T(ctx, 'ที่อยู่ / Address', PAD_X + 8, cy + 9, { size: 12 })
      addrVal.forEach((s, i) => T(ctx, s, PAD_X + 8 + lblW + 8, cy + i * 18 + 9))
      line(ctx, PAD_X + 8 + lblW + 8, cy + addrRowH - 1, PAD_X + custW - 8, cy + addrRowH - 1, true)
      cy += addrRowH + 4
      taxLines.forEach((s, i) => T(ctx, s, PAD_X + 8, cy + i * 18 + 9))

      // กรอบเลขที่/วันที่
      const nx = PAD_X + custW + 8
      box(ctx, nx, y, noW, infoH)
      const kv: [string, string, boolean][] = [
        ['เลขที่ / No.', doc.doc_no ?? '—', true],
        ['วันที่ / Date', slashDate(doc.doc_date), false],
      ]
      if (doc.valid_until && secondLabel) kv.push([secondLabel, slashDate(doc.valid_until), false])
      kv.forEach(([k, v, bold], i) => {
        const ry = y + 8 + i * 26 + 13
        T(ctx, k, nx + 12, ry, { size: 12, maxW: noW * 0.5 })
        T(ctx, v, nx + noW - 12, ry, { weight: bold ? 700 : 400, align: 'right', maxW: noW * 0.6 })
      })
    }

    // ตาราง
    const tableTop = pg.top
    const bodyEnd = tableTop + HEAD_H + pg.rows.reduce((a, r) => a + r.h, 0)
    const tableBottom = isLast ? Math.max(PAGE_BOTTOM - bottomH, Math.min(tableTop + MIN_TABLE_H, PAGE_BOTTOM - bottomH), bodyEnd) : PAGE_BOTTOM
    box(ctx, PAD_X, tableTop, CW, tableBottom - tableTop)
    for (let i = 1; i < COLS.length; i++) line(ctx, colEdges[i], tableTop, colEdges[i], tableBottom)
    line(ctx, PAD_X, tableTop + HEAD_H, PAD_X + CW, tableTop + HEAD_H)
    const heads: [string, string][] = [
      ['ลำดับที่', 'Item'],
      ['รายการ', 'Description'],
      ['จำนวน', 'Quantity'],
      ['ราคา/หน่วย', 'Unit Price'],
      ['จำนวนเงิน', 'Amount'],
    ]
    heads.forEach(([a, b], i) => {
      const cx = (colEdges[i] + colEdges[i + 1]) / 2
      T(ctx, a, cx, tableTop + 10, { size: 12, align: 'center', maxW: colEdges[i + 1] - colEdges[i] - 6 })
      T(ctx, b, cx, tableTop + 24, { size: 12, align: 'center', maxW: colEdges[i + 1] - colEdges[i] - 6 })
    })
    let ry = tableTop + HEAD_H
    for (const r of pg.rows) {
      r.draw(ctx, ry)
      ry += r.h
    }

    if (!isLast) return

    // ชำระเงิน / ยอดรวม
    const gy = tableBottom
    const c1 = PAD_X + totalsLeftW
    const c2 = PAD_X + (CW * 85) / 100
    const rh = totalsH / 3
    line(ctx, PAD_X, gy, PAD_X, gy + totalsH)
    line(ctx, PAD_X + CW, gy, PAD_X + CW, gy + totalsH)
    line(ctx, PAD_X, gy + totalsH, PAD_X + CW, gy + totalsH)
    line(ctx, c1, gy, c1, gy + totalsH)
    line(ctx, c2, gy, c2, gy + totalsH)
    line(ctx, c1, gy + rh, PAD_X + CW, gy + rh)
    line(ctx, c1, gy + rh * 2, PAD_X + CW, gy + rh * 2)
    ctx.fillStyle = '#e4e4e4'
    ctx.fillRect(c1 + 1, gy + rh * 2 + 1, c2 - c1 - 1, rh - 2)
    ctx.fillStyle = '#000'
    const cell = (a: string, b: string, row: number, weight: 400 | 600 = 400) => {
      const cy2 = gy + rh * row + rh / 2
      T(ctx, a, (c1 + c2) / 2, cy2 - 8, { size: 12, weight, align: 'center', maxW: c2 - c1 - 8 })
      T(ctx, b, (c1 + c2) / 2, cy2 + 8, { size: 12, weight, align: 'center', maxW: c2 - c1 - 8 })
    }
    cell('รวมเงิน', 'TOTAL', 0)
    T(ctx, money(Number(doc.subtotal)), PAD_X + CW - 6, gy + rh / 2, { align: 'right', maxW: PAD_X + CW - c2 - 10 })
    if (hasVat) {
      cell('ภาษีมูลค่าเพิ่ม', `( VAT ${Math.round(Number(doc.vat_rate) * 100)}% )`, 1)
      T(ctx, money(Number(doc.vat_amount)), PAD_X + CW - 6, gy + rh * 1.5, { align: 'right', maxW: PAD_X + CW - c2 - 10 })
    }
    cell('ยอดเงินสุทธิ', 'NET AMOUNT', 2, 600)
    T(ctx, money(Number(doc.total)), PAD_X + CW - 6, gy + rh * 2.5, { weight: 700, align: 'right', maxW: PAD_X + CW - c2 - 10 })

    // ช่องรับชำระเงิน (ใบเสร็จ) + บัญชีธนาคาร
    let ly = gy + 8
    if (doc.kind === 'receipt') {
      const check = (x: number, y2: number, label: string) => {
        ctx.strokeRect(x, y2 - 5, 10, 10)
        T(ctx, label, x + 15, y2, { size: 12 })
      }
      T(ctx, 'รายการรับชำระเงิน', PAD_X + 6, ly + 8, { size: 12 })
      check(PAD_X + 130, ly + 8, 'เงินสด')
      check(PAD_X + 200, ly + 8, 'เงินโอน')
      check(PAD_X + 275, ly + 8, 'เช็ค')
      const field = (label: string, x: number, y2: number, w: number) => {
        T(ctx, label, x, y2, { size: 12 })
        const lx = x + width(probe, label, 12) + 4
        line(ctx, lx, y2 + 8, lx + w, y2 + 8, true)
      }
      field('ธนาคาร/Bank', PAD_X + 6, ly + 34, 90)
      field('เลขที่/Chq #', PAD_X + 6 + totalsLeftW / 2, ly + 34, 80)
      field('สาขา/Branch', PAD_X + 6, ly + 58, 90)
      field('ลว./Date', PAD_X + 6 + totalsLeftW / 2, ly + 58, 90)
      field('จำนวนเงิน/Amount', PAD_X + 6, ly + 82, 190)
      ly += 104
    }
    bankLines.forEach((s, i) => T(ctx, s, PAD_X + 6, ly + 8 + i * 16, { size: 12 }))

    // ตัวอักษร
    let wy = gy + totalsH + 8
    T(ctx, 'ตัวอักษร', PAD_X, wy + (wordsH - 8 - 10) / 2 + 5, { size: 12 })
    box(ctx, PAD_X + wordsLabelW + 12, wy, wordsBoxW, wordsH - 8)
    wordsLines.forEach((s, i) =>
      T(ctx, s, PAD_X + wordsLabelW + 12 + 12, wy + 5 + i * 18 + 9, { weight: 600 }),
    )
    wy = gy + totalsH + wordsH

    // ลายเซ็น — ดันลงก้นกระดาษ
    const sy = PAGE_BOTTOM - footH - SIGN_H
    void wy
    const sw = [CW / 4, CW / 4, CW / 2]
    const labels = SIGN_LABELS[doc.kind]
    let sx = PAD_X
    sw.forEach((w, i) => {
      box(ctx, sx, sy, w, SIGN_H)
      if (i < 2) {
        T(ctx, labels[i], sx + w / 2, sy + 12, { size: 12, weight: 600, align: 'center' })
        T(ctx, 'วันที่ ..................................', sx + 8, sy + SIGN_H - 12, { size: 12 })
      } else {
        wrapAt(ctx, `ในนาม ${company}`, w - 16, 12, 600).forEach((s, k) =>
          T(ctx, s, sx + w / 2, sy + 12 + k * 16, { size: 12, weight: 600, align: 'center' }),
        )
        const hasTitle = Boolean(seller?.signatoryTitle)
        const nameY = sy + SIGN_H - 12 - (hasTitle ? 16 : 0)
        line(ctx, sx + 8, nameY - 9, sx + w - 8, nameY - 9, true)
        T(ctx, seller?.signatoryName ? `(${seller.signatoryName})` : ' ', sx + w / 2, nameY, { size: 12, align: 'center' })
        if (hasTitle) T(ctx, seller?.signatoryTitle ?? '', sx + w / 2, nameY + 16, { size: 12, align: 'center' })
      }
      sx += w
    })
    footLines.forEach((s, i) => T(ctx, s, PAD_X + CW / 2, PAGE_BOTTOM - footH + 6 + i * 16 + 8, { size: 12, align: 'center' }))
  })

  return canvases
}

/** canvas → ไบต์ JPEG (ใช้ห่อเป็น PDF) */
export async function canvasToJpeg(c: HTMLCanvasElement, quality = 0.92): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', quality))
  if (!blob) throw new Error('JPEG_FAILED')
  return new Uint8Array(await blob.arrayBuffer())
}
