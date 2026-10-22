import { norm, type Grid } from './core'

/**
 * อ่าน BOQ แบบ Excel 97–2003 (.xls) — exceljs อ่านได้แค่ .xlsx จึงใช้ SheetJS เฉพาะไฟล์ชนิดนี้
 * · โหลดตอนเจอไฟล์ .xls เท่านั้น (`import()`) · ติดตั้งจาก cdn.sheetjs.com (รุ่นบน npm เก่าและมีช่องโหว่)
 * · ช่องที่ผสาน: SheetJS เก็บค่าไว้ที่ช่องแรกช่องเดียว ช่องลูกว่าง — ตรงกับ `toGrid()` ของ exceljs
 * · ช่องสูตรได้ค่าที่ Excel คำนวณเก็บไว้ (ไม่คำนวณใหม่) เหมือนฝั่ง .xlsx
 */

/** ไฟล์ .xls = OLE2 compound document ขึ้นต้นด้วย D0 CF 11 E0 · .xlsx = zip ขึ้นต้นด้วย PK */
export const isXls = (buf: ArrayBuffer) => {
  const b = new Uint8Array(buf, 0, Math.min(4, buf.byteLength))
  return b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0
}

/** สูตรที่เป็นแค่การอ้างช่องเดียว เช่น `'1 งานครุภัณฑ์'!B11` หรือ `$C$5` */
const SIMPLE_REF = /^(?:'((?:[^']|'')+)'|([^'!:]+))?!?\$?([A-Z]{1,3})\$?(\d+)$/

export async function readXlsGrids(buf: ArrayBuffer): Promise<Grid[]> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(buf, { type: 'array', cellDates: true, cellFormula: true, cellHTML: false })
  type Cell = { v?: unknown; f?: string }
  /**
   * 🔴 ช่องที่เป็นสูตรอ้างช่องเดียว (ชื่องานใน ปร.5 ดึงจาก ปร.4) — ใช้ค่าของช่องต้นทางแทนค่าที่แคชไว้
   * เจอไฟล์ .xls ที่แคชผลของสูตรข้อความเป็น 0 แล้วชื่องานกลายเป็น "0" ทั้งหมวด · ไล่ต่อได้ไม่เกิน 8 ชั้น
   */
  const valueOf = (sheet: string, cell: Cell | undefined, depth = 0): unknown => {
    if (!cell) return null
    const m = cell.f && depth < 8 ? SIMPLE_REF.exec(cell.f.replace(/^=/, '')) : null
    if (m) {
      const target = m[1] != null ? m[1].replace(/''/g, "'") : m[2] ?? sheet
      const ws = wb.Sheets[target]
      if (ws) return valueOf(target, ws[`${m[3]}${m[4]}`] as Cell | undefined, depth + 1)
    }
    return cell.v ?? null
  }
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name]
    const ref = ws['!ref']
    const range = ref ? XLSX.utils.decode_range(ref) : { s: { r: 0, c: 0 }, e: { r: -1, c: -1 } }
    const rows = Math.min(range.e.r + 1, 3000)
    const cols = Math.min(range.e.c + 1, 40)
    const data: unknown[][] = []
    for (let r = 0; r < rows; r += 1) {
      const line: unknown[] = []
      for (let c = 0; c < cols; c += 1) {
        const x = valueOf(name, ws[XLSX.utils.encode_cell({ r, c })] as Cell | undefined)
        line.push(typeof x === 'string' || typeof x === 'number' || x instanceof Date ? x : null)
      }
      data.push(line)
    }
    const v = (r: number, c: number) => data[r]?.[c] ?? null
    return { name, rows, cols, v, w: (r: number, c: number) => norm(v(r, c)) }
  })
}
