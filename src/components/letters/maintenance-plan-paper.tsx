import { BLANK } from '@/lib/letters'
import { MP_SUBTITLE, MP_TITLE, mpItems, mpLabel, mpMonths, mpOn, mpPages, mpSpanText, type MaintPlan } from '@/lib/maintenance-plan'

/**
 * กระดาษ A4 แนวนอน "ตารางตรวจสอบและบำรุงรักษาครุภัณฑ์" (R33) — แผ่นแนบท้ายหนังสือแผนบำรุงรักษา
 * 🔴 ไม่มี `'use client'` — ผังกระดาษล้วน · ใช้ผังหมุนลงกระดาษแนวตั้งเดียวกับ R26 (`.ma-fit`/`.ma-sheet`) · แบ่งแผ่นด้วย `mpPages()`
 */
export function MaintenancePlanPaper({ plan }: { plan: MaintPlan }) {
  const items = mpItems(plan)
  // ช่องปิดผูกกับลำดับแถวดิบ — แถวว่างที่ถูกกรองออกต้องไม่ทำให้เลขเลื่อน
  const raw = plan.items.map((s, i) => ({ s: s.trim(), i })).filter((x) => x.s)
  const cols = mpMonths(plan)
  const pages = mpPages(items.length)
  return (
    <>
      {pages.map(([from, to]) => (
        <div key={from} className="ma-fit">
          <article className="paper letter-sheet ma-sheet mp-sheet">
            <p className="ma-title">{MP_TITLE}</p>
            <table className="ma-head">
              <tbody>
                <tr><td className="ma-b ma-k">โครงการ</td><td>{plan.project.trim() || BLANK}</td></tr>
                <tr><td className="ma-b ma-k">สถานที่</td><td>{plan.location.trim() || BLANK}</td></tr>
              </tbody>
            </table>
            <p className="mp-sub">{MP_SUBTITLE}</p>
            <table className="mp-table">
              <colgroup>
                <col style={{ width: '6%' }} />
                <col style={{ width: '40%' }} />
                {cols.map((_, i) => <col key={i} style={{ width: `${54 / cols.length}%` }} />)}
              </colgroup>
              <thead>
                <tr>
                  <th rowSpan={2}>ลำดับ</th>
                  <th rowSpan={2}>รายการซ่อมบำรุง</th>
                  <th colSpan={cols.length}>{mpSpanText(cols)}</th>
                </tr>
                <tr>{cols.map((c, i) => <th key={i}>{mpLabel(c)}</th>)}</tr>
              </thead>
              <tbody>
                {raw.slice(from, to).map((r, k) => (
                  <tr key={r.i}>
                    <td className="ma-c">{from + k + 1}</td>
                    <td>{r.s}</td>
                    {cols.map((_, c) => <td key={c} className="ma-c">{mpOn(plan, r.i, c) ? '✓' : ''}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        </div>
      ))}
    </>
  )
}
