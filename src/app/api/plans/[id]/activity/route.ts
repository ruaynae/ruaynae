import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/transactions'
import { dbFail } from '@/lib/plans-server'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }
const PAGE = 1000
const MAX_PAGES = 30
const DAY = 864e5

/**
 * GET /api/plans/[id]/activity — ต้นทุนรายสัปดาห์ของโครงการที่ผูกกับแผน (ค่าแรงที่ลงชื่อ + รายจ่ายที่อนุมัติแล้ว)
 * · ใช้ประมาณรูปทรงผลงานรายสัปดาห์ในหน้าแผนงาน (ปุ่ม "ประมาณจากข้อมูลในระบบ") — ค่าประมาณ ไม่ใช่ % ที่ตรวจรับ
 * · เจ้าของเท่านั้น · สัปดาห์นับจากวันเริ่มของแผน (W1 = วันเริ่ม) · ทุก query มี order + range (§7)
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const denied = await denyUnlessOwner()
  if (denied) return denied
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'PLAN_NOT_FOUND' }, { status: 404 })
  const sb = await getSupabaseServer()
  const { data: plan, error: pErr } = await sb
    .from('construction_plans').select('site_id, start_date, days, site:sites(name)').eq('id', id).maybeSingle()
  if (pErr) return dbFail('อ่านแผนงานไม่ได้', pErr, 'LOAD_FAILED')
  if (!plan) return NextResponse.json({ error: 'PLAN_NOT_FOUND' }, { status: 404 })
  if (!plan.site_id) return NextResponse.json({ error: 'PLAN_NO_SITE' }, { status: 422 })

  const start = plan.start_date
  const weeks = Math.max(1, Math.ceil(plan.days / 7))
  const to = new Date(Date.parse(`${start}T00:00:00Z`) + (plan.days - 1) * DAY).toISOString().slice(0, 10)
  const weekOf = (iso: string) => {
    const k = Math.floor((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY / 7)
    return k >= 0 && k < weeks ? k : null
  }
  const labor = new Array<number>(weeks).fill(0)
  const expense = new Array<number>(weeks).fill(0)
  let capped = false

  for (let pg = 0; pg < MAX_PAGES; pg += 1) {
    const { data, error } = await sb
      .from('attendance')
      .select('id, work_date, attendance_wages(amount)')
      .eq('site_id', plan.site_id).gte('work_date', start).lte('work_date', to)
      .order('work_date', { ascending: true }).order('id', { ascending: true })
      .range(pg * PAGE, pg * PAGE + PAGE - 1)
    if (error) return dbFail('อ่านการลงชื่อไม่ได้', error, 'LOAD_FAILED')
    for (const r of data ?? []) {
      const k = weekOf(r.work_date)
      const w = r.attendance_wages as { amount: number | null } | { amount: number | null }[] | null
      const amt = Array.isArray(w) ? Number(w[0]?.amount ?? 0) : Number(w?.amount ?? 0)
      if (k != null) labor[k] += amt
    }
    if ((data ?? []).length < PAGE) break
    if (pg === MAX_PAGES - 1) capped = true
  }
  for (let pg = 0; pg < MAX_PAGES; pg += 1) {
    const { data, error } = await sb
      .from('transactions')
      .select('id, txn_date, amount')
      .eq('site_id', plan.site_id).eq('kind', 'expense').eq('status', 'approved')
      .gte('txn_date', start).lte('txn_date', to)
      .order('txn_date', { ascending: true }).order('id', { ascending: true })
      .range(pg * PAGE, pg * PAGE + PAGE - 1)
    if (error) return dbFail('อ่านรายจ่ายไม่ได้', error, 'LOAD_FAILED')
    for (const r of data ?? []) {
      const k = weekOf(r.txn_date)
      if (k != null) expense[k] += Number(r.amount)
    }
    if ((data ?? []).length < PAGE) break
    if (pg === MAX_PAGES - 1) capped = true
  }
  const site = plan.site as { name?: string } | { name?: string }[] | null
  return NextResponse.json({
    siteName: (Array.isArray(site) ? site[0]?.name : site?.name) ?? '',
    start, weeks, labor, expense, capped,
  })
}
