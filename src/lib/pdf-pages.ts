/**
 * แปลงไฟล์ PDF เป็นรูปทีละหน้า (ฝั่งเบราว์เซอร์) — ให้แนบท้ายหนังสือเหมือนรูปภาพ
 *
 * 🔴 โหลด pdf.js จาก CDN ตอนกดแนบเท่านั้น (ติดตั้งแพ็กเกจเพิ่มไม่ได้ในเครื่องที่เขียน · หนังสือส่วนใหญ่ไม่มี PDF)
 *    ต้องออนไลน์ · ล้มเหลว = โยนข้อความไทยให้หน้าจอแสดง
 */
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build'
const MAX_WIDTH = 1600

type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number }
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> }
  cleanup?: () => void
}
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy?: () => Promise<void> }
type PdfLib = {
  GlobalWorkerOptions: { workerSrc: string }
  getDocument: (o: { data: Uint8Array }) => { promise: Promise<PdfDoc> }
}

let lib: Promise<PdfLib> | null = null
function loadLib(): Promise<PdfLib> {
  lib ??= import(/* webpackIgnore: true */ /* turbopackIgnore: true */ `${PDFJS}/pdf.min.mjs`).then((m: PdfLib) => {
    m.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.mjs`
    return m
  })
  lib.catch(() => { lib = null })
  return lib
}

/** จำนวนหน้า + ตัวแปลงทีละหน้า — เรียก `page(n)` ได้ n = 1..pages */
export async function openPdf(file: File): Promise<{ pages: number; page: (n: number) => Promise<File>; close: () => void }> {
  let pdfjs: PdfLib
  try {
    pdfjs = await loadLib()
  } catch {
    throw new Error('PDF_LIB')
  }
  const data = new Uint8Array(await file.arrayBuffer())
  let doc: PdfDoc
  try {
    doc = await pdfjs.getDocument({ data }).promise
  } catch {
    throw new Error('PDF_BAD')
  }
  const base = file.name.replace(/\.pdf$/i, '')
  return {
    pages: doc.numPages,
    async page(n) {
      const p = await doc.getPage(n)
      const v1 = p.getViewport({ scale: 1 })
      const viewport = p.getViewport({ scale: Math.min(3, MAX_WIDTH / Math.max(v1.width, v1.height) * (v1.height > v1.width ? 1.4 : 1)) })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('PDF_CANVAS')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await p.render({ canvasContext: ctx, viewport }).promise
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82))
      p.cleanup?.()
      if (!blob) throw new Error('PDF_CANVAS')
      return new File([blob], `${base}-หน้า${n}.jpg`, { type: 'image/jpeg' })
    },
    close() { void doc.destroy?.() },
  }
}

export function pdfErrorText(e: unknown): string {
  const m = e instanceof Error ? e.message : ''
  if (m === 'PDF_LIB') return 'โหลดตัวอ่าน PDF ไม่ได้ — ตรวจอินเทอร์เน็ตแล้วลองใหม่'
  if (m === 'PDF_BAD') return 'เปิดไฟล์ PDF นี้ไม่ได้ (ไฟล์เสียหรือมีรหัสผ่าน)'
  return 'แปลงหน้า PDF ไม่สำเร็จ ลองใหม่อีกครั้ง'
}
