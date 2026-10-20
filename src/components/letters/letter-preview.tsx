'use client'

import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { LetterPaper } from '@/components/letters/letter-paper'

/** กระดาษ A4 ที่ 96dpi — ต้องตรงกับ `.letter-sheet` ใน globals.css */
const SHEET_W = 794
const SHEET_H = 1123
/** ขอบล่าง 0.75″ — เนื้อหาที่เลยเส้นนี้จะไปอยู่หน้า 2 */
const BOTTOM = 72

/**
 * กระดาษตัวอย่างสด — ย่อทั้งแผ่นให้พอดีคอลัมน์ และบอกเมื่อเนื้อหาเลยไปหน้า 2
 * (R19-UI-07) · วัดจากย่อหน้าสุดท้ายที่อยู่ในกระแส (กล่อง "รับเอกสารแล้ว" ลอยเหมือนใน Word จึงไม่นับ)
 *
 * 🔴 วัดใน callback ของ observer ไม่ใช่ใน effect ตรง ๆ — setState ใน effect คือ
 * cascading render ที่ lint ของ React 19 ถือเป็น error (§17 ข้อ 16) · ตัดบรรทัดภาษาไทย
 * รู้ได้จากเบราว์เซอร์เท่านั้น จึงต้องวัดหลังวาดทุกครั้งที่ข้อความเปลี่ยน
 */
export function LetterPreview(props: Omit<ComponentProps<typeof LetterPaper>, 'breakAt'>) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(0.6)
  const [breakAt, setBreakAt] = useState<number | null>(null)

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const measure = () => {
      const sheet = box.querySelector<HTMLElement>('[data-letter-page="1"]')
      if (!sheet) return
      const flow = Array.from(sheet.children).filter(
        (el): el is HTMLElement => el instanceof HTMLElement && !el.classList.contains('lt-break'),
      )
      const last = flow[flow.length - 1]
      const bottom = last ? last.offsetTop + last.offsetHeight : 0
      const limit = SHEET_H - BOTTOM
      setBreakAt(bottom > limit ? limit : null)
    }
    // ResizeObserver ยิงครั้งแรกทันทีที่เริ่มดู — ได้ทั้งขนาดย่อและการวัดรอบแรก
    const ro = new ResizeObserver(() => {
      setZoom(Math.min(1, Math.max(0.3, box.clientWidth / SHEET_W)))
      measure()
    })
    const mo = new MutationObserver(measure)
    ro.observe(box)
    mo.observe(box, { subtree: true, childList: true, characterData: true })
    // ฟอนต์มาช้ากว่าข้อความ — วัดซ้ำเมื่อโหลดเสร็จ ไม่งั้นตำแหน่งขึ้นหน้าใหม่คิดจากฟอนต์สำรอง
    document.fonts?.ready.then(measure).catch(() => {})
    return () => { ro.disconnect(); mo.disconnect() }
  }, [])

  return (
    <div ref={boxRef} className="w-full">
      <div className="letter-zoom" style={{ ['--lz' as string]: zoom }}>
        <LetterPaper {...props} breakAt={breakAt} />
      </div>
    </div>
  )
}
