/**
 * แผนงานก่อสร้างจาก BOQ — ส่วนคำนวณล้วน (ไม่มี I/O ไม่ผูก exceljs)
 *
 * อ่านแบบ ปร.6 → ปร.5 → ปร.4 · จับคู่ด้วย **ยอดเงิน** ไม่ใช่ชื่อชีต เพราะไฟล์ BOQ
 * จริงมักมีชีตของโครงการอื่น/ชีตเทียบราคาค้างอยู่ (ไฟล์ตัวอย่างของเจ้าของมี 16 ชีต
 * ใช้จริง 6) · จัดลำดับงานตามช่วงของขั้นตอนก่อสร้าง แล้วกระจายน้ำหนักรายสัปดาห์
 * ด้วยสูตรเดียวกับที่เขียนลง Excel (`distribute` ↔ สูตรในแถว Plan ของ `workbook.ts`)
 */

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
export type BoqCategory = { name: string; source: string; tasks: BoqTask[] }
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
    for (let c = 0; c < g.cols; c += 1) if (/รวมค่าวัสดุ|รวมเป็นเงิน/.test(g.w(r, c))) return c
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
  project: string
  items: { name: string; amount: number }[]
  factor: number | null
  vat: number | null
}

function pr5Info(g: Grid): Pr5 {
  let costCol = 2
  let head = -1
  hunt: for (let r = 0; r < Math.min(g.rows, 20); r += 1)
    for (let c = 0; c < g.cols; c += 1)
      if (/^ค่างานต้นทุน/.test(g.w(r, c))) {
        costCol = c
        head = r
        break hunt
      }
  const items: Pr5['items'] = []
  let factor: number | null = null
  let vat: number | null = null
  for (let r = head + 1; r < g.rows; r += 1) {
    const a = g.w(r, 0)
    const b = g.w(r, 1)
    const cost = num(g.v(r, costCol))
    if (/^\d+$/.test(a) && b && cost != null) items.push({ name: b, amount: cost })
    if (/รวมค่างานต้นทุน|รวมค่าครุภัณฑ์จัดซื้อทั้งหมด/.test(`${a} ${b}`)) {
      const d = num(g.v(r, costCol + 1))
      if (d != null) {
        if (d > 1) factor = d
        else vat = d
      }
    }
  }
  return { sheet: g.name, project: projectName(g), items, factor, vat }
}

const isPr6 = (n: string) => /ปร\.?\s*6/.test(n)
const isPr5 = (n: string) => /ปร\.?\s*5/.test(n)
const task = (name: string, amount: number, source: string, items: BoqItem[] = []): BoqTask => ({
  name, amount, source, offset: 0, dur: 1, on: true,
  items: items.length ? items : [{ code: '', name, qty: 1, unit: 'งาน', amount }],
})

export function parseBoq(sheets: Grid[]): BoqModel {
  const warnings: string[] = []
  const project: BoqProject = { name: '', owner: '', loc1: '', loc2: '', code: '', total: null }

  const pr6 = sheets.find((s) => isPr6(s.name))
  const info = pr6 ?? sheets.find((s) => isPr5(s.name)) ?? sheets[0]
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
  let pr5 = sheets.filter((s) => isPr5(s.name)).map(pr5Info).filter((p) => p.items.length)
  if (project.name) {
    const mine = pr5.filter((p) => !p.project || similarity(p.project, project.name) > 0.6)
    pr5
      .filter((p) => !mine.includes(p))
      .forEach((p) => warnings.push(`ข้ามชีต "${p.sheet}" เพราะเป็นของโครงการอื่น (${p.project.slice(0, 60)})`))
    pr5 = mine
  }

  const blocks = sheets.filter((s) => !isPr5(s.name) && !isPr6(s.name)).flatMap(pr4Blocks)
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

  let factor: number | null = null
  let vat: number | null = null
  for (const p of pr5) {
    if (p.factor) factor = p.factor
    if (p.vat) vat = p.vat
    let group: { block: Block; cat: BoqCategory } | null = null
    for (const it of p.items) {
      // 1) ทั้งหมวดตรงกับก้อนสรุปของ ปร.4 → ใช้รายการย่อยของก้อนนั้น
      const blk = pickBlock(it.amount, it.name)
      if (blk) {
        used.add(blk)
        group = null
        categories.push({
          name: it.name,
          source: `${p.sheet} → ${blk.sheet}`,
          tasks: blk.children.map((ch) => task(ch.name, ch.amount, blk.sheet, ch.items)),
        })
        continue
      }
      // 2) แถวของ ปร.5 คือรายการย่อยของก้อนหนึ่ง (ปร.5(ข) ครุภัณฑ์) → รวมใต้ชื่อหมวดของก้อน
      const hit = findChild(it.amount, it.name)
      if (hit) {
        if (!group || group.block !== hit.b) {
          group = { block: hit.b, cat: { name: hit.b.name, source: `${p.sheet} → ${hit.b.sheet}`, tasks: [] } }
          categories.push(group.cat)
        }
        group.cat.tasks.push(task(it.name, it.amount, hit.b.sheet, hit.ch.items))
        continue
      }
      // 3) ไม่มีรายละเอียด → หมวดนั้นเป็นงานเดียว
      group = null
      warnings.push(`ไม่พบรายละเอียด ปร.4 ของ "${it.name}" ใช้ยอดจาก ${p.sheet} เป็นงานเดียว`)
      categories.push({ name: it.name, source: p.sheet, tasks: [task(it.name, it.amount, p.sheet)] })
    }
  }

  if (!categories.length && blocks.length) {
    warnings.push('ไม่พบแบบ ปร.5 จึงใช้ทุกหมวดที่พบในแบบ ปร.4')
    for (const b of blocks)
      categories.push({ name: b.name, source: b.sheet, tasks: b.children.map((ch) => task(ch.name, ch.amount, b.sheet, ch.items)) })
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
