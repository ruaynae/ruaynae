import Link from 'next/link'
import { ArrowRight, HandCoins } from 'lucide-react'
import { fmtBaht } from '@/lib/format'

/**
 * แถบเตือน "มีคนเบิกเกินค่าแรงค้างจ่าย" บนหน้าแรก — **เจ้าของเท่านั้น**
 * (คำสั่งเจ้าของ 22 ก.ย. 2569: *"เราต้องมีลอจิกเก็บยอดติดลบไว้ด้วยของคนงานแต่ละคน"*)
 *
 * 🔴 เบิกเกิน **ไม่ใช่ความผิดพลาด** — เจ้าของอนุญาตเอง (20 ก.ย. 2569) แถบนี้จึงเป็น
 * สีส้มของ "ต้องรู้ไว้" ไม่ใช่สีแดงของ "มีอะไรพัง" · หน้าที่ของมันคือทำให้ยอดที่
 * บริษัทจ่ายล่วงหน้าไปแล้วไม่หายไปอยู่ในหน้าที่ไม่มีใครเปิด
 *
 * · ไม่มีใครติดลบ = **ไม่วาดอะไรเลย** — แถบที่ขึ้นทุกวันคือแถบที่คนเลิกอ่าน
 * · ยอดจะลดลงเองทุกครั้งที่คนนั้นมาทำงาน (ค่าแรงใหม่เข้าไปในสูตรทันที)
 *   และถูกหักจริงตอนกดจ่ายค่าแรง
 */
export function OverdrawnAlert({ people, total }: { people: number; total: number }) {
  if (people === 0) return null
  return (
    <Link
      href="/payroll"
      className="mb-5 flex items-center gap-3 rounded-lg border-2 border-status-progress bg-status-progress-bg px-4 py-3.5 transition-colors duration-100 hover:border-status-progress-ring"
    >
      <HandCoins className="size-7 shrink-0 text-status-progress" strokeWidth={1.8} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-base font-bold leading-6 text-status-progress">
          คนงานเบิกเกินค่าแรงค้างจ่าย {people} คน · รวม{' '}
          <span className="tnum">{fmtBaht(total)}</span>
        </span>
        <span className="block text-sm text-ink-2">
          ยอดนี้จะลดลงเองเมื่อเขามาทำงาน และถูกหักคืนตอนกดจ่ายค่าแรง — กดเพื่อดูรายคน
        </span>
      </span>
      <ArrowRight className="size-5 shrink-0 text-status-progress" aria-hidden />
    </Link>
  )
}
