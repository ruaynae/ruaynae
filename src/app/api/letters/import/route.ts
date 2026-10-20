import { NextResponse, type NextRequest } from 'next/server'
import { denyUnlessOwner, getCurrentUser } from '@/lib/auth/current-user'
import { getSupabaseServer } from '@/lib/supabase/server'
import { matchLetterTemplate } from '@/lib/letter-templates'
import { DEFAULT_CLOSING, fillCompany, LETTER_LIMITS, stripItemNo } from '@/lib/letters'

export const runtime = 'nodejs'

/** เพดานต่อครั้ง — ไฟล์สำรองหนึ่งปีของห้างไม่เกินหลักร้อยฉบับ */
const MAX_PROJECTS = 50
const MAX_LETTERS = 3000
const CHUNK = 200

const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)
const list = (v: unknown) =>
  (Array.isArray(v) ? v : [])
    .map((x) => stripItemNo(str(x, LETTER_LIMITS.item)))
    .filter(Boolean)
    .slice(0, LETTER_LIMITS.refs)

/**
 * POST /api/letters/import — นำเข้าไฟล์สำรองจากโปรแกรมออกหนังสือแบบไฟล์เดียว (D7)
 *
 * ไฟล์สำรอง = `{ company, projects[], log[] }` ที่ปุ่ม "สำรองข้อมูล" ของโปรแกรมเดิมสร้าง
 * · ชุดเลขจับคู่ด้วยคำนำหน้า (ไม่สนตัวพิมพ์) — มีอยู่แล้วใช้ของเดิม ไม่มีสร้างใหม่
 * · หนังสือเลขซ้ำ (ชุด+ปี+เลขเดียวกัน) ข้าม — **กดนำเข้าซ้ำได้ ไม่เกิดฉบับซ้ำ** (R19-API-08)
 * · หัวกระดาษของฉบับเก่ามาจากไฟล์สำรอง (ตามที่ออกไปจริง) ไม่ใช่ข้อมูลบริษัทปัจจุบัน
 *
 * 🔴 ข้อความหนังสือของลูกค้าเข้าทางนี้เท่านั้น ไม่อยู่ใน migration/seed — repo เป็น public
 */
export async function POST(req: NextRequest) {
  const denied = await denyUnlessOwner()
  if (denied) return denied

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'IMPORT_INVALID' }, { status: 422 })
  }
  const company = (body.company ?? {}) as Record<string, unknown>
  const projects = Array.isArray(body.projects) ? (body.projects as Record<string, unknown>[]) : null
  const log = Array.isArray(body.log) ? (body.log as Record<string, unknown>[]) : null
  if (!projects || !log || projects.length > MAX_PROJECTS || log.length > MAX_LETTERS) {
    return NextResponse.json({ error: 'IMPORT_INVALID' }, { status: 422 })
  }

  const sb = await getSupabaseServer()
  const me = await getCurrentUser()

  const { data: existing, error: eErr } = await sb
    .from('letter_series').select('id, prefix').order('created_at', { ascending: true }).range(0, 499)
  if (eErr) {
    console.error('[letters] อ่านชุดเลขก่อนนำเข้าไม่ได้', eErr.message)
    return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
  }
  const byPrefix = new Map((existing ?? []).map((s) => [s.prefix.toLowerCase(), s.id]))

  // ── ชุดเลข ──────────────────────────────────────────────────────────
  const seriesOf = new Map<string, { id: string; intro: string; title: string }>()
  let seriesCreated = 0
  for (const p of projects) {
    const prefix = str(p.prefix, 12)
    if (!/^[^\s/]{1,12}$/.test(prefix)) continue
    const intro = str(p.intro, LETTER_LIMITS.intro)
    let id = byPrefix.get(prefix.toLowerCase())
    if (!id) {
      const { data, error } = await sb
        .from('letter_series')
        .insert({
          label: str(p.label, 80) || prefix,
          prefix,
          recipient: str(p.to, 300),
          contract_ref: str(p.ref1, 300),
          intro,
          signer_title: str(p.position, 80),
        })
        .select('id')
        .maybeSingle()
      if (error || !data) {
        console.error('[letters] สร้างชุดเลขจากไฟล์สำรองไม่ได้', error?.message)
        return NextResponse.json({ error: 'CREATE_FAILED' }, { status: 500 })
      }
      id = data.id
      byPrefix.set(prefix.toLowerCase(), id)
      seriesCreated += 1
    }
    // ตำแหน่งใต้ลายเซ็นอยู่ที่โครงการในไฟล์สำรอง ไม่ใช่ที่หนังสือแต่ละฉบับ
    seriesOf.set(String(p.id ?? ''), { id, intro, title: str(p.position, 80) })
  }

  // ── หนังสือ ─────────────────────────────────────────────────────────
  const companyName = str(company.name, 200)
  const letterhead = {
    companyName,
    address: str(company.address, 300),
    signerName: str(company.signer, 120),
  }
  const rows = []
  let skipped = 0
  for (const e of log) {
    const series = seriesOf.get(String(e.projectId ?? ''))
    const seq = Number(e.num)
    const date = String(e.date ?? '')
    const subject = str(e.subject, LETTER_LIMITS.subject)
    const recipient = str(e.to, LETTER_LIMITS.recipient)
    if (
      !series || !Number.isInteger(seq) || seq < 1 || seq > 99999 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number(date.slice(0, 4)) > 2200 || !subject || !recipient
    ) {
      skipped += 1
      continue
    }
    rows.push({
      series_id: series.id,
      seq,
      letter_date: date,
      subject,
      recipient,
      refs: list(e.refs),
      attachments: list(e.atts),
      body: str(e.body, LETTER_LIMITS.body),
      closing: str(e.closing, LETTER_LIMITS.closing) || DEFAULT_CLOSING,
      intro: e.intro === false || !series.intro ? null : fillCompany(series.intro, companyName),
      signer_title: series.title,
      show_receipt: e.receipt !== false,
      template_id: typeof e.tplId === 'string' ? e.tplId.slice(0, 40) : matchLetterTemplate(subject)?.id ?? null,
      fields: {},
      letterhead,
      created_by: me.id,
    })
  }

  let imported = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { data, error } = await sb
      .from('letters')
      .upsert(rows.slice(i, i + CHUNK), { onConflict: 'series_id,year_ce,seq', ignoreDuplicates: true })
      .select('id')
    if (error) {
      console.error('[letters] นำเข้าหนังสือไม่สำเร็จ', error.message)
      return NextResponse.json({ error: 'CREATE_FAILED', imported }, { status: 500 })
    }
    imported += data?.length ?? 0
  }

  return NextResponse.json({
    ok: true,
    seriesCreated,
    imported,
    duplicates: rows.length - imported,
    skipped,
  })
}
