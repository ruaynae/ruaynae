import 'server-only'
import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isUuid } from '@/lib/transactions'
import { planFromRow, PLAN_COLUMNS, type SavedPlan } from '@/lib/boq/plan-store'
import { domesticFromRow, DOMESTIC_COLUMNS, type SavedDomestic } from '@/lib/boq/domestic-store'

/**
 * ของใช้ร่วมของ API แผนงานที่บันทึกไว้ (R20i)
 * · ตารางยังไม่ถูกสร้าง (ยังไม่ได้รัน migration) → 503 `PLAN_TABLE_MISSING` ให้หน้าจอบอกได้ตรง ๆ
 *   แทนที่จะเป็น "บันทึกไม่สำเร็จ" ที่ไม่มีใครรู้ว่าต้องทำอะไร
 */
export const isTableMissing = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === 'PGRST205' || e.code === '42P01' || /construction_plans|domestic_plans/.test(e.message ?? '') && /does not exist|schema cache/.test(e.message ?? ''))

export function dbFail(tag: string, e: { code?: string; message?: string }, code: string, missing = 'PLAN_TABLE_MISSING') {
  if (isTableMissing(e)) return NextResponse.json({ error: missing }, { status: 503 })
  console.error(`[plans] ${tag}`, e.message)
  return NextResponse.json({ error: code }, { status: 500 })
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const v = await req.json()
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

type Load =
  | { state: 'ok'; plan: SavedPlan; sites: { id: string; name: string }[] }
  | { state: 'not_found' | 'missing' | 'error' }

/** อ่านแผนงานหนึ่งฉบับ (+ รายชื่อโครงการสำหรับช่องผูกโครงการ) — ใช้ทั้งหน้าแผนงานและหน้าแก้ */
export async function loadPlan(id: string, withSites: boolean): Promise<Load> {
  if (!isUuid(id)) return { state: 'not_found' }
  const sb = await getSupabaseServer()
  const [{ data, error }, sites] = await Promise.all([
    sb.from('construction_plans').select(PLAN_COLUMNS).eq('id', id).maybeSingle(),
    withSites
      ? sb.from('sites').select('id, name').order('name', { ascending: true }).range(0, 199)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (error) {
    if (isTableMissing(error)) return { state: 'missing' }
    console.error('[plans] อ่านแผนงานไม่ได้', error.message)
    return { state: 'error' }
  }
  if (!data) return { state: 'not_found' }
  const plan = planFromRow(data as Record<string, unknown>)
  if (!plan) {
    console.error('[plans] แผนงานรูปร่างเพี้ยน', id)
    return { state: 'error' }
  }
  if (sites.error) console.error('[plans] อ่านรายชื่อโครงการไม่ได้', sites.error.message)
  return { state: 'ok', plan, sites: sites.data ?? [] }
}

type LoadDomestic =
  | { state: 'ok'; plan: SavedDomestic; sites: { id: string; name: string }[] }
  | { state: 'not_found' | 'missing' | 'error' }

/** อ่านแผนการใช้วัสดุในประเทศหนึ่งฉบับ (R22b) + รายชื่อโครงการสำหรับช่องผูกโครงการ */
export async function loadDomestic(id: string): Promise<LoadDomestic> {
  if (!isUuid(id)) return { state: 'not_found' }
  const sb = await getSupabaseServer()
  const [{ data, error }, sites] = await Promise.all([
    sb.from('domestic_plans').select(DOMESTIC_COLUMNS).eq('id', id).maybeSingle(),
    sb.from('sites').select('id, name').order('name', { ascending: true }).range(0, 199),
  ])
  if (error) {
    if (isTableMissing(error)) return { state: 'missing' }
    console.error('[plans] อ่านแผนการใช้วัสดุไม่ได้', error.message)
    return { state: 'error' }
  }
  if (!data) return { state: 'not_found' }
  const plan = domesticFromRow(data as Record<string, unknown>)
  if (!plan) {
    console.error('[plans] แผนการใช้วัสดุรูปร่างเพี้ยน', id)
    return { state: 'error' }
  }
  if (sites.error) console.error('[plans] อ่านรายชื่อโครงการไม่ได้', sites.error.message)
  return { state: 'ok', plan, sites: sites.data ?? [] }
}
