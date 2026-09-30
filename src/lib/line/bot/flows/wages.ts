import { PutObjectCommand } from '@aws-sdk/client-s3'
import { preview } from '@/lib/line/render'
import { objectKey, presignGet, r2, r2Bucket } from '@/lib/r2'
import { rpc, send, setState } from '../api'
import { copy } from '../copy'
import { choices, data, matchByName, menuItems, text, type QuickItem } from '../messages'
import type { Turn } from '../types'
import { baht } from '../util'
import { wageSlipImage, type WageDetail } from '../wage-slip'

// เมนู 5 · ค่าแรงคงค้าง: รายชื่อคนที่มียอดค้าง → เลือกคน → ใบสรุปเป็นรูป (ส่งต่อให้คนงานได้)

type Person = { id: string; name: string; days: number; balance: number }

// ลิงก์รูปที่ LINE ใช้ต้องอยู่ได้นานพอให้คนเปิดดูทีหลัง · presigned ของ R2 ได้สูงสุด 7 วัน
const LINE_URL_SECONDS = 7 * 24 * 60 * 60

const list = (turn: Turn) => rpc<Person[]>('bot_wage_list', { p_line_user: turn.lineUserId })

const afterItems = (): QuickItem[] => [
  { label: copy.wage.other, data: 'm=wage' },
  ...menuItems().filter((m) => !('data' in m && m.data === 'm=wage')),
]

export async function showWageList(turn: Turn) {
  const people = await list(turn)
  if (people.length === 0) {
    await setState(turn, 'idle')
    return send(turn, [text(copy.wage.none, menuItems())])
  }
  await setState(turn, 'wage_pick')
  const total = people.reduce((s, p) => s + Math.max(0, Number(p.balance)), 0)
  const over = people.filter((p) => Number(p.balance) < 0).length
  const label = (p: Person) => `${p.name} ${Number(p.balance) < 0 ? '−' : ''}${baht(Math.abs(Number(p.balance)))}`
  return send(turn, [
    text(
      copy.wage.head(people.length, baht(total), over) +
        (people.length > 48 ? `\n${copy.wage.tooMany(people.length - 48)}` : ''),
      menuItems(),
    ),
    choices(copy.wage.pick, copy.wage.pick, people.map((p) => ({ label: label(p), data: data({ a: 'wg', e: p.id }) }))),
  ])
}

/** พิมพ์ชื่อคนระหว่างเลือก */
export async function onText(turn: Turn, raw: string) {
  const hit = matchByName(await list(turn), raw)
  if (!hit) return send(turn, [text(copy.wage.notFound, afterItems())])
  return showWageSlip(turn, hit.id)
}

async function upload(body: Buffer, ext: 'png' | 'jpg', type: string) {
  const key = objectKey('line-out', ext)
  await r2().send(new PutObjectCommand({ Bucket: r2Bucket(), Key: key, Body: body, ContentType: type }))
  return presignGet(key, LINE_URL_SECONDS)
}

export async function showWageSlip(turn: Turn, employeeId: string) {
  const d = await rpc<WageDetail | { ok: false }>('bot_wage_detail', {
    p_line_user: turn.lineUserId,
    p_employee: employeeId,
  })
  if (!d.ok) return send(turn, [text(copy.wage.nothing, afterItems())])

  let urls: [string, string]
  try {
    const png = await wageSlipImage(d)
    urls = await Promise.all([upload(png, 'png', 'image/png'), upload(await preview(png), 'jpg', 'image/jpeg')])
  } catch (e) {
    console.error('[line-wage] สร้างใบสรุปไม่สำเร็จ', e instanceof Error ? e.message : '')
    return send(turn, [text(copy.wage.imageFail, afterItems())])
  }
  return send(turn, [
    {
      type: 'image',
      originalContentUrl: urls[0],
      previewImageUrl: urls[1],
      quickReply: text('', afterItems()).quickReply,
    },
  ])
}
