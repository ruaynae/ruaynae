/**
 * แผนงานก่อสร้างจาก BOQ — ส่วนคำนวณล้วน (ไม่มี I/O ไม่ผูก exceljs)
 *
 * อ่านแบบ ปร.6 → ปร.5 → ปร.4 · จับคู่ด้วย **ยอดเงิน** ไม่ใช่ชื่อชีต เพราะไฟล์ BOQ
 * จริงมักมีชีตของโครงการอื่น/ชีตเทียบราคาค้างอยู่ (ไฟล์ตัวอย่างของเจ้าของมี 16 ชีต
 * ใช้จริง 6) · จัดลำดับงานตามช่วงของขั้นตอนก่อสร้าง แล้วกระจายน้ำหนักรายสัปดาห์
 * ด้วยสูตรเดียวกับที่เขียนลง Excel (`distribute` ↔ สูตรในแถว Plan ของ `workbook.ts`)
 */

import type { ProgressReport } from './progress-core'

/** ตารางของชีตหนึ่ง — `v` = ค่าดิบ (ตัวเลข/ข้อความ) · `w` = ข้อความที่ตัดช่องว่างแล้ว */
export type Grid = {
  name: string
  rows: number
  cols: number
  v: (r: number, c: number) => unknown
  w: (r: number, c: number) => string
}

/** รายการย่อยใน ปร.4 — ใช้เป็นแบบฟอร์ม "ปริมาณงานที่แล้วเสร็จ" */
export type BoqItem = { code: string; name: string; qty: number | null; unit: string; amount: number }

export type BoqTask = {
  name: string
  amount: number
  source: string
  /** ไม่มีรายละเอียดใน ปร.4 หรือรวมแล้วไม่ตรงยอด = งานนั้นทั้งก้อนเป็นรายการเดียว */
  items: BoqItem[]
  /** วันเริ่ม นับจากวันเริ่มสัญญา (0 = วันแรก) */
  offset: number
  dur: number
  on: boolean
}
export type BoqCategory = {
  name: string
  source: string
  tasks: BoqTask[]
  /** ตัวคูณจากค่างานต้นทุนเป็นค่าก่อสร้าง: Factor F (งานก่อสร้าง) หรือ 1 + VAT (ครุภัณฑ์) — ตามแบบ ปร.5 ของหมวด */
  mult: number
  /** ชื่อกลุ่มตามแบบ ปร.5 เช่น "แบบสรุปค่าก่อสร้าง" · "แบบสรุปค่าครุภัณฑ์จัดซื้อ" */
  group: string
}
export type BoqProject = {
  name: string
  owner: string
  loc1: string
  loc2: string
  code: string
  total: number | null
}
export type BoqModel = {
  project: BoqProject
  factor: number | null
  vat: number | null
  categories: BoqCategory[]
  warnings: string[]
}

export const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim()
const squash = (s: unknown) => norm(s).replace(/[\s()（）\-–_.,:]/g, '')
const isCode = (s: string) => /^\d+(\.\d+)*$/.test(s)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** ความคล้ายของชื่อ 0..1 — bigram Dice หลังตัดช่องว่าง/วงเล็บ */
export function similarity(a: string, b: string): number {
  const x = squash(a)
  const y = squash(b)
  if (!x || !y) return 0
  if (x === y) return 1
  if (x.includes(y) || y.includes(x)) return 0.85
  const grams = (s: string) => {
    const g = new Set<string>()
    for (let i = 0; i < s.length - 1; i += 1) g.add(s.slice(i, i + 2))
    return g
  }
  const A = grams(x)
  const B = grams(y)
  let n = 0
  A.forEach((t) => { if (B.has(t)) n += 1 })
  return (2 * n) / (A.size + B.size || 1)
}

/** ป้ายในคอลัมน์ A–C แล้วค่าอยู่ช่องแรกที่ไม่ว่างทางขวา */
function findLabel(g: Grid, re: RegExp, maxRow = 40): { r: number; text: string } | null {
  for (let r = 0; r < Math.min(g.rows, maxRow); r += 1) {
    for (let c = 0; c < 3; c += 1) {
      const t = g.w(r, c)
      if (!re.test(t)) continue
      for (let k = c + 1; k < g.cols; k += 1) {
        const x = g.w(r, k)
        if (x) return { r, text: x }
      }
      const rest = t.replace(re, '').trim()
      if (rest) return { r, text: rest }
    }
  }
  return null
}

const projectName = (g: Grid) =>
  (findLabel(g, /ชื่อโครงการ\s*\/?\s*(งานก่อสร้าง)?/, 15)?.text ?? '')
    .replace(/^ชื่อโครงการ\s*\/?\s*งานก่อสร้าง\s*/, '')
    .trim()

// ---- ปร.4: ก้อนสรุปหัวชีต "N หมวด…" ตามด้วย "N.k รายการ … ยอดรวม"
type Child = { code: string; name: string; amount: number; items: BoqItem[] }
type Block = { sheet: string; name: string; children: Child[]; sum: number }

function amountCol(g: Grid): number {
  for (let r = 0; r < Math.min(g.rows, 14); r += 1)
    for (let c = 0; c < g.cols; c += 1) if (/รวมค่าวัสดุ|รวมเป็นเงิน|รวมค่าครุภัณฑ์/.test(g.w(r, c))) return c
  return 8
}

function pr4Blocks(g: Grid): Block[] {
  const amt = amountCol(g)
  const out: Block[] = []
  for (let r = 0; r < g.rows && out.length < 3; r += 1) {
    const code = g.w(r, 0)
    if (!/^\d+$/.test(code) || !g.w(r, 1)) continue
    const children: Block['children'] = []
    let blanks = 0
    for (let k = r + 1; k < g.rows; k += 1) {
      const cc = g.w(k, 0)
      const nm = g.w(k, 1)
      if (!cc && !nm) {
        blanks += 1
        if (blanks > 2) break
        continue
      }
      if (!(cc.startsWith(code + '.') && isCode(cc) && nm)) break
      let a = num(g.v(k, amt))
      if (a == null) {
        const f = num(g.v(k, 5)) ?? 0
        const h = num(g.v(k, 7)) ?? 0
        if (f || h) a = f + h
      }
      if (a == null) break
      children.push({ code: cc, name: nm, amount: a, items: [] })
      blanks = 0
    }
    if (children.length) {
      const end = r + children.length
      for (const ch of children) ch.items = detailItems(g, amt, ch, end)
      out.push({ sheet: g.name, name: g.w(r, 1), children, sum: children.reduce((s, x) => s + x.amount, 0) })
      r += children.length
    }
  }
  return out
}

/**
 * รายการย่อยของงาน "N.k" ในส่วนรายละเอียดใต้ก้อนสรุป — แถวที่มีทั้งจำนวนและยอดเงิน
 * · แถวคำอธิบายต่อท้าย (ไม่มีจำนวน) และแถว "รวม…" ถูกข้ามเอง
 * · 🔴 รวมแล้วต้องเท่ายอดของงาน ไม่งั้นทิ้งทั้งหมด (ป้องกันนับซ้ำจากหัวข้อย่อยที่มียอดรวมของตัวเอง)
 */
function detailItems(g: Grid, amt: number, ch: Child, after: number): BoqItem[] {
  let r = after + 1
  while (r < g.rows && g.w(r, 0) !== ch.code) r += 1
  if (r >= g.rows) return []
  const depth = ch.code.split('.').length
  const items: BoqItem[] = []
  for (let k = r + 1; k < Math.min(g.rows, r + 600); k += 1) {
    const cc = g.w(k, 0)
    if (isCode(cc) && cc.split('.').length <= depth) break
    const name = g.w(k, 1).replace(/^[-–•]\s*/, '')
    const qty = num(g.v(k, 2))
    const a = num(g.v(k, amt))
    if (!name || qty == null || a == null || a <= 0 || /^รวม/.test(name)) continue
    items.push({ code: isCode(cc) ? cc : '', name, qty, unit: g.w(k, 3), amount: a })
  }
  const sum = items.reduce((s, x) => s + x.amount, 0)
  return Math.abs(sum - ch.amount) <= Math.max(1, ch.amount * 0.005) ? items : []
}

// ---- ปร.5: "N รายการ ค่างานต้นทุน"
type Pr5 = {
  sheet: string
  label: string
  project: string
  items: { name: string; amount: number }[]
  factor: number | null
  vat: number | null
}

function pr5Info(g: Grid): Pr5 {
  let costCol = 2
  let head = -1
  // หัวคอลัมน์ "ค่างานต้นทุน" ก่อน · แบบสรุปค่าครุภัณฑ์ (ปร.2 (ก) แบบเก่า) ใช้ "ค่าครุภัณฑ์"
  for (const re of [/^ค่างานต้นทุน/, /^ค่าครุภัณ/]) {
    hunt: for (let r = 0; r < Math.min(g.rows, 20); r += 1) {
      // แถวหัวตารางเท่านั้น (มีช่อง "รายการ") — แบบเก่ามีหัวรอง "ค่างานต้นทุน" ใต้ชื่อแบบด้วย
      let isHead = false
      for (let c = 0; c < g.cols; c += 1) if (/^รายการ/.test(g.w(r, c))) isHead = true
      if (!isHead) continue
      for (let c = 0; c < g.cols; c += 1)
        if (re.test(g.w(r, c))) {
          costCol = c
          head = r
          break hunt
        }
    }
    if (head >= 0) break
  }
  const items: Pr5['items'] = []
  let factor: number | null = null
  let vat: number | null = null
  let rowFactor: number | null = null
  let rowVat: number | null = null
  for (let r = head + 1; r < g.rows; r += 1) {
    const a = g.w(r, 0)
    const b = g.w(r, 1)
    const cost = num(g.v(r, costCol))
    if (/^\d+$/.test(a) && b && cost != null) {
      items.push({ name: b.replace(/^[-–•]\s*/, ''), amount: cost })
      // แบบเก่าไม่มีแถว "รวมค่างานต้นทุน" — Factor F / VAT อยู่คอลัมน์ถัดจากค่างานต้นทุนของแต่ละแถว
      const d = num(g.v(r, costCol + 1))
      if (d != null && d > 1 && d < 2) rowFactor = d
      else if (d != null && d > 0 && d < 1) rowVat = d
    }
    if (/รวมค่างานต้นทุน|รวมค่าครุภัณฑ์จัดซื้อทั้งหมด/.test(`${a} ${b}`)) {
      const d = num(g.v(r, costCol + 1))
      if (d != null) {
        if (d > 1) factor = d
        else vat = d
      }
    }
  }
  let label = ''
  // คอลัมน์ B ก่อน (แบบ ปร.5 ปัจจุบัน) แล้วค่อยคอลัมน์อื่น (แบบเก่าวางหัวชีตที่คอลัมน์ A)
  for (const c of [1, 0, 2, 3])
    for (let r = 0; r < Math.min(g.rows, 20) && !label; r += 1) if (/^แบบสรุป/.test(g.w(r, c))) label = g.w(r, c)
  return {
    sheet: g.name, label: label || g.w(0, 0) || g.name, project: projectName(g), items,
    factor: factor ?? rowFactor, vat: factor == null && vat == null ? rowVat : vat,
  }
}

const isPr6 = (n: string) => /ปร\.?\s*6/.test(n)
const isPr5 = (n: string) => /ปร\.?\s*5/.test(n)
/** ข้อความหัวชีต (5 แถวแรก) — ชื่อชีตเชื่อไม่ได้: ไฟล์แบบเก่าตั้งชื่อ "ปร.4 (ก)" ให้แบบสรุปค่าก่อสร้าง */
const headText = (g: Grid) => {
  const t: string[] = []
  for (let r = 0; r < Math.min(g.rows, 5); r += 1) for (let c = 0; c < Math.min(g.cols, 8); c += 1) t.push(g.w(r, c))
  return t.join(' ')
}
const isDetailSheet = (g: Grid) => /แบบแสดงรายการ\s*ปริมาณงาน/.test(headText(g))
const isPr6Sheet = (g: Grid) => isPr6(g.name) || /แบบสรุปราคากลาง/.test(headText(g))
/** แบบสรุปรายหมวด (ปร.5 / ปร.1 (ก) / ปร.2 (ก) แบบเก่า) — ดูจากหัวชีตก่อนชื่อชีต */
const isSummarySheet = (g: Grid) =>
  !isPr6Sheet(g) && !isDetailSheet(g) && (isPr5(g.name) || /แบบสรุป\s*(ค่าก่อสร้าง|ค่าครุภัณฑ์|งานครุภัณฑ์)/.test(headText(g)))
const stripDash = (s: string) => s.replace(/^[-–•]\s*/, '')

/**
 * แบบรายละเอียดที่ไม่มีก้อนสรุปหัวชีต (ปร.4 แบบเก่า): "กลุ่มงาน…" → "N งาน…" → รายการ → "รวม…"
 * · คืนงานในช่วงแถว [from, to) — หัวข้อเลขจำนวนเต็มที่ไม่มีจำนวน = งานหนึ่งงาน · รายการ = แถวที่มีจำนวนและยอดเงิน
 * · รายการก่อนหัวข้อแรก (ไม่มีหัวข้อเลย) รวมเป็นงานชื่อ `fallback`
 */
function sectionTasks(g: Grid, amt: number, from: number, to: number, fallback: string) {
  const out: { name: string; items: BoqItem[] }[] = []
  let cur: (typeof out)[number] | null = null
  for (let r = from; r < to; r += 1) {
    const code = g.w(r, 0)
    const name = g.w(r, 1)
    const qty = num(g.v(r, 2))
    if (/^\d+$/.test(code) && name && qty == null) {
      cur = { name: stripDash(name), items: [] }
      out.push(cur)
      continue
    }
    const a = num(g.v(r, amt))
    if (!name || qty == null || a == null || a <= 0 || /^รวม/.test(name)) continue
    if (!cur) {
      cur = { name: fallback, items: [] }
      out.push(cur)
    }
    cur.items.push({ code: isCode(code) ? code : '', name: stripDash(name), qty, unit: g.w(r, 3), amount: a })
  }
  return out.filter((t) => t.items.length)
}
const task = (name: string, amount: number, source: string, items: BoqItem[] = []): BoqTask => ({
  name, amount, source, offset: 0, dur: 1, on: true,
  items: items.length ? items : [{ code: '', name, qty: 1, unit: 'งาน', amount }],
})

export function parseBoq(sheets: Grid[]): BoqModel {
  const warnings: string[] = []
  const project: BoqProject = { name: '', owner: '', loc1: '', loc2: '', code: '', total: null }

  const pr6 = sheets.find((s) => isPr6(s.name)) ?? sheets.find(isPr6Sheet)
  const info = pr6 ?? sheets.find(isSummarySheet) ?? sheets[0]
  if (info) {
    project.name = projectName(info)
    const loc = findLabel(info, /สถานที่ก่อสร้าง/, 15)
    if (loc) {
      project.loc1 = loc.text
      const next = info.w(loc.r + 1, 2)
      if (next && !info.w(loc.r + 1, 0)) project.loc2 = next
    }
    project.owner = findLabel(info, /หน่วยงานเจ้าของ(โครงการ)?\/?(งานก่อสร้าง)?/, 15)?.text ?? ''
    project.code = findLabel(info, /แบบเลขที่/, 15)?.text ?? ''
  }
  if (pr6) {
    for (let r = 0; r < pr6.rows && project.total == null; r += 1) {
      if (!/รวมค่าก่อสร้างทั้งโครงการ/.test(pr6.w(r, 0) + pr6.w(r, 1))) continue
      for (let k = r; k < r + 3 && project.total == null; k += 1)
        for (let c = 2; c < 6; c += 1) {
          const x = num(pr6.v(k, c))
          if (x != null && x > 1000) {
            project.total = x
            break
          }
        }
    }
  }

  // ปร.5 ของโครงการนี้เท่านั้น — ไฟล์จริงมีสำเนา ปร.5 ของโครงการอื่นค้างอยู่
  let pr5 = sheets.filter(isSummarySheet).map(pr5Info).filter((p) => p.items.length)
  if (project.name) {
    const mine = pr5.filter((p) => !p.project || similarity(p.project, project.name) > 0.6)
    pr5
      .filter((p) => !mine.includes(p))
      .forEach((p) => warnings.push(`ข้ามชีต "${p.sheet}" เพราะเป็นของโครงการอื่น (${p.project.slice(0, 60)})`))
    pr5 = mine
  }

  const details = sheets.filter((s) => !isSummarySheet(s) && !isPr6Sheet(s))
  const blocks = details.flatMap(pr4Blocks)
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.002)
  const used = new Set<Block>()
  const categories: BoqCategory[] = []

  const pickBlock = (amount: number, name: string) =>
    blocks
      .filter((b) => !used.has(b) && close(b.sum, amount))
      .sort((x, y) => similarity(y.name, name) - similarity(x.name, name))[0]
  const findChild = (amount: number, name: string) => {
    let best: { b: Block; ch: Child } | null = null
    let score = -1
    for (const b of blocks)
      for (const ch of b.children)
        if (close(ch.amount, amount)) {
          const s = similarity(ch.name, name)
          if (s > score) {
            score = s
            best = { b, ch }
          }
        }
    return best
  }

  // แบบเก่า: ยอดของหมวดในแบบสรุป = แถว "รวมกลุ่มงาน…" ของแบบรายละเอียด · หมวดถัดไปเริ่มต่อจากแถวรวมของหมวดก่อน
  const totals = details.map((g) => {
    const amt = amountCol(g)
    let head = 0
    for (let r = 0; r < Math.min(g.rows, 15); r += 1) if (/^ลำดับ/.test(g.w(r, 0))) head = r
    const rows: { r: number; amount: number }[] = []
    for (let r = head + 1; r < g.rows; r += 1) {
      const a = num(g.v(r, amt))
      if (a != null && a > 0 && /^รวม/.test(g.w(r, 1) || g.w(r, 0))) rows.push({ r, amount: a })
    }
    return { g, amt, head, rows, used: [] as number[] }
  })
  const fromTotal = (amount: number, name: string) => {
    for (const d of totals)
      for (const t of d.rows) {
        if (d.used.includes(t.r) || !close(t.amount, amount)) continue
        const from = Math.max(d.head, ...d.used.filter((r) => r < t.r)) + 1
        const secs = sectionTasks(d.g, d.amt, from, t.r, name)
        const sum = secs.reduce((q, x) => q + x.items.reduce((w, it) => w + it.amount, 0), 0)
        if (!secs.length || !close(sum, amount)) continue
        d.used.push(t.r)
        return { sheet: d.g.name, tasks: secs.map((x) => task(x.name, x.items.reduce((w, it) => w + it.amount, 0), d.g.name, x.items)) }
      }
    return null
  }
  /** แถวรายการเดียวในแบบรายละเอียดที่มียอดเท่ากับแถวในแบบสรุป (ครุภัณฑ์จัดซื้อแบบเก่า: สรุป 1 แถว = รายการ 1 แถว) */
  const usedRows = new Set<string>()
  const fromRow = (amount: number, name: string) => {
    let best: { g: Grid; r: number; s: number } | null = null
    for (const d of totals)
      for (let r = d.head + 1; r < d.g.rows; r += 1) {
        const nm = d.g.w(r, 1)
        if (!nm || /^รวม/.test(nm) || num(d.g.v(r, 2)) == null || usedRows.has(`${d.g.name}:${r}`)) continue
        const a = num(d.g.v(r, d.amt))
        if (a == null || !close(a, amount)) continue
        const sc = similarity(stripDash(nm), name)
        if (!best || sc > best.s) best = { g: d.g, r, s: sc }
      }
    if (!best) return null
    usedRows.add(`${best.g.name}:${best.r}`)
    const g = best.g
    return { sheet: g.name, item: { code: '', name: stripDash(g.w(best.r, 1)), qty: num(g.v(best.r, 2)) ?? 1, unit: g.w(best.r, 3), amount } }
  }

  let factor: number | null = null
  let vat: number | null = null
  for (const p of pr5) {
    if (p.factor) factor = p.factor
    if (p.vat) vat = p.vat
    const meta = { mult: p.factor ?? (p.vat ? 1 + p.vat : 1), group: p.label }
    let group: { block: Block; cat: BoqCategory } | null = null
    let rowGroup: { sheet: string; cat: BoqCategory } | null = null
    for (const it of p.items) {
      // 1) ทั้งหมวดตรงกับก้อนสรุปของ ปร.4 → ใช้รายการย่อยของก้อนนั้น
      // ก้อนที่ไม่มีรายละเอียดของงานเลยสักงาน อาจเป็นหัวข้อ "N งาน…" ของแบบเก่าที่ลูกเป็นรายการ — ลองแบบเก่าก่อน
      let blk: Block | undefined = pickBlock(it.amount, it.name)
      const old = blk && blk.children.every((ch) => !ch.items.length) ? fromTotal(it.amount, it.name) : null
      if (old) blk = undefined
      if (blk) {
        used.add(blk)
        group = null
        categories.push({
          ...meta,
          name: it.name,
          source: `${p.sheet} → ${blk.sheet}`,
          tasks: blk.children.map((ch) => task(ch.name, ch.amount, blk.sheet, ch.items)),
        })
        continue
      }
      // 1b) แบบเก่า: หมวดจบที่แถว "รวม…" ของแบบรายละเอียด
      const grp = old ?? fromTotal(it.amount, it.name)
      if (grp) {
        group = null
        categories.push({ ...meta, name: it.name, source: `${p.sheet} → ${grp.sheet}`, tasks: grp.tasks })
        continue
      }
      // 2) แถวของ ปร.5 คือรายการย่อยของก้อนหนึ่ง (ปร.5(ข) ครุภัณฑ์) → รวมใต้ชื่อหมวดของก้อน
      const hit = findChild(it.amount, it.name)
      if (hit) {
        if (!group || group.block !== hit.b) {
          group = { block: hit.b, cat: { ...meta, name: hit.b.name, source: `${p.sheet} → ${hit.b.sheet}`, tasks: [] } }
          categories.push(group.cat)
        }
        group.cat.tasks.push(task(it.name, it.amount, hit.b.sheet, hit.ch.items))
        continue
      }
      // 2b) แถวของแบบสรุป = รายการเดียวในแบบรายละเอียด → รวมเป็นหมวดเดียวตามชื่อแบบสรุป
      const one = fromRow(it.amount, it.name)
      if (one) {
        if (!rowGroup || rowGroup.sheet !== p.sheet) {
          rowGroup = { sheet: p.sheet, cat: { ...meta, name: p.label.replace(/^แบบสรุป\s*/, '') || it.name, source: `${p.sheet} → ${one.sheet}`, tasks: [] } }
          categories.push(rowGroup.cat)
        }
        rowGroup.cat.tasks.push(task(it.name, it.amount, one.sheet, [one.item]))
        continue
      }
      // 3) ไม่มีรายละเอียด → หมวดนั้นเป็นงานเดียว
      group = null
      warnings.push(`ไม่พบรายละเอียด ปร.4 ของ "${it.name}" ใช้ยอดจาก ${p.sheet} เป็นงานเดียว`)
      categories.push({ ...meta, name: it.name, source: p.sheet, tasks: [task(it.name, it.amount, p.sheet)] })
    }
  }

  if (!categories.length && blocks.length) {
    warnings.push('ไม่พบแบบ ปร.5 จึงใช้ทุกหมวดที่พบในแบบ ปร.4')
    for (const b of blocks)
      categories.push({ name: b.name, source: b.sheet, mult: 1, group: 'งานก่อสร้าง', tasks: b.children.map((ch) => task(ch.name, ch.amount, b.sheet, ch.items)) })
  }
  const cats = categories
    .map((c) => ({ ...c, tasks: c.tasks.filter((t) => t.amount > 0) }))
    .filter((c) => c.tasks.length)
  if (!cats.length) throw new Error('BOQ_EMPTY')
  return { project, factor, vat, categories: cats, warnings }
}

/**
 * ช่วงของขั้นตอนก่อสร้าง (สัดส่วนของระยะสัญญา) — เรียงจากเฉพาะเจาะจงไปกว้าง
 * ชื่องานถูกเทียบก่อนชื่อหมวด · ไม่เข้ากฎไหนเลย = 15–90%
 */
export const PHASE_RULES: [RegExp, number, number, string][] = [
  [/เตรียม|ชั่วคราว|สำรวจ|ขนย้าย/, 0, 0.08, 'เตรียมพื้นที่'],
  [/รื้อ|ทุบ|ถอน/, 0, 0.12, 'รื้อถอน'],
  [/เสาเข็ม/, 0.03, 0.2, 'เสาเข็ม'],
  [/ขุด|ดิน|ฐานราก|ถม/, 0.05, 0.25, 'งานดิน ฐานราก'],
  [/โครงสร้าง|คอนกรีต|เหล็กเสริม|คาน|เสา|พื้นสำเร็จ/, 0.1, 0.55, 'โครงสร้าง'],
  [/หลังคา|มุง|รางน้ำ|รางระบาย/, 0.3, 0.6, 'หลังคา'],
  [/แจ้งเหตุเพลิง|ดับเพลิง|รักษาความปลอดภัย|intrusion|access/i, 0.78, 0.96, 'แจ้งเหตุเพลิงไหม้ ความปลอดภัย'],
  [/โทรศัพท์|อินเตอร์|อินเทอร์|internet|cctv|กล้อง|สื่อสาร|lan|เครือข่าย/i, 0.45, 0.8, 'สื่อสาร กล้อง'],
  [/สวิทช์|สวิตช์|เต้ารับ|ดวงโคม|โคมไฟ|อุปกรณ์ไฟฟ้า/, 0.55, 0.85, 'สวิตช์ ดวงโคม'],
  [/สาย|ท่อ|แผงจ่าย|ตู้เมน|ตู้ไฟ|สุขาภิบาล|ประปา|ระบายน้ำ/, 0.12, 0.5, 'เดินท่อ สายไฟ ตู้เมน'],
  [/ปรับอากาศ|vrv|แอร์|ระบายอากาศ|พัดลม/i, 0.45, 0.85, 'ปรับอากาศ'],
  [/ผนัง|ก่อ|ฉาบ|ยิปซัม/, 0.12, 0.45, 'ผนัง'],
  [/ประตู|หน้าต่าง|กระจก|อลูมิเนียม/, 0.35, 0.7, 'ประตู-หน้าต่าง'],
  [/ฝ้า/, 0.45, 0.75, 'ฝ้าเพดาน'],
  [/พื้น|กระเบื้อง/, 0.3, 0.75, 'พื้น'],
  [/ทาสี|สี/, 0.7, 0.92, 'ทาสี'],
  [/สุขภัณฑ์/, 0.7, 0.9, 'สุขภัณฑ์'],
  [/ครุภัณฑ์|เฟอร์นิเจอร์|ลอยตัว|furniture/i, 0.75, 1, 'ครุภัณฑ์ เฟอร์นิเจอร์'],
  [/ตกแต่ง|built.?in|บิวท์|interior/i, 0.45, 0.9, 'ตกแต่งภายใน'],
  [/ภายนอก|ถนน|ภูมิทัศน์|รั้ว|ลาน|จอดรถ/, 0.75, 0.98, 'งานภายนอก'],
  [/ทดสอบ|ส่งมอบ|ทำความสะอาด|test/i, 0.92, 1, 'ทดสอบ ส่งมอบ'],
]

function phaseOf(t: BoqTask, c: BoqCategory): [number, number] {
  for (const [re, s, e] of PHASE_RULES) if (re.test(t.name)) return [s, e]
  for (const [re, s, e] of PHASE_RULES) if (re.test(c.name)) return [s, e]
  return [0.15, 0.9]
}

/** จัดวันเริ่ม/ระยะเวลาให้ทุกงาน — งานมูลค่าสูงได้ช่วงยาวกว่าภายในช่วงของขั้นตอน */
export function autoSchedule(categories: BoqCategory[], days: number): BoqCategory[] {
  const all = categories.flatMap((c) => c.tasks)
  const maxA = Math.max(1, ...all.map((t) => t.amount))
  return categories.map((c) => ({
    ...c,
    tasks: c.tasks.map((t) => {
      const [s, e] = phaseOf(t, c)
      const span = Math.max(1, Math.round((e - s) * days))
      let dur = Math.round(span * (0.55 + 0.45 * Math.sqrt(t.amount / maxA)))
      dur = Math.min(span, Math.max(Math.min(7, span), dur))
      const offset = Math.max(0, Math.min(days - dur, Math.round(s * days + (span - dur) * 0.25)))
      return { ...t, offset, dur: Math.max(1, dur) }
    }),
  }))
}

export const weekCount = (days: number) => Math.max(1, Math.ceil(days / 7))

export type Distribution = {
  weeks: number
  total: number
  /** น้ำหนักต่องาน (0..1) เรียงตาม `activeTasks` */
  weights: number[]
  /** สัดส่วนต่อสัปดาห์ของแต่ละงาน */
  plan: number[][]
  perWeek: number[]
  cum: number[]
}

export const activeTasks = (categories: BoqCategory[]) => categories.flatMap((c) => c.tasks.filter((t) => t.on))

/**
 * กระจายน้ำหนักงานลงสัปดาห์ = (วันของงานที่ตกในสัปดาห์นั้น ÷ ระยะเวลางาน) × น้ำหนัก
 * 🔴 ต้องตรงกับสูตรในแถว Plan ของไฟล์ Excel — ไม่งั้นค่าที่โชว์บนจอกับในไฟล์ไม่เท่ากัน
 */
export function distribute(categories: BoqCategory[], days: number): Distribution {
  const weeks = weekCount(days)
  const tasks = activeTasks(categories)
  const total = tasks.reduce((s, t) => s + t.amount, 0)
  const perWeek = new Array<number>(weeks).fill(0)
  const weights = tasks.map((t) => (total ? t.amount / total : 0))
  const plan = tasks.map((t, i) => {
    const row = new Array<number>(weeks).fill(0)
    const te = t.offset + t.dur - 1
    for (let w = 0; w < weeks; w += 1) {
      const ov = Math.max(0, Math.min(te, w * 7 + 6) - Math.max(t.offset, w * 7) + 1)
      row[w] = (ov / t.dur) * weights[i]
      perWeek[w] += row[w]
    }
    return row
  })
  let acc = 0
  const cum = perWeek.map((x) => (acc += x))
  return { weeks, total, weights, plan, perWeek, cum }
}

// ---------------------------------------------------------------------------
// R20i · รายงานแผนเทียบจริงจากแผนที่บันทึกในเว็บ — สูตรเดียวกับ `readProgress()` (อ่านไฟล์ Excel)
// และชีต "สรุปผลเบิกจ่าย": ช่องว่าง = เท่างวดก่อน · งวดล่าสุด = งวดสุดท้ายที่กรอกผลงานอย่างน้อยหนึ่งช่อง
// · แผน ณ วันส่งงวดคิดรายวันจากวันเริ่ม/ระยะเวลาของงาน · น้ำหนัก = ค่างานต้นทุนของรายการ
// · ผลประเมิน ว.124 เติมทีหลังด้วย `withW124()` (ไฟล์นี้ไม่ import ค่าจากไฟล์อื่น)

type StoredProgress = { dates: (string | null)[]; items: Record<string, (number | null)[]> }

export function planReport(
  p: { name: string; categories: BoqCategory[]; start: string; days: number; periods: number; w124: boolean; progress: StoredProgress },
  todayIso: string,
): ProgressReport {
  const DAY = 864e5
  const t0 = Date.parse(`${p.start}T00:00:00Z`)
  const dist = distribute(p.categories, p.days)
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
  const thShort = (t: number) => new Date(t).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'UTC' })

  type Row = { code: string; name: string; category: string; amount: number; offset: number; dur: number; items: { amount: number; eff: number[] }[] }
  const rows: Row[] = []
  let lastPeriod = 0
  let catNo = 0
  p.categories.forEach((c, ci) => {
    if (!c.tasks.some((t) => t.on)) return
    catNo += 1
    let j = 0
    c.tasks.forEach((t, ti) => {
      if (!t.on) return
      j += 1
      const items = t.items.map((it, ii) => {
        const vals = p.progress.items[`${ci}.${ti}.${ii}`] ?? []
        const eff: number[] = []
        let prev = 0
        for (let k = 0; k < p.periods; k += 1) {
          const v = vals[k]
          if (v != null) {
            prev = Math.min(1, Math.max(0, v))
            lastPeriod = Math.max(lastPeriod, k + 1)
          }
          eff.push(prev)
        }
        return { amount: it.amount, eff }
      })
      rows.push({ code: `${catNo}.${j}`, name: t.name, category: c.name, amount: items.reduce((s, x) => s + x.amount, 0), offset: t.offset, dur: t.dur, items })
    })
  })
  const total = rows.reduce((s, r) => s + r.amount, 0) || 1
  const weekOf = (t: number) => Math.max(1, Math.min(dist.weeks, Math.floor((t - t0) / DAY / 7) + 1))
  const taskPlan = (r: Row, t: number) => {
    const d0 = t0 + r.offset * DAY
    const d1 = d0 + (r.dur - 1) * DAY
    if (t >= d1) return 1
    if (t >= d0) return Math.min(1, ((t - d0) / DAY + 1) / r.dur)
    return 0
  }
  const planAt = (t: number) => rows.reduce((s, r) => s + (r.amount / total) * taskPlan(r, t), 0)
  const actualAt = (k: number) => rows.reduce((s, r) => s + r.items.reduce((q, it) => q + it.amount * it.eff[k], 0), 0) / total
  const dateOf = (k: number) => {
    const d = p.progress.dates[k]
    return d ? Date.parse(`${d}T00:00:00Z`) : null
  }
  const installments = Array.from({ length: lastPeriod }, (_, k) => {
    const t = dateOf(k)
    return { no: k + 1, date: t == null ? null : iso(t), week: t == null ? null : weekOf(t), plan: t == null ? null : planAt(t), actual: actualAt(k) }
  })
  const actualCum: (number | null)[] = new Array(dist.weeks).fill(null)
  for (const x of installments) if (x.week) actualCum[x.week - 1] = x.actual
  const lastDate = lastPeriod ? dateOf(lastPeriod - 1) : null
  return {
    projectName: p.name,
    start: p.start,
    labels: Array.from({ length: dist.weeks }, (_, k) => `W${k + 1}`),
    sublabels: Array.from({ length: dist.weeks }, (_, k) => thShort(t0 + k * 7 * DAY)),
    planWeekly: dist.perWeek,
    planCum: dist.cum,
    actualCum,
    installments,
    tasks: rows.map((r) => ({
      code: r.code, name: r.name, category: r.category, amount: r.amount, weight: r.amount / total,
      plan: lastDate == null ? 0 : taskPlan(r, lastDate),
      actual: lastPeriod && r.amount ? r.items.reduce((q, it) => q + it.amount * it.eff[lastPeriod - 1], 0) / r.amount : 0,
    })),
    days: p.days,
    asOf: lastDate == null ? todayIso : iso(lastDate),
    w124Enabled: p.w124,
    w124: [],
  }
}
