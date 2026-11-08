import { BLANK } from '@/lib/letters'
import {
  PW_COLS, PW_TITLE, itemSum, pwPages, pwRows, pwTotal, ratio, type ProgressWork, type PwRow, type PwSum,
} from '@/lib/progress-work'

/**
 * กระดาษ A4 แนวนอน "แบบแสดงรายการ ปริมาณงาน และราคา ที่แล้วเสร็จ" (R28) — แผ่นแนบท้ายหนังสือส่งมอบงาน
 *
 * 🔴 ไม่มี `'use client'` — ผังกระดาษล้วน · ใช้ผังแผ่นแนวนอนเดียวกับ R26 (`.ma-fit` / `.ma-sheet`)
 *   บนจอย่อเท่าหนังสือ · ตอนพิมพ์หมุนลงกระดาษแนวตั้ง → แบ่งแผ่นเองด้วย `pwPages()` (หัวตารางซ้ำทุกแผ่น)
 */

const n2 = (x: number) => (Math.abs(x) < 0.005 ? '-' : x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
/** % — เต็มจำนวนไม่มีทศนิยม (95%) · มีเศษ 2 ตำแหน่ง (72.08%) */
const p2 = (x: number) => {
  const v = Math.round(x * 10000) / 100
  return `${Number.isInteger(v) ? v : v.toFixed(2)}%`
}
const thDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

function SumCells({ s, mult, contract }: { s: PwSum; mult: number | null; contract: number }) {
  return (
    <>
      <td className="pw-n">{n2(s.mat)}</td>
      <td className="pw-c">{s.mat > 0 ? p2(ratio(s.matDone, s.mat)) : '-'}</td>
      <td className="pw-n">{n2(s.matDone)}</td>
      <td className="pw-n">{n2(s.lab)}</td>
      <td className="pw-c">{s.lab > 0 ? p2(ratio(s.labDone, s.lab)) : '-'}</td>
      <td className="pw-n">{n2(s.labDone)}</td>
      <td className="pw-n">{n2(s.done)}</td>
      <td className="pw-c">{mult == null ? '' : mult.toFixed(4)}</td>
      <td className="pw-n">{n2(s.value)}</td>
      <td className="pw-c">{p2(ratio(s.value, contract))}</td>
    </>
  )
}

function Row({ r, contract }: { r: PwRow; contract: number }) {
  if (r.k === 'cat' || r.k === 'task') {
    return (
      <tr className={r.k === 'cat' ? 'pw-cat' : 'pw-task'}>
        <td className="pw-c">{r.no}</td>
        <td colSpan={13}>{r.name}</td>
      </tr>
    )
  }
  if (r.k === 'item') {
    const it = r.item
    const s = itemSum(it, r.mult)
    return (
      <tr>
        <td />
        <td>{` - ${it.name}`}</td>
        <td className="pw-n">{it.qty == null ? '' : it.qty.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
        <td className="pw-c">{it.unit}</td>
        <td className="pw-n">{n2(it.mat)}</td>
        <td className="pw-c">{it.mat > 0 ? p2(it.pm) : '-'}</td>
        <td className="pw-n">{n2(s.matDone)}</td>
        <td className="pw-n">{n2(it.lab)}</td>
        <td className="pw-c">{it.lab > 0 ? p2(it.pl) : '-'}</td>
        <td className="pw-n">{n2(s.labDone)}</td>
        <td className="pw-n">{n2(s.done)}</td>
        <td className="pw-c">{r.mult.toFixed(4)}</td>
        <td className="pw-n">{n2(s.value)}</td>
        <td className="pw-c">{p2(ratio(s.value, contract))}</td>
      </tr>
    )
  }
  return (
    <tr className={`pw-${r.k}`}>
      <td />
      <td colSpan={3} className={r.k === 'sub' ? '' : 'pw-c'}>{r.name}</td>
      <SumCells s={r.sum} mult={r.k === 'grand' ? null : r.mult} contract={contract} />
    </tr>
  )
}

export function ProgressWorkPaper({ pw, company }: { pw: ProgressWork; company: string }) {
  const rows = pwRows(pw)
  const pages = pwPages(rows)
  const total = pwTotal(pw)
  const mult = Array.from(new Set(pw.cats.map((c) => c.mult)))
  const multLabel = mult.every((m) => m < 1.2) ? 'VAT' : mult.some((m) => m < 1.2) ? 'Factor F / VAT' : 'Factor F'
  return (
    <>
      {pages.map(([from, to], pi) => (
        <div key={from} className="ma-fit">
          <article className="paper letter-sheet ma-sheet pw-sheet">
            <p className="ma-title">{PW_TITLE}</p>
            <table className="ma-head">
              <tbody>
                <tr>
                  <td className="ma-b ma-k">โครงการ:</td>
                  <td>{pw.project || BLANK}</td>
                  <td className="ma-b ma-k2">ผู้รับจ้าง:</td>
                  <td>{company || BLANK}</td>
                </tr>
                <tr>
                  <td className="ma-b ma-k">สถานที่:</td>
                  <td>{pw.location || BLANK}</td>
                  <td className="ma-b ma-k2">ผลงาน ณ วันที่:</td>
                  <td>{thDate(pw.asOf)}</td>
                </tr>
              </tbody>
            </table>
            <p className="pw-unit">หน่วย : บาท{pages.length > 1 ? ` · แผ่นที่ ${pi + 1}/${pages.length}` : ''}</p>
            <table className="pw-table">
              <colgroup>
                {PW_COLS.map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}
              </colgroup>
              <thead>
                <tr>
                  <th rowSpan={2}>ลำดับที่</th>
                  <th rowSpan={2}>รายการ</th>
                  <th rowSpan={2}>จำนวน</th>
                  <th rowSpan={2}>หน่วย</th>
                  <th colSpan={3}>ค่าวัสดุ</th>
                  <th colSpan={3}>ค่าแรงงาน</th>
                  <th rowSpan={2}>รวมมูลค่า<br />ที่แล้วเสร็จ</th>
                  <th rowSpan={2}>{multLabel}</th>
                  <th rowSpan={2}>รวมเป็น<br />มูลค่า</th>
                  <th rowSpan={2}>คิดเป็น<br />%</th>
                </tr>
                <tr>
                  <th>มูลค่างาน</th>
                  <th>% แล้วเสร็จ</th>
                  <th>ที่แล้วเสร็จ</th>
                  <th>มูลค่างาน</th>
                  <th>% แล้วเสร็จ</th>
                  <th>ที่แล้วเสร็จ</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(from, to).map((r, i) => <Row key={from + i} r={r} contract={pw.contract} />)}
              </tbody>
            </table>
            {pi === pages.length - 1 && (
              <p className="pw-foot">
                ผลงานที่แล้วเสร็จสะสม {n2(total.value)} บาท คิดเป็น <b>{p2(ratio(total.value, pw.contract))}</b> ของราคาค่าก่อสร้าง {n2(pw.contract)} บาท
              </p>
            )}
          </article>
        </div>
      ))}
    </>
  )
}
