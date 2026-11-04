import { MA_LIST_TITLE, maListRows, type MaterialApproval } from '@/lib/material-approval'

/**
 * แผ่น A4 แนวตั้ง "รายการขออนุมัติใช้วัสดุ" (แบบ "แนบรายการ") — ตารางสั้น 3 คอลัมน์ ต่อจากหนังสือ
 *
 * 🔴 ไม่มี `'use client'` — ผังกระดาษล้วน · กรอกแค่ชื่อรายการ + รายละเอียด (ชุดเดียวกับแบบระบุในเนื้อหา)
 * · ไหลข้ามหน้าเองตามปกติ (หัวตารางซ้ำ · ไม่ตัดแถวกลางคัน) ไม่ต้องแบ่งแผ่นเองแบบตาราง 7 คอลัมน์ (`maPages`)
 * · ไฟล์ Word มีตารางเดียวกัน (`letter-docx.ts` · `materialList`)
 */
export function MaterialListPaper({ ma }: { ma: MaterialApproval }) {
  const rows = maListRows(ma)
  return (
    <article className="paper letter-sheet ml-sheet">
      <p className="ml-title">{MA_LIST_TITLE}</p>
      <table className="ml-table">
        <colgroup>
          <col style={{ width: '11%' }} />
          <col style={{ width: '37%' }} />
          <col style={{ width: '52%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>ลำดับ</th>
            <th>รายการวัสดุ</th>
            <th>ยี่ห้อ / รุ่น / รายละเอียด</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="ml-c">{i + 1}</td>
              <td>{r.name}</td>
              <td>{r.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  )
}
