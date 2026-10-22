'use client'

import { useEffect } from 'react'
import { fixBuddhistYear } from '@/lib/buddhist-year'

/**
 * แก้ปี พ.ศ. ในช่องวันที่ทุกช่องของแอป ให้เป็น ค.ศ. ทันทีที่กรอก (เจ้าของแจ้ง 22 ต.ค. 2569)
 *
 * อาการเดิม: พิมพ์ปี 2569 ลงช่อง `<input type="date">` → เซิร์ฟเวอร์ปฏิเสธ `DATE_BUDDHIST_ERA`
 * ถูกต้องแล้ว แต่ข้อความบอกให้ "เลือกจากปฏิทิน" — ซึ่ง**แก้ไม่ได้** เพราะปฏิทินเปิดที่ปีของค่าในช่อง
 * (2569) คนจึงเลือกวันใหม่ในปี 2569 ซ้ำ ๆ แล้วโดนปฏิเสธซ้ำ ๆ ทุกช่องที่เคยพิมพ์ไว้
 *
 * ทางแก้ที่ครอบทุกฟอร์มในจุดเดียว: ดัก `input` ระดับ document ช่วง capture (ก่อนที่ React
 * ซึ่งฟังอยู่ที่ root จะอ่านค่า) แล้วเขียนปี − 543 กลับลงช่องด้วย setter ของเบราว์เซอร์
 * · ช่องจึงโชว์ปี ค.ศ. ให้เห็นทันที และ state ของ React ได้ค่าที่ถูกตั้งแต่แรก
 * · ด่านที่เซิร์ฟเวอร์ (`DATE_BUDDHIST_ERA`) ยังอยู่ครบ — ตัวนี้แค่ทำให้คนไม่ต้องไปชนมัน
 */
export function BuddhistYearFix() {
  useEffect(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    const onInput = (e: Event) => {
      const el = e.target
      if (!(el instanceof HTMLInputElement) || (el.type !== 'date' && el.type !== 'month')) return
      const fixed = fixBuddhistYear(el.value)
      if (fixed !== el.value) setter?.call(el, fixed)
    }
    document.addEventListener('input', onInput, true)
    document.addEventListener('change', onInput, true)
    return () => {
      document.removeEventListener('input', onInput, true)
      document.removeEventListener('change', onInput, true)
    }
  }, [])
  return null
}
