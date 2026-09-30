import type { LineMessage } from '@/lib/line/client'
import { MENU_LABEL } from './copy'

// ตัวสร้างข้อความ (รูปแบบของ Messaging API) · postback data สั้นเสมอ (≤ 300 ตัวอักษร)

export type QuickItem =
  | { label: string; data: string; keyboard?: boolean }
  | { label: string; text: string }
  | { label: string; datePicker: string; initial?: string; max?: string }

export function quick(items: QuickItem[]) {
  return {
    items: items.slice(0, 13).map((i) => {
      const label = i.label.slice(0, 20)
      if ('data' in i) {
        return {
          type: 'action',
          action: {
            type: 'postback',
            label,
            data: i.data,
            displayText: i.label,
            ...(i.keyboard ? { inputOption: 'openKeyboard' } : {}),
          },
        }
      }
      if ('datePicker' in i) {
        return {
          type: 'action',
          action: {
            type: 'datetimepicker',
            label,
            data: i.datePicker,
            mode: 'date',
            ...(i.initial ? { initial: i.initial } : {}),
            ...(i.max ? { max: i.max } : {}),
          },
        }
      }
      return { type: 'action', action: { type: 'message', label, text: i.text } }
    }),
  }
}

export const text = (body: string, items?: QuickItem[]): LineMessage => ({
  type: 'text',
  text: body.slice(0, 5000),
  ...(items?.length ? { quickReply: quick(items) } : {}),
})

/** ทางลัดเมนูทั้งสี่ ไว้ท้ายข้อความ */
export const menuItems = (): QuickItem[] => [
  { label: MENU_LABEL.exp, data: 'm=exp' },
  { label: MENU_LABEL.att, data: 'm=att' },
  { label: MENU_LABEL.apr, data: 'm=apr' },
  { label: MENU_LABEL.allow, data: 'm=allow' },
  { label: MENU_LABEL.wage, data: 'm=wage' },
]

export type BubbleButton = {
  label: string
  data: string
  style?: 'primary' | 'secondary'
}
export type Bubble = { title: string; lines: string[]; buttons: BubbleButton[] }

export function bubble(b: Bubble) {
  return {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        { type: 'text', text: b.title.slice(0, 60), weight: 'bold', size: 'md', wrap: true },
        ...b.lines.map((l) => ({ type: 'text', text: l.slice(0, 160), size: 'sm', wrap: true })),
      ],
    },
    ...(b.buttons.length
      ? {
          footer: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents: b.buttons.map((x) => ({
              type: 'button',
              style: x.style ?? 'secondary',
              height: 'sm',
              action: {
                type: 'postback',
                label: x.label.slice(0, 20),
                data: x.data,
                displayText: x.label,
              },
            })),
          },
        }
      : {}),
  }
}

export const flex = (altText: string, contents: unknown): LineMessage => ({
  type: 'flex',
  altText: altText.slice(0, 400),
  contents,
})

/** ตัวเลื่อนไม่เกิน 12 ใบ */
export const carousel = (altText: string, bubbles: ReturnType<typeof bubble>[]): LineMessage =>
  flex(altText, { type: 'carousel', contents: bubbles.slice(0, 12) })

/** ตัวเลือกยาว ๆ: ใบละ 4 ปุ่ม เลื่อนซ้าย-ขวา (LINE จำกัด 12 ใบ = 48 ตัวเลือก) */
export function choices(alt: string, title: string, items: { label: string; data: string }[]) {
  const groups: (typeof items)[] = []
  for (let i = 0; i < items.length; i += 4) groups.push(items.slice(i, i + 4))
  return carousel(
    alt,
    groups.slice(0, 12).map((g, i) =>
      bubble({ title: groups.length > 1 ? `${title} (${i + 1}/${groups.length})` : title, lines: [], buttons: g }),
    ),
  )
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '')

/** พิมพ์ชื่อมา: ตรงเป๊ะก่อน · ไม่งั้นต้องมีตัวเดียวที่มีคำนั้น */
export function matchByName<T extends { name: string }>(list: T[], typed: string): T | null {
  const t = norm(typed)
  if (!t) return null
  const exact = list.filter((x) => norm(x.name) === t)
  if (exact.length === 1) return exact[0]
  const part = list.filter((x) => norm(x.name).includes(t))
  return part.length === 1 ? part[0] : null
}

/** key=value&key=value → object (postback data) */
export function readData(data: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(data))
}

/** ประกอบ postback data */
export function data(fields: Record<string, string | number>): string {
  return new URLSearchParams(
    Object.entries(fields).map(([k, v]) => [k, String(v)] as [string, string]),
  ).toString()
}
