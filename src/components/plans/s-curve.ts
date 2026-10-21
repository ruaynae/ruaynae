import { useEffect, type RefObject } from 'react'

/**
 * S-Curve บน canvas — สีจากโทเคนของธีม
 * · เส้นทึบ = แผนสะสม (แกนซ้าย 0–100%) · เส้นส้ม = ผลงานจริงสะสม (ถ้ามี) · แท่ง = แผนรายสัปดาห์ (แกนขวา)
 */

export type CurveData = {
  weekly: number[]
  plan: number[]
  /** null = ยังไม่มีข้อมูลสัปดาห์นั้น — เส้นหยุดตรงนั้น */
  actual?: (number | null)[]
  labels: string[]
  sublabels?: string[]
}

function palette() {
  const css = getComputedStyle(document.documentElement)
  const v = (k: string, fb: string) => css.getPropertyValue(k).trim() || fb
  return {
    ink: v('--ink', '#101b16'),
    muted: v('--muted', '#56675d'),
    plan: v('--bar-time', '#2563eb'),
    actual: v('--bar-cost-material', '#c2680a'),
    grid: v('--line', '#dce7e0'),
    bar: v('--status-info-ring', '#c6d6fb'),
    bg: v('--surface', '#ffffff'),
  }
}

export function drawSCurve(cv: HTMLCanvasElement, d: CurveData) {
  const W = cv.clientWidth
  const H = cv.clientHeight
  if (!W || !H) return
  const dpr = window.devicePixelRatio || 1
  cv.width = W * dpr
  cv.height = H * dpr
  const g = cv.getContext('2d')
  if (!g) return
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  const c = palette()
  const fs = 12
  g.fillStyle = c.bg
  g.fillRect(0, 0, W, H)

  const m = { l: fs * 3.6, r: fs * 4, t: fs * 1.6, b: fs * (d.sublabels ? 3 : 2) }
  const pw = W - m.l - m.r
  const ph = H - m.t - m.b
  const n = d.plan.length
  if (!n) return
  const top = Math.max(0.02, Math.ceil((Math.max(...d.weekly) * 100) / 2) / 50)
  g.textBaseline = 'middle'
  g.font = `${fs}px "IBM Plex Sans Thai", Tahoma, sans-serif`
  for (let i = 0; i <= 4; i += 1) {
    const y = m.t + ph - (ph * i) / 4
    g.strokeStyle = c.grid
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
  d.weekly.forEach((v, i) => {
    const h = (ph * v) / top
    g.fillRect(m.l + i * bw + bw * 0.18, m.t + ph - h, bw * 0.64, h)
  })
  g.fillStyle = c.muted
  g.textAlign = 'center'
  const every = Math.max(1, Math.ceil(n / (W / (fs * 4.5))))
  for (let i = 0; i < n; i += every) {
    const x = m.l + i * bw + bw / 2
    g.fillText(d.labels[i] ?? '', x, m.t + ph + fs * 1.1)
    if (d.sublabels) g.fillText(d.sublabels[i] ?? '', x, m.t + ph + fs * 2.3)
  }

  const line = (vals: (number | null)[], color: string, width: number) => {
    g.strokeStyle = color
    g.lineWidth = width
    g.lineJoin = 'round'
    g.beginPath()
    g.moveTo(m.l, m.t + ph)
    let last = -1
    vals.forEach((v, i) => {
      if (v == null) return
      g.lineTo(m.l + (i + 1) * bw, m.t + ph - ph * v)
      last = i
    })
    if (last < 0) return
    g.stroke()
    g.fillStyle = color
    vals.forEach((v, i) => {
      if (v == null) return
      g.beginPath()
      g.arc(m.l + (i + 1) * bw, m.t + ph - ph * v, 2.6, 0, Math.PI * 2)
      g.fill()
    })
  }
  line(d.plan, c.plan, 2.5)
  if (d.actual) line(d.actual, c.actual, 3)

  const mid = d.plan.findIndex((v) => v >= 0.5)
  if (mid >= 0 && !d.actual) {
    g.fillStyle = c.ink
    g.textAlign = 'left'
    g.fillText(`50% ที่ W${mid + 1}`, m.l + (mid + 1) * bw + fs * 0.6, m.t + ph * 0.5)
  }
}

/** วาดใหม่เมื่อข้อมูลเปลี่ยน · ขนาดกราฟเปลี่ยน · ธีมเปลี่ยน (next-themes สลับคลาสบน <html>) */
export function useSCurve(ref: RefObject<HTMLCanvasElement | null>, data: CurveData | null) {
  useEffect(() => {
    const cv = ref.current
    if (!cv || !data) return
    const draw = () => drawSCurve(cv, data)
    draw()
    // ResizeObserver ไม่ใช่ window resize — แท็บที่ถูกซ่อนแล้วกลับมาแสดงก็นับเป็นการเปลี่ยนขนาด
    const ro = new ResizeObserver(draw)
    ro.observe(cv)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', draw)
    const mo = new MutationObserver(draw)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => {
      ro.disconnect()
      mq.removeEventListener('change', draw)
      mo.disconnect()
    }
  }, [ref, data])
}
