/**
 * ตารางงานเพิ่ม-ลด (R25 · 1 พ.ย. 2569) — "แบบแสดงรายการ ปริมาณงาน และราคา งานเพิ่ม-ลด"
 *
 * ผังตามที่เจ้าของเลือก: หัวกระดาษแบบที่ 1 (โครงการ · สถานที่ · หน่วยงาน · แบบเลขที่)
 * + โครงตารางแบบที่ 2 (บล็อกงานลด → รวม · Factor F · รวมทั้งหมด · บล็อกงานเพิ่มแบบเดียวกัน → ส่วนต่าง)
 * + คอลัมน์หมายเหตุ
 *
 * 🔴 ไฟล์ล้วน ไม่มี import — ใช้ทั้งฟอร์ม (เบราว์เซอร์) · ตัวตรวจฝั่งเซิร์ฟเวอร์ · unit test (node ตรง ๆ)
 * 🔴 สูตรเงินมีที่เดียว (`coTotals`) — หน้าจอ · กระดาษพิมพ์ · ใบปะหน้าหนังสือ · ไฟล์ Excel ใช้ตัวเลขชุดเดียวกัน
 *    ไฟล์ Excel เขียนเป็นสูตรที่ให้ผลเท่ากัน (ROUND ทีละช่องแบบเดียวกับ `round2`)
 *
 * การปัดเศษ (ตรงกับตารางเดิมของเจ้าของทั้งสองแบบ):
 *   รวมของแถว = ROUND(จำนวน × ราคา/หน่วย, 2) แยกค่าวัสดุ/ค่าแรง
 *   Factor F ของบล็อก = ROUND(รวมบล็อก × (F − 1), 2) · รวมทั้งหมด = รวมบล็อก + Factor F
 *   ส่วนต่าง = รวมทั้งหมดงานเพิ่ม − รวมทั้งหมดงานลด (บวก = งานเพิ่ม · ลบ = งานลด)
 */

export type CoGroup = { t: 'group'; no: string; text: string }
export type CoHead = { t: 'head'; text: string }
export type CoItem = {
  t: 'item'
  text: string
  qty: number | null
  unit: string
  /** ราคาค่าวัสดุต่อหน่วย */
  mat: number | null
  /** ราคาค่าแรงต่อหน่วย */
  lab: number | null
  note: string
}
export type CoRow = CoGroup | CoHead | CoItem

export type CoBlock = { title: string; rows: CoRow[] }

export type ChangeOrder = {
  v: 1
  /** กลุ่มงาน/งาน เช่น "งานสถาปัตยกรรม" */
  work: string
  project: string
  location: string
  owner: string
  /** แบบเลขที่ */
  drawingNo: string
  factor: number
  cut: CoBlock
  add: CoBlock
}

export type CoSide = 'cut' | 'add'

export const CO_TITLE = 'แบบแสดงรายการ ปริมาณงาน และราคา งานเพิ่ม-ลด'
export const CO_ATTACHMENT = `${CO_TITLE} 1 ชุด`
export const CO_DEFAULT_FACTOR = 1.3027
export const CO_LIMITS = { rows: 300, text: 300, short: 40, header: 300 } as const

export const round2 = (n: number) => Math.round((n + Math.sign(n) * Number.EPSILON) * 100) / 100

export function emptyChangeOrder(h: Partial<Pick<ChangeOrder, 'work' | 'project' | 'location' | 'owner' | 'factor'>> = {}): ChangeOrder {
  return {
    v: 1,
    work: h.work ?? '',
    project: h.project ?? '',
    location: h.location ?? '',
    owner: h.owner ?? '',
    drawingNo: '',
    factor: h.factor ?? CO_DEFAULT_FACTOR,
    cut: { title: 'งานลด', rows: [] },
    add: { title: 'งานเพิ่ม', rows: [] },
  }
}

export const emptyItem = (): CoItem => ({ t: 'item', text: '', qty: null, unit: '', mat: null, lab: null, note: '' })

/* ── เงิน ─────────────────────────────────────────────────────────────── */

export type ItemTotals = { mat: number; lab: number; total: number }

export function itemTotals(r: CoItem): ItemTotals {
  const q = r.qty ?? 0
  const mat = round2(q * (r.mat ?? 0))
  const lab = round2(q * (r.lab ?? 0))
  return { mat, lab, total: round2(mat + lab) }
}

export type BlockTotals = {
  items: number
  mat: number
  lab: number
  sum: number
  /** ยอดของบรรทัด Factor F (ส่วนที่บวกเพิ่ม ไม่ใช่ตัวคูณ) */
  fMat: number
  fLab: number
  fSum: number
  totalMat: number
  totalLab: number
  total: number
}

export function blockTotals(b: CoBlock, factor: number): BlockTotals {
  let mat = 0
  let lab = 0
  let items = 0
  for (const r of b.rows) {
    if (r.t !== 'item') continue
    const t = itemTotals(r)
    mat += t.mat
    lab += t.lab
    items += 1
  }
  mat = round2(mat)
  lab = round2(lab)
  const sum = round2(mat + lab)
  const k = factor - 1
  const fMat = round2(mat * k)
  const fLab = round2(lab * k)
  const fSum = round2(sum * k)
  return {
    items, mat, lab, sum, fMat, fLab, fSum,
    totalMat: round2(mat + fMat), totalLab: round2(lab + fLab), total: round2(sum + fSum),
  }
}

export type CoTotals = {
  cut: BlockTotals
  add: BlockTotals
  /** งานเพิ่ม − งานลด */
  diff: number
  /** ใบปะหน้า: บวก = งานเพิ่ม · ลบ = งานลด · 0 = ไม่มีรายการ */
  kind: 'งานเพิ่ม' | 'งานลด' | null
  /** ยอดบนใบปะหน้า (ค่าบวกเสมอ) */
  amount: number
}

export function coTotals(co: ChangeOrder): CoTotals {
  const cut = blockTotals(co.cut, co.factor)
  const add = blockTotals(co.add, co.factor)
  const diff = round2(add.total - cut.total)
  const kind = cut.items + add.items === 0 ? null : diff >= 0 ? 'งานเพิ่ม' : 'งานลด'
  return { cut, add, diff, kind, amount: Math.abs(diff) }
}

export const hasItems = (co: ChangeOrder | null | undefined) =>
  Boolean(co && [...co.cut.rows, ...co.add.rows].some((r) => r.t === 'item'))

/* ── ตรวจข้อมูล (ฟอร์ม · เซิร์ฟเวอร์ · แถวเก่าในฐานข้อมูล) ─────────────── */

const str = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** ตัวเลขช่องกรอก: ว่าง = null · ติดลบ/ไม่ใช่ตัวเลข/เกินเพดาน = null · ทศนิยมสูงสุด 4 ตำแหน่ง */
export function num(v: unknown, max = 999_999_999): number | null {
  if (v === null || v === undefined) return null
  const s = typeof v === 'number' ? String(v) : String(v).replace(/,/g, '').trim()
  if (s === '' || s === '-') return null
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0 || n > max) return null
  return Math.round(n * 10_000) / 10_000
}

function parseRow(v: unknown): CoRow | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  if (r.t === 'group') return { t: 'group', no: str(r.no, CO_LIMITS.short), text: str(r.text, CO_LIMITS.text) }
  if (r.t === 'head') return { t: 'head', text: str(r.text, CO_LIMITS.text) }
  if (r.t === 'item') {
    return {
      t: 'item',
      text: str(r.text, CO_LIMITS.text),
      qty: num(r.qty, 9_999_999),
      unit: str(r.unit, CO_LIMITS.short),
      mat: num(r.mat),
      lab: num(r.lab),
      note: str(r.note, CO_LIMITS.short * 2),
    }
  }
  return null
}

function parseBlock(v: unknown, fallback: string): CoBlock {
  const b = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const rows = Array.isArray(b.rows) ? b.rows.slice(0, CO_LIMITS.rows).map(parseRow).filter((r): r is CoRow => r !== null) : []
  return { title: str(b.title, 120) || fallback, rows }
}

/** jsonb/ข้อมูลจากฟอร์ม → ตาราง · รูปร่างผิดทั้งก้อน = null (ไม่ทำหน้าพัง) */
export function parseChangeOrder(v: unknown): ChangeOrder | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const factor = num(o.factor, 3)
  return {
    v: 1,
    work: str(o.work, CO_LIMITS.header),
    project: str(o.project, CO_LIMITS.header),
    location: str(o.location, CO_LIMITS.header),
    owner: str(o.owner, CO_LIMITS.header),
    drawingNo: str(o.drawingNo, 80),
    factor: factor !== null && factor >= 1 ? factor : CO_DEFAULT_FACTOR,
    cut: parseBlock(o.cut, 'งานลด'),
    add: parseBlock(o.add, 'งานเพิ่ม'),
  }
}

/** ตารางที่ไม่มีอะไรเลย (ไม่มีแถว) ไม่ต้องเก็บ */
export const isBlank = (co: ChangeOrder) => co.cut.rows.length + co.add.rows.length === 0

/* ── ช่วยแก้ตาราง ─────────────────────────────────────────────────────── */

/** ย้ายแถว i ขึ้น (-1) / ลง (+1) — คืนรายการใหม่ (immutable) */
export function moveRow<T>(rows: readonly T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir
  if (i < 0 || j < 0 || i >= rows.length || j >= rows.length) return [...rows]
  const out = [...rows]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

/** ยอดเงินไทยสองตำแหน่ง · 0 = "-" แบบตารางเดิม */
export const coMoney = (n: number, dash = true) =>
  dash && Math.abs(n) < 0.005 ? '-' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** จำนวน: ทศนิยมตามที่กรอก (สูงสุด 4) แต่อย่างน้อย 2 ตำแหน่ง */
export const coQty = (n: number | null) =>
  !n ? '-' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })

/* ── รายการจาก BOQ ที่บันทึกไว้ (เมนูแผนงาน) ─────────────────────────── */

export type BoqPickItem = { code: string; name: string; qty: number | null; unit: string; amount: number }

/**
 * รายการ BOQ → แถวตาราง · ราคาต่อหน่วย = ค่างานต้นทุนรวม ÷ จำนวน (BOQ ที่บันทึกไว้ไม่ได้แยกวัสดุ/ค่าแรง)
 * → ใส่ไว้ช่องค่าวัสดุ ให้เจ้าของแยกเองถ้าต้องการ · ไม่มีจำนวน = ทั้งก้อน 1 หน่วย
 */
export function itemFromBoq(b: BoqPickItem): CoItem {
  const qty = b.qty && b.qty > 0 ? b.qty : 1
  return {
    t: 'item',
    text: b.name.slice(0, CO_LIMITS.text),
    qty,
    unit: (b.qty && b.qty > 0 ? b.unit : b.unit || 'งาน').slice(0, CO_LIMITS.short),
    mat: round2(b.amount / qty),
    lab: null,
    note: '',
  }
}
