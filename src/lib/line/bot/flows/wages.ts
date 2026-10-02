import { PutObjectCommand } from '@aws-sdk/client-s3'
import { preview } from '@/lib/line/render'
import { objectKey, presignGet, r2, r2Bucket } from '@/lib/r2'
import { cleanMonths, defaultMonth, isOpenMonth, monthShort, parseMonth } from '@/lib/wage-month'
import { rpc, send, setState } from '../api'
import { copy } from '../copy'
import { choices, data, matchByName, menuItems, text, type QuickItem } from '../messages'
import type { Turn } from '../types'
import { baht, today } from '../util'
import { wageSlipImage, type WageDetail } from '../wage-slip'

// เมนู 5 · ค่าแรงคงค้าง: เลือกเดือน → รายชื่อคนที่มียอดของเดือนนั้น → ใบสรุปเป็นรูป (ส่งต่อให้คนงานได้)
// "เดือนใครเดือนมันคับ" (คำขอเจ้าของ 2 ต.ค. 2569) — ตัวเลขทุกตัวมาจาก payroll_month_balances()

type Person = { id: string; name: string; days: number; balance: number }

// ลิงก์รูปที่ LINE ใช้ต้องอยู่ได้นานพอให้คนเปิดดูทีหลัง · presigned ของ R2 ได้สูงสุด 7 วัน
const LINE_URL_SECONDS = 7 * 24 * 60 * 60

const months = async (turn: Turn) => cleanMonths(await rpc<unknown>('bot_wage_months', { p_line_user: turn.lineUserId }))

const list = (turn: Turn, month: string) =>
  rpc<Person[]>('bot_wage_list', { p_line_user: turn.lineUserId, p_month: month })

/** เดือนจากปุ่ม/เซสชัน · ปุ่มเก่าที่ส่งก่อนมีเดือน (หรืออ่านไม่ออก) = เดือนที่ระบบเลือกให้ */
async function resolveMonth(turn: Turn, raw: unknown): Promise<string> {
  return parseMonth(raw) ?? defaultMonth(await months(turn), today())
}

const monthButton = (month: string) =>
  `${monthShort(month)}${isOpenMonth(month, today()) ? ` ${copy.wage.openMonth}` : ''}`

const afterItems = (month: string): QuickItem[] => [
  { label: copy.wage.other, data: data({ a: 'wm', mo: month }) },
  ...menuItems(),
]

export async function showWageList(turn: Turn) {
  const all = await months(turn)
  if (all.length === 0) {
    await setState(turn, 'idle')
    return send(turn, [text(copy.wage.none, menuItems())])
  }
  if (all.length === 1) return showMonth(turn, all[0])
  await setState(turn, 'idle')
  return send(turn, [
    text(copy.wage.askMonth, menuItems()),
    choices(copy.wage.pickMonth, copy.wage.pickMonth,
      all.map((m) => ({ label: monthButton(m), data: data({ a: 'wm', mo: m }) }))),
  ])
}

export async function showMonth(turn: Turn, raw: unknown) {
  const month = await resolveMonth(turn, raw)
  const people = await list(turn, month)
  if (people.length === 0) {
    await setState(turn, 'idle')
    return send(turn, [text(copy.wage.noneMonth(monthShort(month)), menuItems())])
  }
  await setState(turn, 'wage_pick', { month })
  const total = people.reduce((s, p) => s + Math.max(0, Number(p.balance)), 0)
  const over = people.filter((p) => Number(p.balance) < 0).length
  const label = (p: Person) => `${p.name} ${Number(p.balance) < 0 ? '−' : ''}${baht(Math.abs(Number(p.balance)))}`
  return send(turn, [
    text(
      copy.wage.head(monthShort(month), people.length, baht(total), over) +
        (people.length > 48 ? `\n${copy.wage.tooMany(people.length - 48)}` : ''),
      menuItems(),
    ),
    choices(copy.wage.pick, copy.wage.pick,
      people.map((p) => ({ label: label(p), data: data({ a: 'wg', e: p.id, mo: month }) }))),
  ])
}

/** พิมพ์ชื่อคนระหว่างเลือก */
export async function onText(turn: Turn, raw: string) {
  const month = await resolveMonth(turn, turn.session.payload.month)
  const hit = matchByName(await list(turn, month), raw)
  if (!hit) return send(turn, [text(copy.wage.notFound, afterItems(month))])
  return showWageSlip(turn, hit.id, month)
}

async function upload(body: Buffer, ext: 'png' | 'jpg', type: string) {
  const key = objectKey('line-out', ext)
  await r2().send(new PutObjectCommand({ Bucket: r2Bucket(), Key: key, Body: body, ContentType: type }))
  return presignGet(key, LINE_URL_SECONDS)
}

export async function showWageSlip(turn: Turn, employeeId: string, rawMonth?: unknown) {
  const month = await resolveMonth(turn, rawMonth)
  const d = await rpc<WageDetail | { ok: false }>('bot_wage_detail', {
    p_line_user: turn.lineUserId,
    p_employee: employeeId,
    p_month: month,
  })
  if (!d.ok) return send(turn, [text(copy.wage.nothing, afterItems(month))])

  let urls: [string, string]
  try {
    const png = await wageSlipImage(d)
    urls = await Promise.all([upload(png, 'png', 'image/png'), upload(await preview(png), 'jpg', 'image/jpeg')])
  } catch (e) {
    console.error('[line-wage] สร้างใบสรุปไม่สำเร็จ', e instanceof Error ? e.message : '')
    return send(turn, [text(copy.wage.imageFail, afterItems(month))])
  }
  return send(turn, [
    {
      type: 'image',
      originalContentUrl: urls[0],
      previewImageUrl: urls[1],
      quickReply: text('', afterItems(month)).quickReply,
    },
  ])
}
