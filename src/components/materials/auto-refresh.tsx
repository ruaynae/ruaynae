'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/**
 * โหลดข้อมูลหน้าใหม่ทุก `seconds` วินาที และทันทีที่กลับมาเปิดแท็บ (R18 · หน้าจอแคชเชียร์)
 * ใบขอเบิกใหม่จึงโผล่บนแท็บเล็ตเองโดยไม่ต้องกดรีเฟรช · แจ้งเตือนกระดิ่ง/push มาจากตัวส่งเดิม
 */
export function AutoRefresh({ seconds = 20 }: { seconds?: number }) {
  const router = useRouter()
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') router.refresh()
    }
    const id = setInterval(tick, seconds * 1000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [router, seconds])
  return null
}
