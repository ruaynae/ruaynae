import { bahtText } from '@/lib/baht-text'
import { thaiDate } from '@/lib/letters'
import type { ProgressWork } from '@/lib/progress-work'
import { psBudget, psProgress, psTime, psTotalDays, type ProjectSummary } from '@/lib/project-summary'

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const million = (n: number) => (n / 1e6).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
const p2 = (n: number) => n.toFixed(2)
const p0 = (n: number) => (Math.abs(n - Math.round(n)) < 0.005 ? String(Math.round(n)) : n.toFixed(2))

/**
 * ใบ "รายละเอียดโครงการ" + "สรุปความก้าวหน้าของโครงการ" (R37) — แผ่น A4 แนวตั้ง 2 ใบ แนบหลังใบปะหน้าหนังสือส่งมอบงาน
 * 🔴 ไม่มี `'use client'` — ผังกระดาษล้วน · ใบสรุปความก้าวหน้าคิดจากภาพนิ่งปริมาณงานของหนังสือฉบับเดียวกัน (ไม่มี = พิมพ์ใบรายละเอียดอย่างเดียว)
 */
export function ProjectSummaryPaper({ info, pw, asOf }: { info: ProjectSummary; pw: ProgressWork | null; asOf: string }) {
  const days = psTotalDays(info)
  const time = psTime(info, asOf)
  const prog = pw ? psProgress(pw) : null
  const bud = psBudget(info.budget)
  const blank = '.....'
  return (
    <>
      <article className="paper letter-sheet ps-sheet">
        <p className="ps-bar">รายละเอียดโครงการ</p>
        <p className="ps-center ps-b">{info.project || blank}</p>
        <p className="ps-center ps-b">สถานที่ก่อสร้าง {info.location || blank}</p>
        <table className="ps-kv">
          <tbody>
            <tr><td className="ps-k">ชื่อโครงการ</td><td colSpan={3}>{info.project || blank}</td></tr>
            <tr><td className="ps-k">ผู้ว่าจ้าง</td><td colSpan={3}>{info.owner || blank}</td></tr>
            <tr><td className="ps-k">สถานที่ก่อสร้าง</td><td colSpan={3}>{info.location || blank}</td></tr>
            <tr>
              <td className="ps-k">สัญญาเลขที่</td><td>{info.contractNo || blank}</td>
              <td className="ps-k2">ลงวันที่</td><td>{info.contractDate ? thaiDate(info.contractDate) : blank}</td>
            </tr>
            <tr><td className="ps-k">วันเริ่มต้นสัญญา</td><td colSpan={3}>{info.start ? thaiDate(info.start) : blank}</td></tr>
            <tr><td className="ps-k">วันสิ้นสุดสัญญา</td><td colSpan={3}>{info.end ? thaiDate(info.end) : blank}</td></tr>
            <tr>
              <td className="ps-k">ระยะเวลาก่อสร้าง</td><td>{days ?? blank} วัน</td>
              <td className="ps-k2">งวดงานทั้งหมด</td><td>{info.installments ?? blank} งวดงาน</td>
            </tr>
            <tr><td className="ps-k">แก้ไขเพิ่มเติม</td><td colSpan={3}>{info.amendments}</td></tr>
            <tr>
              <td className="ps-k">ราคาค่าก่อสร้าง</td>
              <td colSpan={3}>{info.contract != null ? `${money(info.contract)} บาท (${bahtText(info.contract)})` : blank}</td>
            </tr>
            <tr><td className="ps-k">ผู้รับจ้าง</td><td colSpan={3}>{info.contractor || blank}</td></tr>
            <tr><td className="ps-k">ตัวแทนผู้รับจ้าง</td><td colSpan={3}>{info.rep || blank}</td></tr>
          </tbody>
        </table>
      </article>

      {prog && (
        <article className="paper letter-sheet ps-sheet">
          <p className="ps-bar">สรุปความก้าวหน้าของโครงการ</p>

          <table className="ps-grid">
            <thead>
              <tr><th>สรุประยะเวลาก่อสร้าง</th><th colSpan={2}>ใช้ไปแล้ว (วัน/%)</th><th colSpan={2}>คงเหลือ (วัน/%)</th><th>กำหนดแล้วเสร็จ</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>เวลาก่อสร้างรวม {days ?? blank} วัน</td>
                <td className="ps-n ps-b">{time ? time.used : '-'}</td><td className="ps-n">{time ? p2(time.usedPct) : '-'}</td>
                <td className="ps-n ps-b">{time ? time.remain : '-'}</td><td className="ps-n">{time ? p2(time.remainPct) : '-'}</td>
                <td className="ps-c ps-b">{info.end ? thaiDate(info.end) : blank}</td>
              </tr>
            </tbody>
          </table>

          <table className="ps-grid">
            <thead>
              <tr><th rowSpan={2}>หมวดงาน</th><th colSpan={2}>มูลค่างานตามสัญญา</th><th colSpan={2}>มูลค่างานที่ได้จริง</th><th rowSpan={2}>คงค้าง %</th></tr>
              <tr><th>บาท(ล้าน)</th><th>%</th><th>บาท(ล้าน)</th><th>%</th></tr>
            </thead>
            <tbody>
              {prog.groups.map((g, i) => (
                <tr key={g.name}>
                  <td>{g.name}</td>
                  <td className="ps-n">{money(g.contract)}</td><td className="ps-n">{p2(prog.contractPct[i])}</td>
                  <td className="ps-n">{money(g.actual)}</td><td className="ps-n">{p2(prog.actualPct[i])}</td>
                  <td className="ps-n">{p2(prog.leftPct[i])}</td>
                </tr>
              ))}
              <tr className="ps-total">
                <td className="ps-c">รวม</td>
                <td className="ps-n">{money(prog.contract)}</td><td className="ps-n">100.00</td>
                <td className="ps-n">{money(prog.actual)}</td><td className="ps-n">{p2(prog.totalActualPct)}</td>
                <td className="ps-n">{p2(prog.totalLeftPct)}</td>
              </tr>
            </tbody>
          </table>

          {bud.lines.length > 0 && (
            <table className="ps-grid">
              <thead>
                <tr><th rowSpan={2}>สรุปการใช้จ่ายตามปีงบประมาณ</th><th colSpan={2}>เงินงบประมาณ</th><th colSpan={2}>เบิกจ่ายแล้ว</th><th colSpan={2}>คงเหลือ</th></tr>
                <tr><th>บาท(ล้าน)</th><th>%</th><th>บาท(ล้าน)</th><th>%</th><th>บาท(ล้าน)</th><th>%</th></tr>
              </thead>
              <tbody>
                {bud.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="ps-c">{l.label}</td>
                    <td className="ps-n">{million(l.budget)}</td><td className="ps-n">{p0(l.budgetPct)}</td>
                    <td className="ps-n">{million(l.paid)}</td><td className="ps-n">{p2(l.paidPct)}</td>
                    <td className="ps-n">{million(l.left)}</td><td className="ps-n">{p0(l.leftPct)}</td>
                  </tr>
                ))}
                <tr className="ps-total">
                  <td className="ps-c">รวม</td>
                  <td className="ps-n">{million(bud.total.budget)}</td><td className="ps-n">{p0(bud.total.budgetPct)}</td>
                  <td className="ps-n">{million(bud.total.paid)}</td><td className="ps-n">{p2(bud.total.paidPct)}</td>
                  <td className="ps-n">{million(bud.total.left)}</td><td className="ps-n">{p0(bud.total.leftPct)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </article>
      )}
    </>
  )
}
