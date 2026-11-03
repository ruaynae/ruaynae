import { getSupabaseServer } from '@/lib/supabase/server'
import { loadCatalog, loadStamp } from '@/lib/material-library-server'
import { PageHeader } from '@/components/ui/page-header'
import { DataError } from '@/components/ui/data-error'
import { MaterialLibraryClient } from '@/components/letters/material-library-client'

export const metadata = { title: 'คลังวัสดุขออนุมัติ' }

/**
 * คลังวัสดุขออนุมัติ (R27) — เก็บวัสดุที่ใช้ประจำพร้อมแค็ตตาล็อก แล้วเลือกเข้าหนังสือ "ขออนุมัติใช้วัสดุ"
 * · เจ้าของเท่านั้น (เช็คที่ `letters/layout.tsx` ไม่ใช่ที่นี่ — §17 ข้อ 6)
 * · โหลดรวมที่ซ่อนไว้ด้วย (กรองบนจอ) · ยังไม่รัน migration = บอกขั้นตอน ไม่ใช่หน้าพัง
 */
export default async function MaterialLibraryPage() {
  const sb = await getSupabaseServer()
  const [r, stamp] = await Promise.all([loadCatalog(sb, { includeInactive: true }), loadStamp(sb)])
  if (r.failed) return <DataError message="โหลดคลังวัสดุไม่สำเร็จ" />
  return (
    <>
      <PageHeader
        title="คลังวัสดุขออนุมัติ"
        subtitle="เก็บวัสดุที่ใช้ประจำพร้อมแค็ตตาล็อก — ตอนทำหนังสือขออนุมัติใช้วัสดุกด “เลือกจากคลังวัสดุ” รายการและแค็ตตาล็อกมาเอง"
        backHref="/letters"
      />
      <MaterialLibraryClient items={r.items} missing={r.missing} stampUrl={stamp.url} />
    </>
  )
}
