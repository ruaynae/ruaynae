/** ห่อรูป JPEG ทีละหน้าเป็นไฟล์ PDF (หน้าละ 1 รูปเต็มหน้า) — ไฟล์ล้วน ไม่พึ่งไลบรารี
 *  ภาษาไทยวาดด้วย canvas ในเบราว์เซอร์ (จัดสระ/วรรณยุกต์ถูก) แล้วส่งมาที่นี่เป็นก้อน JPEG */
/** pageW/pageH (pt) ระบุเมื่อหน้านั้นขนาดต่างจากค่าเริ่มต้น เช่น หน้าแนวนอน */
export type PdfPage = { jpeg: Uint8Array; width: number; height: number; pageW?: number; pageH?: number }

const enc = new TextEncoder()

/** pageW/pageH เป็นหน่วย pt (A4 = 595.28 × 841.89) · รูปถูกยืดให้เต็มหน้า (สัดส่วนเดียวกันอยู่แล้ว) */
export function buildPdf(pages: PdfPage[], pageW = 595.28, pageH = 841.89, title = ''): Uint8Array {
  if (pages.length === 0) throw new Error('NO_PAGES')
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let len = 0
  const push = (b: Uint8Array | string) => {
    const u = typeof b === 'string' ? enc.encode(b) : b
    chunks.push(u)
    len += u.length
  }
  const obj = (n: number, body: () => void) => {
    offsets[n] = len
    push(`${n} 0 obj\n`)
    body()
    push('\nendobj\n')
  }

  // ลำดับวัตถุ: 1 catalog · 2 pages · 3 info · แต่ละหน้า = page, contents, image (3 ตัว)
  const pageObj = (i: number) => 4 + i * 3
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'))
  obj(2, () => {
    const kids = pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')
    push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`)
  })
  obj(3, () => push(`<< /Title <${utf16Hex(title)}> /Producer (ruaynae) >>`))
  pages.forEach((p, i) => {
    const pg = pageObj(i)
    const pw = p.pageW ?? pageW
    const ph = p.pageH ?? pageH
    obj(pg, () =>
      push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${pg + 2} 0 R >> >> /Contents ${pg + 1} 0 R >>`,
      ),
    )
    const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`
    obj(pg + 1, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`))
    obj(pg + 2, () => {
      push(
        `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      )
      push(p.jpeg)
      push('\nendstream')
    })
  })

  const count = 4 + pages.length * 3
  const xref = len
  push(`xref\n0 ${count}\n0000000000 65535 f \n`)
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`)

  const out = new Uint8Array(len)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/** ชื่อเรื่องแบบ UTF-16BE (มี BOM) เป็นเลขฐานสิบหก — PDF อ่านภาษาไทยในชื่อเอกสารได้ */
function utf16Hex(s: string): string {
  let h = 'FEFF'
  for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase()
  return h
}
