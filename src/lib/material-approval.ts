/**
 * รายการขออนุมัติใช้วัสดุ (R26 · 3 พ.ย. 2569) — ในหนังสือแบบ "ขออนุมัติใช้วัสดุ" (`/letters`)
 *
 * เจ้าของใช้หนังสือสองรูปแบบ (ถอดจาก `agro009/2569` และ `reg033/2569`):
 *   แบบที่ 1 `inline` — รายการวัสดุเป็นข้อ 1. 2. … ในเนื้อหาหนังสือ แล้วแนบแค็ตตาล็อก
 *   แบบที่ 2 `table`  — เนื้อหาสั้น + "ตารางรายการขออนุมัติใช้วัสดุ" แนวนอน 7 คอลัมน์แนบท้าย แล้วแนบแค็ตตาล็อก
 * กรอกรายการชุดเดียว เลือกรูปแบบที่ช่อง "รูปแบบหนังสือ" (`fields.style`) — สลับไปมาได้โดยไม่เสียรายการ
 *
 * 🔴 ไฟล์ล้วน ไม่มี import — ใช้ทั้งฟอร์ม (เบราว์เซอร์) · ตัวตรวจฝั่งเซิร์ฟเวอร์ · unit test (node ตรง ๆ)
 * เก็บใน `letters.fields.materialApproval` (jsonb เดิม · **ไม่มี migration**) เหมือน R25
 */

export type MaItem = {
  /** รายการวัสดุ เช่น "ปูนก่อผนัง" */
  name: string
  /** รูปแบบรายการ (ตามแบบ) · ว่าง = "- ไม่ระบุ" */
  drawing: string
  /** แบบแสดงปริมาณราคา (BOQ) · ว่าง = "- ไม่ระบุ" */
  boq: string
  /** รายการประกอบแบบ (spec) · ว่าง = "- ไม่ระบุ" */
  spec: string
  /** รายละเอียดที่ขออนุมัติใช้ เช่น "เสือ มอร์ตาร์ ก่อทั่วไป" / "ยี่ห้อ CHANG รุ่น MV-18" */
  detail: string
  /** หมายเหตุ — "ตรงตามแบบรูปรายการ" / "ขออนุมัติใช้" */
  note: string
}

export type MaterialApproval = {
  v: 1
  /** ชื่อโครงการบนหัวตาราง (ไม่มีคำว่า "โครงการ" นำหน้า — หัวตารางมีป้ายให้แล้ว) */
  project: string
  /** สัญญาจ้าง เช่น "5/2569 ลงวันที่ 16 มิถุนายน 2569" · ว่าง = ดึงจากบรรทัด "อ้างถึง" ที่เป็นสัญญา */
  contract: string
  items: MaItem[]
}

export type MaStyle = 'table' | 'inline'

/** ค่าช่องด่วน `style` ที่ให้ระบบเลือกเองตามจำนวนรายการ (4 พ.ย. 2569) */
export const MA_AUTO = 'อัตโนมัติ'
export const MA_STYLE_OPTIONS = [MA_AUTO, 'แนบตาราง', 'ระบุในเนื้อหา'] as const
/**
 * จำนวนรายการสูงสุดที่ยังระบุในเนื้อหาแล้วลายเซ็นอยู่หน้า 1 · เกินนี้ = แนบตาราง (อัตโนมัติ)
 * 🔴 ประมาณจากหนังสือจริง `agro009` (9 รายการ → ลายเซ็นตกไปหน้า 2 คนเดียว) ยังไม่ได้วัดบนกระดาษทุกกรณี
 *    หัวเรื่อง/ย่อหน้าเปิดที่ยาวกว่าปกติกินที่มากขึ้น — ปรับค่านี้ที่เดียว (unit test อ้างค่านี้)
 */
export const MA_AUTO_MAX_INLINE = 6
/**
 * ค่าในช่องด่วน `style` → รูปแบบ
 * · `ระบุในเนื้อหา` / `แนบตาราง` = ตามที่เลือก
 * · `อัตโนมัติ` = ไม่เกิน MA_AUTO_MAX_INLINE รายการ ระบุในเนื้อหา · เกินนั้น แนบตาราง (`count` = แถวที่กรอกจริง)
 * · ไม่มีค่า (หนังสือเก่าก่อน R26) = แนบตาราง (แบบเดิมของแม่แบบ)
 */
export const maStyleOf = (v: string | undefined, count = 0): MaStyle => {
  if (v === 'ระบุในเนื้อหา') return 'inline'
  if (v === MA_AUTO) return count > MA_AUTO_MAX_INLINE ? 'table' : 'inline'
  return 'table'
}

export const MA_TITLE = 'ตารางรายการขออนุมัติใช้วัสดุ'
export const MA_UNSPECIFIED = '- ไม่ระบุ'
export const MA_NOTE_OPTIONS = ['ตรงตามแบบรูปรายการ', 'ขออนุมัติใช้'] as const
export const MA_LIMITS = { rows: 100, text: 300, header: 300 } as const

export const emptyMaItem = (): MaItem => ({ name: '', drawing: '', boq: '', spec: '', detail: '', note: MA_NOTE_OPTIONS[0] })

export function emptyMaterialApproval(project = ''): MaterialApproval {
  return { v: 1, project: stripProjectWord(project), contract: '', items: [emptyMaItem()] }
}

/** "โครงการปรับปรุง…" → "ปรับปรุง…" (หัวตารางเขียน "โครงการ:" ไว้แล้ว) */
export const stripProjectWord = (s: string) => s.trim().replace(/^โครงการ\s*/, '')

const filled = (it: MaItem) => Boolean(it.name.trim() || it.detail.trim())

/** แถวที่กรอกจริง (มีชื่อหรือรายละเอียด) — แถวว่างท้ายตารางไม่ถูกพิมพ์และไม่ถูกเก็บ */
export const maItems = (ma: MaterialApproval | null | undefined): MaItem[] => (ma ? ma.items.filter(filled) : [])
export const hasMaItems = (ma: MaterialApproval | null | undefined) => maItems(ma).length > 0

/**
 * ข้อความหนึ่งข้อในเนื้อหาหนังสือ (แบบที่ 1) = รายการ + รายละเอียด
 * "ตู้โหลดเซ็นเตอร์ 50A" + "ยี่ห้อ CHANG รุ่น MV-18" → "ตู้โหลดเซ็นเตอร์ 50A ยี่ห้อ CHANG รุ่น MV-18"
 * · ขีดนำหน้าแบบในตาราง ("- เสือ มอร์ตาร์") ถูกตัด · บรรทัดหลายบรรทัดรวมเป็นบรรทัดเดียว
 */
export function maLine(it: MaItem): string {
  const clean = (s: string) => s.replace(/\s*\n\s*/g, ' ').replace(/^\s*[-–•]\s*/, '').trim()
  const name = clean(it.name)
  const detail = clean(it.detail)
  if (!detail || detail === name) return name
  if (!name || detail.startsWith(name)) return detail
  return `${name} ${detail}`
}

/** ข้อในเนื้อหาหนังสือ — ว่าง = ข้อเดียวเป็นจุดไข่ปลาให้เห็นว่ายังไม่ได้กรอก */
export function maBodyLines(ma: MaterialApproval | null | undefined, blank: string): string[] {
  const its = maItems(ma)
  return its.length ? its.map((it, i) => `${i + 1}. ${maLine(it)}`) : [`1. ${blank}`]
}

/** ช่องว่างในตาราง = "- ไม่ระบุ" ตามแบบเดิม · ค่าที่กรอกพิมพ์ตามที่กรอก */
export const maCell = (s: string) => s.trim() || MA_UNSPECIFIED

/**
 * สัญญาจ้างบนหัวตาราง ← บรรทัด "อ้างถึง" ที่เป็นสัญญา
 * "สัญญาจ้างเลขที่ 5/2569 ลงวันที่ 16 มิถุนายน 2569" → "5/2569 ลงวันที่ 16 มิถุนายน 2569"
 */
export function contractFromRefs(refs: readonly string[]): string {
  const line = refs.find((r) => /สัญญา/.test(r))
  if (!line) return ''
  return line.replace(/^\s*\d+\s*[.)]\s*/, '').replace(/^สัญญา(?:จ้าง)?\s*(?:เลขที่)?\s*/, '').trim()
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

/** ตัวตรวจข้อมูลจาก client / จากฐานข้อมูล — รูปผิด = null ไม่ใช่ throw · แถวว่างถูกตัดทิ้ง */
export function parseMaterialApproval(v: unknown): MaterialApproval | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.items)) return null
  const items: MaItem[] = []
  for (const raw of o.items.slice(0, MA_LIMITS.rows)) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const it: MaItem = {
      name: str(r.name, MA_LIMITS.text),
      drawing: str(r.drawing, MA_LIMITS.text),
      boq: str(r.boq, MA_LIMITS.text),
      spec: str(r.spec, MA_LIMITS.text),
      detail: str(r.detail, MA_LIMITS.text),
      note: str(r.note, MA_LIMITS.text),
    }
    items.push(it)
  }
  return {
    v: 1,
    project: str(o.project, MA_LIMITS.header),
    contract: str(o.contract, MA_LIMITS.header),
    items,
  }
}

/** ก้อนที่เก็บลงฐานข้อมูล — ตัดแถวว่าง · ไม่มีรายการเลย = ไม่เก็บ */
export function compactMaterialApproval(ma: MaterialApproval | null): MaterialApproval | null {
  if (!ma) return null
  const items = maItems(ma)
  return items.length ? { ...ma, items } : null
}

/**
 * แบ่งรายการเป็นแผ่น — แผ่นตารางพิมพ์แบบ "หมุนบนกระดาษแนวตั้ง" (เหมือนต้นฉบับ `reg033`) ซึ่งไหลข้ามหน้าเองไม่ได้
 * (Chrome วางหน้าแนวนอนด้วยความกว้างของหน้าแนวตั้ง แล้วตัดตารางทิ้งด้านขวา · เจอตอนทำ R26)
 * · ความสูงแถวประมาณจากจำนวนบรรทัดต่อช่อง (ไม่นับสระบน/ล่าง · ปัดขึ้นทุกช่อง = ประมาณเกินไว้ก่อน)
 * · แถวเดียวที่สูงเกินแผ่นยังได้แผ่นของตัวเอง (ดีกว่าวนไม่จบ)
 */
export const MA_COLS = [6, 14, 15, 17, 17, 19, 12] as const
/** ตัวอักษรต่อบรรทัดของแต่ละคอลัมน์ (ตาราง ~1030px · 13pt · ~6.5px ต่อตัว · วัดเทียบในเบราว์เซอร์แล้ว ไม่เคยประมาณต่ำกว่าจริง) */
const MA_CPL = MA_COLS.map((w) => Math.max(4, Math.floor((w * 10.3 - 10) / 6.5)))
const ROW_LINE = 23.5
const ROW_PAD = 6
/** พื้นที่ของแถวในหนึ่งแผ่น (px ที่ 96dpi) หลังหักหัวเรื่อง หัวตาราง และขอบกระดาษ */
export const MA_PAGE_BUDGET = 520

/** สระบน/ล่าง วรรณยุกต์ ไม้หันอากาศ ฯลฯ ซ้อนบนตัวอื่น ไม่กินความกว้าง */
const THAI_MARKS = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g
const cellLines = (s: string, cpl: number) =>
  s.split(/\r?\n/).reduce((n, seg) => n + Math.max(1, Math.ceil(seg.trim().replace(THAI_MARKS, '').length / cpl)), 0)

export function maRowHeight(it: MaItem): number {
  const cells = ['00', it.name, maCell(it.drawing), maCell(it.boq), maCell(it.spec), maCell(it.detail), it.note]
  const lines = Math.max(...cells.map((c, i) => cellLines(c, MA_CPL[i])))
  return lines * ROW_LINE + ROW_PAD
}

/** แผ่นละกี่แถว — คืนช่วง [เริ่ม, จบ) ของ `maItems()` · ไม่มีรายการ = [] */
export function maPages(items: readonly MaItem[], budget = MA_PAGE_BUDGET): [number, number][] {
  const out: [number, number][] = []
  let start = 0
  let used = 0
  items.forEach((it, i) => {
    const h = maRowHeight(it)
    if (i > start && used + h > budget) {
      out.push([start, i])
      start = i
      used = 0
    }
    used += h
  })
  if (items.length) out.push([start, items.length])
  return out
}

/** ย้ายแถวขึ้น/ลง (ปุ่มลูกศรในตัวแก้) — นอกขอบ = คืนรายการเดิม */
export function moveMaItem(items: readonly MaItem[], i: number, dir: -1 | 1): MaItem[] {
  const j = i + dir
  if (i < 0 || i >= items.length || j < 0 || j >= items.length) return [...items]
  const out = [...items]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}
