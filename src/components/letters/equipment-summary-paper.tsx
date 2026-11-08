import { EQ_TITLE, eqCell, eqItems, type EquipSummary } from '@/lib/equipment-summary'

/**
 * แผ่น A4 แนวตั้ง "แบบฟอร์มบันทึกข้อมูลครุภัณฑ์" (R34) — ต่อจากหนังสือ "ขอส่งสรุปรายการครุภัณฑ์"
 * 🔴 ไม่มี `'use client'` — ผังกระดาษล้วน · ครุภัณฑ์หนึ่งรายการ = ตารางย่อย 4 บรรทัด + รูปทางขวา · ไหลข้ามหน้าเอง ไม่ตัดรายการกลางคัน
 */
export function EquipmentSummaryPaper({ eq }: { eq: EquipSummary }) {
  const items = eqItems(eq)
  return (
    <article className="paper letter-sheet eq-sheet">
      <p className="eq-title">{EQ_TITLE}</p>
      <table className="eq-table">
        <colgroup>
          <col style={{ width: '7%' }} />
          <col style={{ width: '20%' }} />
          <col style={{ width: '45%' }} />
          <col style={{ width: '28%' }} />
        </colgroup>
        <thead>
          <tr><th>ที่</th><th>รายการ</th><th>รายละเอียด</th><th>หมายเหตุ</th></tr>
        </thead>
        {items.map((it, i) => (
          <tbody key={i}>
            <tr>
              <td rowSpan={4} className="eq-c">{i + 1}</td>
              <td className="eq-b">ชื่อครุภัณฑ์</td>
              <td>{it.name.trim()}</td>
              <td rowSpan={4} className="eq-photo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {it.photo ? <img src={it.photo} alt={it.name} /> : null}
              </td>
            </tr>
            <tr><td className="eq-b">ยี่ห้อ</td><td>{eqCell(it.brand)}</td></tr>
            <tr><td className="eq-b">ผู้ขาย</td><td>{eqCell(it.seller)}</td></tr>
            <tr><td className="eq-b">ระยะเวลารับประกัน</td><td>{eqCell(it.warranty)}</td></tr>
          </tbody>
        ))}
      </table>
    </article>
  )
}
