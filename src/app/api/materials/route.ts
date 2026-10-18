import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { mrErrorResponse } from '@/lib/materials-server'
import { getSupabaseServer } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/materials — หัวหน้าโครงการ (หรือเจ้าของ) คีย์ใบขอเบิกวัสดุแทนช่าง (R18)
 * สิทธิ์และการตรวจทั้งหมดอยู่ใน RPC `material_request_create` · ที่นี่แค่ทำรูปข้อมูลให้ถูก
 */
export async function POST(req: NextRequest) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })

  let siteId = ''
  let employeeId: string | null = null
  let note: string | null = null
  let lines: { variant_id: string; qty: number }[] = []
  try {
    const b = await req.json()
    siteId = String(b?.siteId ?? '')
    employeeId = b?.employeeId ? String(b.employeeId) : null
    note = typeof b?.note === 'string' ? b.note.slice(0, 600) : null
    lines = Array.isArray(b?.lines)
      ? b.lines.slice(0, 60).map((l: { variantId?: unknown; qty?: unknown }) => ({
          variant_id: String(l?.variantId ?? ''),
          qty: Number(l?.qty),
        }))
      : []
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }
  if (!UUID.test(siteId)) return NextResponse.json({ error: 'MR_SITE_REQUIRED' }, { status: 400 })
  if (employeeId && !UUID.test(employeeId)) return NextResponse.json({ error: 'MR_EMPLOYEE_INVALID' }, { status: 400 })

  const sb = await getSupabaseServer()
  const { data, error } = await sb.rpc('material_request_create', {
    p_site: siteId,
    p_employee: employeeId,
    p_note: note,
    p_lines: lines as never,
  })
  if (error) return mrErrorResponse(error.message, 'สร้างใบขอเบิกไม่สำเร็จ')
  return NextResponse.json({ ok: true, ...(data as { id: string; request_no: string }) }, { status: 201 })
}
