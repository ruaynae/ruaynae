import { BLANK, type LetterPaperData } from '@/lib/letters'
import { MA_COLS, MA_TITLE, contractFromRefs, maCell, maItems, maPages, type MaterialApproval } from '@/lib/material-approval'

/**
 * กระดาษ A4 แนวนอน "ตารางรายการขออนุมัติใช้วัสดุ" (R26) — แผ่นแนบท้ายหนังสือแบบที่ 2 (`reg033/2569`)
 *
 * 🔴 ไม่มี `'use client'` — ผังกระดาษล้วน (เหมือน `change-order-paper.tsx`)
 * · หัวตาราง: โครงการ / ผู้รับจ้าง (หัวกระดาษ) · สัญญาจ้าง (ช่องของตาราง หรือบรรทัด "อ้างถึง") / เรื่อง (ของหนังสือ)
 * · บนจอกว้าง 1123px แล้วย่อให้เท่าหนังสือแนวตั้ง (`.ma-fit`)
 * · ตอนพิมพ์ **หมุนลงกระดาษ A4 แนวตั้ง** แบบต้นฉบับ — แผ่นที่หมุนไหลข้ามหน้าไม่ได้ จึงแบ่งแผ่นเองด้วย `maPages()`
 *   (หัวเรื่อง + หัวตารางซ้ำทุกแผ่น · เลขที่นับต่อกัน)
 */
export function MaterialApprovalPaper({ ma, letter }: { ma: MaterialApproval; letter: LetterPaperData }) {
  const items = maItems(ma)
  const contract = ma.contract.trim() || contractFromRefs(letter.refs) || BLANK
  const pages = maPages(items)
  return (
    <>
      {pages.map(([from, to]) => (
        <div key={from} className="ma-fit">
          <article className="paper letter-sheet ma-sheet">
            <p className="ma-title">{MA_TITLE}</p>
            <table className="ma-head">
              <tbody>
                <tr>
                  <td className="ma-b ma-k">โครงการ:</td>
                  <td>{ma.project.trim() || BLANK}</td>
                  <td className="ma-b ma-k2">สัญญาจ้าง:</td>
                  <td>{contract}</td>
                </tr>
                <tr>
                  <td className="ma-b ma-k">ผู้รับจ้าง:</td>
                  <td>{letter.letterhead.companyName || BLANK}</td>
                  <td className="ma-b ma-k2">เรื่อง:</td>
                  <td>{letter.subject || BLANK}</td>
                </tr>
              </tbody>
            </table>
            <table className="ma-table">
              <colgroup>
                {MA_COLS.map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}
              </colgroup>
              <thead>
                <tr>
                  <th>เลขที่</th>
                  <th>รายการวัสดุ</th>
                  <th>รูปแบบรายการ</th>
                  <th>แบบแสดงปริมาณราคา</th>
                  <th>รายการประกอบแบบ</th>
                  <th>รายละเอียดขออนุมัติใช้</th>
                  <th>หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {items.slice(from, to).map((it, k) => (
                  <tr key={from + k}>
                    <td className="ma-c">{from + k + 1}</td>
                    <td>{it.name.trim() || BLANK}</td>
                    <td>{maCell(it.drawing)}</td>
                    <td>{maCell(it.boq)}</td>
                    <td>{maCell(it.spec)}</td>
                    <td>{maCell(it.detail)}</td>
                    <td className="ma-c">{it.note.trim()}</td>
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
