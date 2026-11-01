import {
  CO_TITLE, blockTotals, coMoney, coQty, coTotals, itemTotals, round2, splitBlock, type ChangeOrder, type CoBlock, type CoRow,
} from '@/lib/change-order'

/**
 * กระดาษ A4 "แบบแสดงรายการ ปริมาณงาน และราคา งานเพิ่ม-ลด" (R25) — แผ่นแนบท้ายหนังสือ
 *
 * 🔴 ไม่มี `'use client'` — ผังกระดาษล้วน (เหมือน `letter-paper.tsx`)
 * · ตัวเลขทุกช่องมาจาก `change-order.ts` ชุดเดียวกับใบปะหน้าและไฟล์ Excel
 * · ตารางยาวเกินหน้าไหลต่อหน้าถัดไปเอง และหัวตารางพิมพ์ซ้ำทุกหน้า (`thead`)
 */

const MARK = { cut: 'co-band-cut', add: 'co-band-add' } as const

type Mode = 'f' | 'vat'

/** หนึ่งตาราง: หมวดทั่วไป (บวก Factor F) หรือหมวดครุภัณฑ์ (บวก VAT 7%) ของงานลด/งานเพิ่ม */
function Section({ rows, title, side, factor, mode }: { rows: CoRow[]; title: string; side: 'cut' | 'add'; factor: number; mode: Mode }) {
  const t = blockTotals({ title, rows }, factor)
  const word = `${title.split(' ')[0]}${mode === 'vat' ? ' (ครุภัณฑ์)' : ''}`
  const [cMat, cLab, cSum] = mode === 'vat' ? [t.vMat, t.vLab, t.vSum] : [t.fMat, t.fLab, t.fSum]
  return (
    <>
      <tr className={MARK[side]}>
        <td />
        <td colSpan={9} className="co-b">{word}</td>
      </tr>
      {rows.map((r, i) => {
        if (r.t === 'group') {
          return (
            <tr key={i}>
              <td className="co-c co-b">{r.no}</td>
              <td colSpan={9} className="co-b">{r.text}</td>
            </tr>
          )
        }
        if (r.t === 'head') {
          return (
            <tr key={i}>
              <td />
              <td colSpan={9} className="co-b">{r.text}</td>
            </tr>
          )
        }
        const x = itemTotals(r)
        return (
          <tr key={i}>
            <td />
            <td>{r.text}</td>
            <td className="co-n">{coQty(r.qty)}</td>
            <td className="co-c">{r.unit}</td>
            <td className="co-n">{r.mat ? coMoney(r.mat) : '-'}</td>
            <td className="co-n">{coMoney(x.mat)}</td>
            <td className="co-n">{r.lab ? coMoney(r.lab) : '-'}</td>
            <td className="co-n">{coMoney(x.lab)}</td>
            <td className="co-n">{coMoney(x.total)}</td>
            <td className="co-c">{r.note}</td>
          </tr>
        )
      })}
      <tr className={`${MARK[side]} co-b`}>
        <td />
        <td colSpan={4} className="co-c">รวม{word}</td>
        <td className="co-n">{coMoney(t.mat, false)}</td>
        <td />
        <td className="co-n">{coMoney(t.lab, false)}</td>
        <td className="co-n">{coMoney(t.sum, false)}</td>
        <td />
      </tr>
      <tr className="co-b">
        <td />
        <td colSpan={4} className="co-c">{mode === 'vat' ? 'ภาษีมูลค่าเพิ่ม 7%' : `Factor F (${factor})`}</td>
        <td className="co-n">{coMoney(cMat, false)}</td>
        <td />
        <td className="co-n">{coMoney(cLab, false)}</td>
        <td className="co-n">{coMoney(cSum, false)}</td>
        <td />
      </tr>
      <tr className="co-b">
        <td />
        <td colSpan={4} className="co-c">รวมยอดทั้งหมด ({word})</td>
        <td className="co-n">{coMoney(t.totalMat, false)}</td>
        <td />
        <td className="co-n">{coMoney(t.totalLab, false)}</td>
        <td className="co-n co-total">{coMoney(t.total, false)}</td>
        <td />
      </tr>
    </>
  )
}

/** งานลด/งานเพิ่มหนึ่งฝั่ง: ตาราง Factor F + ตารางครุภัณฑ์ (ถ้ามี) + ยอดรวมของทั้งสองตาราง */
function Side({ b, side, factor }: { b: CoBlock; side: 'cut' | 'add'; factor: number }) {
  const title = b.title || (side === 'cut' ? 'งานลด' : 'งานเพิ่ม')
  const { normal, equip } = splitBlock(b)
  const tn = blockTotals({ title, rows: normal }, factor)
  const te = blockTotals({ title, rows: equip }, factor)
  const showN = tn.items > 0 || te.items === 0
  const showE = te.items > 0
  return (
    <>
      {showN && <Section rows={normal} title={title} side={side} factor={factor} mode="f" />}
      {showE && <Section rows={equip} title={title} side={side} factor={factor} mode="vat" />}
      {showN && showE && (
        <tr className="co-summary co-b">
          <td />
          <td colSpan={4} className="co-c">รวมทั้งสิ้น {title.split(' ')[0]} (Factor F + ภาษีมูลค่าเพิ่ม)</td>
          <td className="co-n">{coMoney(round2(tn.totalMat + te.totalMat), false)}</td>
          <td />
          <td className="co-n">{coMoney(round2(tn.totalLab + te.totalLab), false)}</td>
          <td className="co-n co-total">{coMoney(round2(tn.total + te.total), false)}</td>
          <td />
        </tr>
      )}
    </>
  )
}

export function ChangeOrderPaper({ co }: { co: ChangeOrder }) {
  const t = coTotals(co)
  // งานลดกับงานเพิ่มแยกเป็นคนละตาราง — งานเพิ่มขึ้นหน้าใหม่เสมอ (ไม่ให้หัวตารางค้างท้ายหน้าเดียวกับงานลด)
  const tables = (['cut', 'add'] as const).filter((k) => co[k].rows.length > 0)
  if (tables.length === 0) tables.push('cut')
  const head: [string, string][] = [
    ['กลุ่มงาน/งาน', co.work],
    ['ชื่อโครงการ/งานก่อสร้าง', co.project],
    ['สถานที่ก่อสร้าง', co.location],
    ['หน่วยงานเจ้าของโครงการ/งานก่อสร้าง', co.owner],
  ]
  return (
    <article className="paper letter-sheet co-sheet">
      <p className="co-title">{CO_TITLE}</p>
      <table className="co-head">
        <tbody>
          {head.map(([k, v], i) => (
            <tr key={k}>
              <td className="co-b">{k}</td>
              <td>{v || ' '}</td>
              <td className="co-n">{i === 0 && co.drawingNo ? <><b>แบบเลขที่</b> {co.drawingNo}</> : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="co-unit">หน่วย : บาท</p>
      {tables.map((side, i) => (
        <table key={side} className="co-table">
          <colgroup>
            <col style={{ width: '5%' }} />
            <col style={{ width: '25%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '9.5%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '8.5%' }} />
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={2}>ลำดับที่</th>
              <th rowSpan={2}>รายการ</th>
              <th rowSpan={2}>จำนวน</th>
              <th rowSpan={2}>หน่วย</th>
              <th colSpan={2}>ราคาค่าวัสดุ</th>
              <th colSpan={2}>ราคาค่าแรง</th>
              <th rowSpan={2}>รวมค่าวัสดุ<br />และแรงงาน</th>
              <th rowSpan={2}>หมายเหตุ</th>
            </tr>
            <tr>
              <th>ราคา/หน่วย</th>
              <th>รวม</th>
              <th>ราคา/หน่วย</th>
              <th>รวม</th>
            </tr>
          </thead>
          <tbody>
            {co[side].rows.length > 0 && <Side b={co[side]} side={side} factor={co.factor} />}
            {i === tables.length - 1 && (
              <tr className="co-diff">
                <td />
                <td colSpan={7} className="co-c">{t.kind ? `รวม${t.kind}ทั้งสิ้น` : 'รวมทั้งสิ้น'}</td>
                <td className="co-n">{coMoney(t.amount, false)}</td>
                <td />
              </tr>
            )}
          </tbody>
        </table>
      ))}
    </article>
  )
}
