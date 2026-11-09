/**
 * วาดรายงานรายรับ-รายจ่ายรายโครงการ ลง canvas หน้า A4 ในเบราว์เซอร์ — ใช้สร้าง PDF (แชร์เข้า LINE / บันทึกลงเครื่อง)
 * วิธีเดียวกับ `documents/doc-canvas.ts` (วาดเอง ไม่ถ่าย HTML — Safari ไอโฟนล็อก canvas ถ้าถ่าย HTML · จัดชิดขวา/กลางด้วยการวัดเอง)
 * ⚠️ ตัวหนังสือใน PDF เป็นรูป เลือก/ค้นหาไม่ได้
 */
import { ST_NOTE, stMoney, stTotals, type StatementData } from '@/lib/site-statement'

export const PAGE_W = 794
export const PAGE_H = 1123
const SCALE = 2
const PAD_X = 45
const PAD_Y = 42
const CW = PAGE_W - PAD_X * 2
const BOTTOM = PAGE_H - PAD_Y - 18

type Ctx = CanvasRenderingContext2D
type W = 400 | 600 | 700

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('th', { granularity: 'word' }) : null

function wrap(ctx: Ctx, text: string, rawMaxW: number): string[] {
  const maxW = rawMaxW * 0.97
  const out: string[] = []
  for (const para of text.split('\n')) {
    if (!para) { out.push(''); continue }
    const words = segmenter ? Array.from(segmenter.segment(para), (s) => s.segment) : Array.from(para)
    const tokens: string[] = []
    for (const w of words) tokens.push(...(ctx.measureText(w).width > maxW ? Array.from(w) : [w]))
    let cur = ''
    for (const t of tokens) {
      if (cur === '' || ctx.measureText(cur + t).width <= maxW) cur += t
      else { out.push(cur.trimEnd()); cur = t.trimStart() }
    }
    out.push(cur.trimEnd())
  }
  return out
}

export async function drawStatementPages(d: StatementData): Promise<HTMLCanvasElement[]> {
  const family = getComputedStyle(document.body).fontFamily || 'sans-serif'
  await Promise.all(['400', '600', '700'].map((w) => document.fonts.load(`${w} 13px ${family}`, 'กขabc0123')))
  await document.fonts.ready
  const warm = document.createElement('canvas').getContext('2d')
  if (warm) {
    for (const w of [400, 600, 700]) { warm.font = `${w} 14px ${family}`; warm.fillText('กขคabc0123รายรับรายจ่าย', 0, 14) }
    await new Promise((r) => setTimeout(r, 60))
  }
  const font = (size: number, weight: W = 400) => `${weight} ${size}px ${family}`

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
  const T = (ctx: Ctx, s: string, x: number, cy: number, o: { size?: number; weight?: W; align?: 'left' | 'center' | 'right'; maxW?: number; color?: string } = {}) => {
    ctx.font = font(o.size ?? 13, o.weight ?? 400)
    ctx.fillStyle = o.color ?? '#000'
    ctx.textAlign = 'left'
    const raw = ctx.measureText(s).width
    const w = o.maxW && o.maxW > 0 ? Math.min(raw, o.maxW) : raw
    const left = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x
    if (o.maxW && o.maxW > 0 && raw > o.maxW) ctx.fillText(s, left, cy, o.maxW)
    else ctx.fillText(s, left, cy)
  }
  const hline = (ctx: Ctx, y: number, x1 = PAD_X, x2 = PAD_X + CW, color = '#000') => {
    ctx.strokeStyle = color
    ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke()
    ctx.strokeStyle = '#000'
  }
  const wrapAt = (ctx: Ctx, s: string, maxW: number, size: number, weight: W = 400) => { ctx.font = font(size, weight); return wrap(ctx, s, maxW) }

  const t = stTotals(d)
  const probe = newPage()
  canvases.pop()

  // คอลัมน์ตารางรายการ: วันที่ · รายการ · รายรับ · รายจ่าย
  const colW = [CW * 0.13, CW * 0.47, CW * 0.2, CW * 0.2]
  const colX = [PAD_X, PAD_X + colW[0], PAD_X + colW[0] + colW[1], PAD_X + colW[0] + colW[1] + colW[2]]
  const colEnd = PAD_X + CW
  const TXT = 13
  const LH = 19

  let ctx = newPage()
  let y = PAD_Y

  // ── หัวรายงาน ──
  T(ctx, d.company, PAD_X, y + 10, { size: 18, weight: 700, maxW: CW })
  y += 30
  T(ctx, 'รายงานรายรับ-รายจ่าย', PAD_X, y + 10, { size: 16, weight: 700 })
  y += 28
  for (const l of wrapAt(probe, `โครงการ: ${d.siteName}${d.client ? ` · ลูกค้า: ${d.client}` : ''}`, CW, 14, 600)) {
    T(ctx, l, PAD_X, y + 9, { size: 14, weight: 600 }); y += 22
  }
  T(ctx, `ช่วงเวลา: ${d.range}   ·   พิมพ์เมื่อ: ${d.printed}`, PAD_X, y + 9, { size: 12, color: '#444' })
  y += 26

  // ── กล่องสรุป 3 ช่อง ──
  const bw = (CW - 20) / 3
  const boxes: [string, number, string][] = [['รายรับรวม', t.income, '#0f7a3a'], ['รายจ่ายรวม', t.expense, '#b42318'], ['คงเหลือ (รับ − จ่าย)', t.balance, t.balance < 0 ? '#b42318' : '#1d4ed8']]
  boxes.forEach(([label, v, color], i) => {
    const x = PAD_X + i * (bw + 10)
    ctx.strokeRect(x, y, bw, 58)
    T(ctx, label, x + 10, y + 16, { size: 12, color: '#444' })
    T(ctx, `${v < 0 ? '-' : ''}฿${stMoney(Math.abs(v))}`, x + 10, y + 40, { size: 17, weight: 700, color, maxW: bw - 20 })
  })
  y += 78

  // ── สรุปตามหมวด ──
  const catBlock = (title: string, cats: StatementData['income']) => {
    if (!cats.length) return
    if (y + 60 > BOTTOM) { ctx = newPage(); y = PAD_Y }
    T(ctx, title, PAD_X, y + 9, { size: 14, weight: 700 }); y += 22
    hline(ctx, y)
    for (const c of cats) {
      if (y + LH + 4 > BOTTOM) { ctx = newPage(); y = PAD_Y }
      y += LH / 2 + 3
      T(ctx, `${c.name}  (${c.count} รายการ)`, PAD_X + 4, y, { size: TXT, maxW: CW * 0.7 })
      T(ctx, stMoney(c.total), colEnd - 4, y, { size: TXT, align: 'right' })
      y += LH / 2 + 3
      hline(ctx, y, PAD_X, colEnd, '#ccc')
    }
    y += 14
  }
  catBlock('สรุปรายรับตามหมวด', d.income)
  catBlock('สรุปรายจ่ายตามหมวด', d.expense)

  // ── ตารางรายการ ──
  const header = () => {
    if (y + 60 > BOTTOM) { ctx = newPage(); y = PAD_Y }
    T(ctx, 'รายการทั้งหมด', PAD_X, y + 9, { size: 14, weight: 700 }); y += 22
    return headRow()
  }
  const headRow = () => {
    ctx.fillStyle = '#e5e7eb'
    ctx.fillRect(PAD_X, y, CW, 26)
    ctx.fillStyle = '#000'
    ctx.strokeRect(PAD_X, y, CW, 26)
    T(ctx, 'วันที่', colX[0] + 6, y + 13, { size: 12, weight: 700 })
    T(ctx, 'รายการ', colX[1] + 6, y + 13, { size: 12, weight: 700 })
    T(ctx, 'รายรับ (บาท)', colEnd - colW[3] - 6, y + 13, { size: 12, weight: 700, align: 'right' })
    T(ctx, 'รายจ่าย (บาท)', colEnd - 6, y + 13, { size: 12, weight: 700, align: 'right' })
    y += 26
  }
  header()
  if (!d.rows.length) {
    T(ctx, 'ไม่มีรายการในช่วงนี้', PAD_X + CW / 2, y + 22, { size: 13, align: 'center', color: '#666' })
    y += 44
  }
  for (const r of d.rows) {
    const lines = wrapAt(probe, r.text, colW[1] - 12, TXT)
    const h = Math.max(1, lines.length) * LH + 6
    if (y + h > BOTTOM) { ctx = newPage(); y = PAD_Y; headRow() }
    ctx.strokeRect(PAD_X, y, CW, h)
    for (const x of colX.slice(1)) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + h); ctx.stroke() }
    T(ctx, r.date, colX[0] + 6, y + LH / 2 + 3, { size: 12, maxW: colW[0] - 10 })
    lines.forEach((l, i) => T(ctx, l, colX[1] + 6, y + LH / 2 + 3 + i * LH, { size: TXT }))
    if (r.income != null) T(ctx, stMoney(r.income), colEnd - colW[3] - 6, y + LH / 2 + 3, { size: TXT, align: 'right', color: '#0f7a3a' })
    if (r.expense != null) T(ctx, stMoney(r.expense), colEnd - 6, y + LH / 2 + 3, { size: TXT, align: 'right', color: '#b42318' })
    y += h
  }
  // รวมท้ายตาราง
  if (y + 34 > BOTTOM) { ctx = newPage(); y = PAD_Y }
  ctx.fillStyle = '#f3f4f6'
  ctx.fillRect(PAD_X, y, CW, 28)
  ctx.fillStyle = '#000'
  ctx.strokeRect(PAD_X, y, CW, 28)
  T(ctx, 'รวม', colX[1] + 6, y + 14, { size: TXT, weight: 700 })
  T(ctx, stMoney(t.income), colEnd - colW[3] - 6, y + 14, { size: TXT, weight: 700, align: 'right' })
  T(ctx, stMoney(t.expense), colEnd - 6, y + 14, { size: TXT, weight: 700, align: 'right' })
  y += 40
  const notes = [ST_NOTE, ...(d.truncated ? ['แสดงไม่ครบ — รายการเกินเพดานที่รายงานรองรับ · ใช้ช่วงวันที่ที่สั้นลง'] : [])]
  for (const n of notes) for (const l of wrapAt(probe, n, CW, 12)) {
    if (y + 20 > BOTTOM) { ctx = newPage(); y = PAD_Y }
    T(ctx, l, PAD_X, y + 8, { size: 12, color: '#555' }); y += 18
  }

  // เลขหน้า
  canvases.forEach((c, i) => {
    const g = c.getContext('2d')
    if (!g) return
    g.textBaseline = 'middle'
    T(g, `หน้า ${i + 1}/${canvases.length}`, PAD_X + CW, PAGE_H - PAD_Y + 4, { size: 11, align: 'right', color: '#666' })
  })
  return canvases
}

export async function canvasToJpeg(c: HTMLCanvasElement, quality = 0.92): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', quality))
  if (!blob) throw new Error('JPEG_FAILED')
  return new Uint8Array(await blob.arrayBuffer())
}
