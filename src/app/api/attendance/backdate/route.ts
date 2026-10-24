import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUserOrNull } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { todayInBangkok } from '@/lib/format'
import { isUuid } from '@/lib/transactions'
import { backdateDbCode, MAX_BACKDATE_REASON } from '@/lib/attendance-backdate'

export const runtime = 'nodejs'

/**
 * POST /api/attendance/backdate — หัวหน้าโครงการยื่นคำขอลงชื่อย้อนหลังหนึ่งคน
 *
 * ยังไม่ใช่การลงชื่อ: ไม่มีแถว attendance และไม่มีต้นทุนจนกว่าเจ้าของจะอนุมัติ
 * · เจ้าของลงชื่อย้อนหลังได้ตรงที่ POST /api/attendance จึงไม่ต้องใช้ทางนี้
 * · ทุกกติกา (ขอบเขตโครงการ ณ วันนั้น · เพดาน 1 วัน · ปิดรอบจ่ายแล้ว) อยู่ใน RPC
 */
export async function POST(req: NextRequest) {
  const me = await getCurrentUserOrNull()
  if (!me) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })
  if (me.role !== 'site_supervisor') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const siteId = body.siteId
  const employeeId = body.employeeId
  if (!isUuid(siteId)) return NextResponse.json({ error: 'SITE_REQUIRED' }, { status: 400 })
  if (!isUuid(employeeId)) return NextResponse.json({ error: 'EMPLOYEE_REQUIRED' }, { status: 400 })

  const workDate = String(body.workDate ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    return NextResponse.json({ error: 'DATE_INVALID' }, { status: 400 })
  }
  if (Number(workDate.slice(0, 4)) > 2200) {
    return NextResponse.json({ error: 'DATE_BUDDHIST_ERA' }, { status: 400 })
  }
  if (workDate >= todayInBangkok()) {
    return NextResponse.json({ error: 'DATE_NOT_PAST' }, { status: 400 })
  }

  const units = Number(body.workUnits ?? 1)
  if (units !== 0.5 && units !== 1) {
    return NextResponse.json({ error: 'WORK_UNITS_INVALID' }, { status: 400 })
  }
  const reason = String(body.reason ?? '').trim().slice(0, MAX_BACKDATE_REASON)
  if (reason === '') return NextResponse.json({ error: 'REASON_REQUIRED' }, { status: 400 })

  const sb = await getSupabaseServer()
  const { data, error } = await sb.rpc('attendance_backdate_request', {
    p_site: siteId,
    p_employee: employeeId,
    p_date: workDate,
    p_units: units,
    p_reason: reason,
  })
  if (error) {
    const code = backdateDbCode(error.message)
    if (code) return NextResponse.json({ error: code }, { status: code === 'FORBIDDEN' ? 403 : 409 })
    console.error('[attendance] ยื่นคำขอย้อนหลังไม่สำเร็จ', error.message)
    return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, id: data }, { status: 201 })
}
