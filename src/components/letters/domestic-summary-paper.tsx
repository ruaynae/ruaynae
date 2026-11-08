import { DS_MIN_MATERIAL, DS_MIN_STEEL, DS_TITLE, dsPass, dsRate, dsTotal, type DomesticSummary, type DsPart } from '@/lib/domestic-summary'

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (x: number) => `${(x * 100).toFixed(2)}%`

function Block({ what, p, min }: { what: string; p: DsPart; min: number }) {
  const total = dsTotal(p)
  const rows: [string, number][] = [[`มูลค่า${what}ที่ผลิตภายในประเทศ`, p.domestic], [`มูลค่า${what}ที่ผลิตจากต่างประเทศ`, p.foreign]]
  return (
    <section className="ds-block">
      <p className="ds-b">การใช้{what}ทั้งโครงการ</p>
      <p className="ds-b">รายการใช้{what}ทั้งโครงการ {p.count.toLocaleString('en-US')} รายการ</p>
      <p className="ds-b">มูลค่า{what}ทั้งโครงการ {money(total)} บาท</p>
      <p className="ds-b ds-gap">มูลค่าการใช้{what}ที่ผลิตภายในประเทศ</p>
      <table className="ds-table">
        <colgroup><col style={{ width: '44%' }} /><col style={{ width: '22%' }} /><col style={{ width: '22%' }} /><col style={{ width: '12%' }} /></colgroup>
        <thead><tr><th>รายการ</th><th>หน่วย (บาท)</th><th>จำนวนเงิน</th><th>อัตรา (ร้อยละ)</th></tr></thead>
        <tbody>
          {rows.map(([label, v]) => (
            <tr key={label}>
              <td>{label}</td>
              <td className="ds-n">{money(v)}</td>
              <td className="ds-n">{money(v)}</td>
              <td className="ds-c">{total > 0 ? pct(v / total) : '0.00%'}</td>
            </tr>
          ))}
          <tr className="ds-sum">
            <td className="ds-c">รวม</td>
            <td className="ds-n">{money(total)}</td>
            <td className="ds-n">{money(total)}</td>
            <td className="ds-c">{total > 0 ? '100.00%' : '0.00%'}</td>
          </tr>
        </tbody>
      </table>
      <p className="ds-note">เกณฑ์ขั้นต่ำ ร้อยละ {Math.round(min * 100)} · {dsPass(p, min) ? 'ผ่านเกณฑ์' : 'ต่ำกว่าเกณฑ์'} (ผลิตในประเทศ {pct(dsRate(p))})</p>
    </section>
  )
}

/**
 * แผ่น A4 แนวตั้ง "ตารางรายงานผลการใช้พัสดุที่ผลิตภายในประเทศ" (R35) — ต่อจากหนังสือ "ขอส่งสรุปการใช้พัสดุในประเทศ"
 * 🔴 ไม่มี `'use client'` — ผังกระดาษล้วน · ตัวเลขจากภาพนิ่ง `DomesticSummary` ไม่คิดใหม่ในกระดาษ
 */
export function DomesticSummaryPaper({ ds }: { ds: DomesticSummary }) {
  return (
    <article className="paper letter-sheet ds-sheet">
      {ds.project && <p className="ds-head">{ds.project}</p>}
      <p className="ds-head ds-title">{DS_TITLE}</p>
      <Block what="พัสดุ" p={ds.material} min={DS_MIN_MATERIAL} />
      {ds.steel ? <Block what="เหล็ก" p={ds.steel} min={DS_MIN_STEEL} /> : <p className="ds-b">เหล็ก: โครงการนี้ไม่มีรายการเหล็ก</p>}
    </article>
  )
}
