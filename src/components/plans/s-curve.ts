import type { Distribution } from '@/lib/boq/core'

/**
 * S-Curve บน canvas — ใช้ทั้งบนจอ (สีจากโทเคนของธีม) และรูปที่แนบในไฟล์ Excel
 * (สีพื้นขาวคงที่ เพราะไฟล์ถูกเปิดนอกแอปเสมอ)
 * · เส้น = ความคืบหน้าสะสม (แกนซ้าย 0–100%) · แท่ง = ความคืบหน้ารายสัปดาห์ (แกนขวา)
 */

type Palette = { ink: string; muted: string; line: string; line2: string; bar: string; bg: string }

const EXPORT: Palette = { ink: '#1f2a37', muted: '#52606d', line: '#2f5f94', line2: '#dce4ec', bar: '#c9daec', bg: '#ffffff' }

function themePalette(): Palette {
  const css = getComputedStyle(document.documentElement)
  const v = (n: string, fb: string) => css.getPropertyValue(n).trim() || fb
  return {
    ink: v('--ink', '#101b16'),
    muted: v('--muted', '#56675d'),
    line: v('--chart-info', '#2563eb'),
    line2: v('--line', '#dce7e0'),
    bar: v('--status-info-ring', '#c6d6fb'),
    bg: v('--surface', '#ffffff'),
  }
}

const shortDate = (d: Date) => d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'UTC' })

export function drawSCurve(cv: HTMLCanvasElement, dist: Distribution, start: Date, forExport = false) {
  const W = forExport ? 1800 : cv.clientWidth
  const H = forExport ? 680 : cv.clientHeight
  if (!W || !H) return
  const dpr = forExport ? 1 : window.devicePixelRatio || 1
  cv.width = W * dpr
  cv.height = H * dpr
  const g = cv.getContext('2d')
  if (!g) return
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  const c = forExport ? EXPORT : themePalette()
  const fs = forExport ? 22 : 12
  const face = '"IBM Plex Sans Thai", Tahoma, sans-serif'
  g.fillStyle = c.bg
  g.fillRect(0, 0, W, H)

  const m = { l: fs * 3.6, r: fs * 4, t: fs * (forExport ? 3.4 : 1.6), b: fs * 3 }
  const pw = W - m.l - m.r
  const ph = H - m.t - m.b
  const n = dist.weeks
  const top = Math.max(0.02, Math.ceil((Math.max(...dist.perWeek) * 100) / 2) / 50)
  g.textBaseline = 'middle'
  if (forExport) {
    g.fillStyle = c.ink
    g.font = `600 ${fs * 1.2}px ${face}`
    g.fillText('S-Curve แผนงานก่อสร้าง (ความคืบหน้าสะสมตามแผน)', m.l, fs * 1.4)
  }
  g.font = `${fs}px ${face}`
  for (let i = 0; i <= 4; i += 1) {
    const y = m.t + ph - (ph * i) / 4
    g.strokeStyle = c.line2
    g.lineWidth = 1
    g.beginPath()
    g.moveTo(m.l, y)
    g.lineTo(m.l + pw, y)
    g.stroke()
    g.fillStyle = c.muted
    g.textAlign = 'right'
    g.fillText(`${i * 25}%`, m.l - fs * 0.5, y)
    g.textAlign = 'left'
    g.fillText(`${((top * 100 * i) / 4).toFixed(1)}%`, m.l + pw + fs * 0.5, y)
  }
  const bw = pw / n
  g.fillStyle = c.bar
  dist.perWeek.forEach((v, i) => {
    const h = (ph * v) / top
    g.fillRect(m.l + i * bw + bw * 0.18, m.t + ph - h, bw * 0.64, h)
  })
  g.fillStyle = c.muted
  g.textAlign = 'center'
  const every = Math.max(1, Math.ceil(n / (W / (fs * 4.5))))
  for (let i = 0; i < n; i += every) {
    const x = m.l + i * bw + bw / 2
    g.fillText(`W${i + 1}`, x, m.t + ph + fs * 1.1)
    g.fillText(shortDate(new Date(start.getTime() + i * 7 * 864e5)), x, m.t + ph + fs * 2.3)
  }
  g.strokeStyle = c.line
  g.lineWidth = forExport ? 4 : 2.5
  g.lineJoin = 'round'
  g.beginPath()
  g.moveTo(m.l, m.t + ph)
  dist.cum.forEach((v, i) => g.lineTo(m.l + (i + 1) * bw, m.t + ph - ph * v))
  g.stroke()
  g.fillStyle = c.line
  dist.cum.forEach((v, i) => {
    g.beginPath()
    g.arc(m.l + (i + 1) * bw, m.t + ph - ph * v, forExport ? 4.5 : 2.6, 0, Math.PI * 2)
    g.fill()
  })
  const mid = dist.cum.findIndex((v) => v >= 0.5)
  if (mid >= 0) {
    g.fillStyle = c.ink
    g.textAlign = 'left'
    g.fillText(`50% ที่ W${mid + 1}`, m.l + (mid + 1) * bw + fs * 0.6, m.t + ph * 0.5)
  }
}
