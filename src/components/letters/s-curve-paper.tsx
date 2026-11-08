import { BLANK } from '@/lib/letters'
import type { SCurveAttach } from '@/lib/s-curve-attach'

/**
 * กระดาษ A4 แนวนอน "แผนงานก่อสร้างแสดงความก้าวหน้า (S-Curve)" (R30) — แผ่นแนบท้ายหนังสือส่งมอบงาน
 *
 * 🔴 ไม่มี `'use client'` · กราฟเป็น SVG (เวกเตอร์ · สีตายตัวแบบกระดาษขาว ไม่ตามธีมมืด) — ไม่ใช้ canvas เพราะต้องคมตอนพิมพ์
 *    และไม่ต้องรอวาดก่อนพิมพ์ · ผังแผ่นเดียวกับตารางปริมาณงาน (`.ma-fit` / `.ma-sheet`) หมุนลงกระดาษแนวตั้งตอนพิมพ์
 */

const C = {
  ink: '#101b16', muted: '#56675d', plan: '#2563eb', actual: '#c2680a', grid: '#dce7e0', bar: '#c6d6fb',
  urgent: '#b42318', fast: '#7c4dbd', ops: '#0f8a87',
}
const M0 = { l: 56, r: 64, t: 30, b: 48 }
const font = '"TH Sarabun New", "Sarabun", sans-serif'

const p2 = (x: number) => `${(x * 100).toFixed(2)}%`
const thDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

function Chart({ s }: { s: SCurveAttach }) {
  const W = 1000
  const H = 430
  const fz = 1
  const n = s.planCum.length
  const M = M0
  const pw = W - M.l - M.r
  const ph = H - M.t - M.b
  const bw = pw / n
  const top = Math.max(0.02, Math.ceil((Math.max(...s.planWeekly) * 100) / 2) / 50)
  const X = (i: number) => M.l + (i + 1) * bw
  const Y = (v: number) => M.t + ph - ph * v
  const path = (vals: (number | null)[]) => {
    let d = `M${M.l},${M.t + ph}`
    for (let i = 0; i < vals.length; i += 1) if (vals[i] != null) d += ` L${X(i).toFixed(1)},${Y(vals[i] as number).toFixed(1)}`
    return d
  }
  const lastActual = s.actualCum.reduce<number>((a, v, i) => (v != null ? i : a), -1)
  const every = Math.max(1, Math.ceil(n / 24))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="sc-svg" role="img" aria-label="S-Curve แผนงานเทียบผลงานจริง" fontFamily={font}>
      <rect width={W} height={H} fill="#fff" />
      {[0, 1, 2, 3, 4].map((i) => {
        const y = M.t + ph - (ph * i) / 4
        return (
          <g key={i}>
            <line x1={M.l} x2={M.l + pw} y1={y} y2={y} stroke={C.grid} />
            <text x={M.l - 6} y={y} textAnchor="end" dominantBaseline="middle" fontSize={15 * fz} fill={C.muted}>{i * 25}%</text>
            <text x={M.l + pw + 6} y={y} dominantBaseline="middle" fontSize={15 * fz} fill={C.muted}>{((top * 100 * i) / 4).toFixed(1)}%</text>
          </g>
        )
      })}
      {s.planWeekly.map((v, i) => {
        const h = (ph * v) / top
        return <rect key={i} x={M.l + i * bw + bw * 0.18} y={M.t + ph - h} width={bw * 0.64} height={h} fill={C.bar} />
      })}
      {s.labels.map((l, i) => i % every === 0 && (
        <g key={i}>
          <text x={M.l + i * bw + bw / 2} y={M.t + ph + 17} textAnchor="middle" fontSize={14 * fz} fill={C.muted}>{l}</text>
          {s.sublabels[i] && <text x={M.l + i * bw + bw / 2} y={M.t + ph + 33} textAnchor="middle" fontSize={12 * fz} fill={C.muted}>{s.sublabels[i]}</text>}
        </g>
      ))}
      {s.w124Cum && <path d={path(s.w124Cum)} fill="none" stroke={C.muted} strokeWidth="2" />}
      {s.checks.map((k, ci) => {
        const x = M.l + Math.min(n, k.x) * bw
        return (
          <g key={ci}>
            <line x1={x} x2={x} y1={M.t} y2={M.t + ph} stroke={C.urgent} strokeWidth="1.5" strokeDasharray="6 4" />
            {k.marks.map((m, mi) => {
              const y = Y(m.y)
              const left = x - 280 >= M.l
              return (
                <g key={mi}>
                  <path d={`M${x},${y - 5} L${x + 5},${y} L${x},${y + 5} L${x - 5},${y} Z`} fill={C.urgent} />
                  <text x={left ? x - 10 : x + 10} y={y} textAnchor={left ? 'end' : 'start'} dominantBaseline="middle" fontSize={13 * fz} fill={C.urgent} stroke="#fff" strokeWidth="3" paintOrder="stroke">{m.text}</text>
                </g>
              )
            })}
          </g>
        )
      })}
      {s.fastCum && <path d={path(s.fastCum)} fill="none" stroke={C.fast} strokeWidth="2" />}
      {s.opsCum && <path d={path(s.opsCum)} fill="none" stroke={C.ops} strokeWidth="2" />}
      <path d={path(s.planCum)} fill="none" stroke={C.plan} strokeWidth="2.5" strokeLinejoin="round" />
      {s.planCum.map((v, i) => <circle key={i} cx={X(i)} cy={Y(v)} r="2.6" fill={C.plan} />)}
      <path d={path(s.actualCum)} fill="none" stroke={C.actual} strokeWidth="3" strokeLinejoin="round" />
      {s.actualCum.map((v, i) => v != null && <circle key={i} cx={X(i)} cy={Y(v)} r="2.8" fill={C.actual} />)}
      {lastActual >= 0 && (
        <text x={X(lastActual) + 8} y={Y(s.actualCum[lastActual] as number) + 16} fontSize={15 * fz} fontWeight="700" fill={C.actual}>{p2(s.actualCum[lastActual] as number)}</text>
      )}
    </svg>
  )
}

export function SCurvePaper({ s, company }: { s: SCurveAttach; company: string }) {
  return (
    <div className="ma-fit">
      <article className="paper letter-sheet sc-sheet ma-sheet">
        <p className="ma-title">แผนงานก่อสร้างแสดงความก้าวหน้า (S-Curve)</p>
        <table className="ma-head">
          <tbody>
            <tr>
              <td className="ma-b ma-k">โครงการ:</td>
              <td>{s.project || BLANK}</td>
              <td className="ma-b ma-k2">ผู้รับจ้าง:</td>
              <td>{company || BLANK}</td>
            </tr>
            <tr>
              <td className="ma-b ma-k">ผลงานสะสม:</td>
              <td>สัปดาห์ที่ {s.week} (W{s.week})</td>
              <td className="ma-b ma-k2">ผลงาน ณ วันที่:</td>
              <td>{thDate(s.asOf)}</td>
            </tr>
          </tbody>
        </table>
        <Chart s={s} />
        <p className="sc-legend">
          <i style={{ background: C.plan }} /> แผนงานตามสัญญา
          <i style={{ background: C.actual }} /> ผลงานจริงสะสม
          <i style={{ background: C.bar }} /> แผนรายสัปดาห์
          {s.w124Cum && <><i style={{ background: C.muted }} /> แผนงานตาม ว.124</>}
          {s.fastCum && <><i style={{ background: C.fast }} /> แผนงานเร่งรัด</>}
          {s.opsCum && <><i style={{ background: C.ops }} /> แผนการทำงานดำเนินการ</>}
        </p>
      </article>
    </div>
  )
}
