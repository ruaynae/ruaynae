import { NextResponse } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { dbFail } from '@/lib/plans-server'

export const runtime = 'nodejs'

/**
 * GET /api/plans/sites — โครงการที่สร้างไว้ + ข้อมูลสัญญา ให้ฟอร์ม "สร้างแผนงานจาก BOQ" ดึงมาเติมช่อง (เจ้าของเท่านั้น)
 * · เรียกจากปุ่ม "ดึงข้อมูลจากโครงการ" ในแท็บสร้างแผนงาน · `site_finance` อ่านได้เฉพาะเจ้าของ (RLS)
 * · ชื่อผู้รับจ้างคือชื่อบริษัทจาก `branding` (ไม่มีชื่อบริษัทในโค้ด · §5)
 */
export async function GET() {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const sb = await getSupabaseServer()
  const [sites, fin, branding] = await Promise.all([
    sb.from('sites').select('id, name, full_name, client_name, address, start_date, end_date, status')
      .order('name', { ascending: true }).range(0, 199),
    sb.from('site_finance').select('site_id, contract_amount, contract_no, contract_date').range(0, 499),
    sb.from('branding').select('company_name').maybeSingle(),
  ])
  if (sites.error) return dbFail('อ่านรายชื่อโครงการไม่ได้', sites.error, 'LOAD_FAILED')
  if (fin.error) console.error('[plans] อ่านข้อมูลสัญญาไม่ได้', fin.error.message)
  const byId = new Map((fin.data ?? []).map((f) => [f.site_id, f]))
  return NextResponse.json({
    company: branding.data?.company_name?.trim() ?? '',
    sites: (sites.data ?? []).map((s) => {
      const f = byId.get(s.id)
      return {
        id: s.id,
        name: s.name,
        fullName: s.full_name ?? '',
        clientName: s.client_name ?? '',
        address: s.address ?? '',
        start: s.start_date,
        end: s.end_date,
        contractAmount: f && f.contract_amount > 0 ? Number(f.contract_amount) : null,
        contractNo: f?.contract_no ?? '',
        contractDate: f?.contract_date ?? null,
      }
    }),
  })
}
