import {
  CO_TITLE, blockTotals, coMoney, coQty, coTotals, itemTotals, type ChangeOrder, type CoBlock,
} from '@/lib/change-order'

/**
 * กระดาษ A4 "แบบแสดงรายการ ปริมาณงาน และราคา งานเพิ่ม-ลด" (R25) — แผ่นแนบท้ายหนังสือ
 *
 * 🔴 ไม่มี `'use client'` — ผังกระดาษล้วน (เหมือน `letter-paper.tsx`)
 * · ตัวเลขทุกช่องมาจาก `change-order.ts` ชุดเดียวกับใบปะหน้าและไฟล์ Excel
 * · ตารางยาวเกินหน้าไหลต่อหน้าถัดไปเอง และหัวตารางพิมพ์ซ้ำทุกหน้า (`thead`)
 */

const MARK = { cut: 'co-band-cut', add: 'co-band-add' } as const

function Block({ b, side, factor }: { b: CoBlock; side: 'cut' | 'add'; factor: number }) {
  const t = blockTotals(b, factor)
  const label = b.title || (side === 'cut' ? 'งานลด' : 'งานเพิ่ม')
  return (
    <>
      <tr className={MARK[side]}>
        <td />
        <td colSpan={9} className="co-b">{label}</td>
      </tr>
      {b.rows.map((r, i) => {
        if (r.t === 'group') {
          return (
            <tr key={i}>
              <td className="co-c co-b">{r.no}</td>
              <td colSpan={8} className="co-b">{r.text}</td>
              <td className={`co-c co-tag ${r.equip ? 'co-tag-vat' : 'co-tag-f'}`}>{r.equip ? 'VAT 7%' : 'Factor F'}</td>
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
        <td colSpan={4} className="co-c">รวม{label.split(' ')[0]}{t.normalItems > 0 && t.equipItems > 0 ? ' (ทุกหมวด)' : ''}</td>
        <td className="co-n">{coMoney(t.mat, false)}</td>
        <td />
        <td className="co-n">{coMoney(t.lab, false)}</td>
        <td className="co-n">{coMoney(t.sum, false)}</td>
        <td />
      </tr>
      {t.normalItems > 0 && t.equipItems > 0 && (
        <tr className="co-sub">
          <td />
          <td colSpan={4}>ส่วนที่คูณ Factor F (หมวดทั่วไป)</td>
          <td className="co-n">{coMoney(t.nMat, false)}</td>
          <td />
          <td className="co-n">{coMoney(t.nLab, false)}</td>
          <td className="co-n">{coMoney(t.nSum, false)}</td>
          <td />
        </tr>
      )}
      {(t.normalItems > 0 || t.equipItems === 0) && (
        <tr className="co-b">
          <td />
          <td colSpan={4} className="co-c">Factor F ({factor})</td>
          <td className="co-n">{coMoney(t.fMat, false)}</td>
          <td />
          <td className="co-n">{coMoney(t.fLab, false)}</td>
          <td className="co-n">{coMoney(t.fSum, false)}</td>
          <td />
        </tr>
      )}
      {t.normalItems > 0 && t.equipItems > 0 && (
        <tr className="co-sub">
          <td />
          <td colSpan={4}>ส่วนที่บวก VAT 7% (หมวดครุภัณฑ์)</td>
          <td className="co-n">{coMoney(t.eMat, false)}</td>
          <td />
          <td className="co-n">{coMoney(t.eLab, false)}</td>
          <td className="co-n">{coMoney(t.eSum, false)}</td>
          <td />
        </tr>
      )}
      {t.equipItems > 0 && (
        <tr className="co-b">
          <td />
          <td colSpan={4} className="co-c">ภาษีมูลค่าเพิ่ม 7%</td>
          <td className="co-n">{coMoney(t.vMat, false)}</td>
          <td />
          <td className="co-n">{coMoney(t.vLab, false)}</td>
          <td className="co-n">{coMoney(t.vSum, false)}</td>
          <td />
        </tr>
      )}
      <tr className="co-b">
        <td />
        <td colSpan={4} className="co-c">รวมยอดทั้งหมด ({label})</td>
        <td className="co-n">{coMoney(t.totalMat, false)}</td>
        <td />
        <td className="co-n">{coMoney(t.totalLab, false)}</td>
        <td className="co-n co-total">{coMoney(t.total, false)}</td>
        <td />
      </tr>
    </>
  )
}

export function ChangeOrderPaper({ co }: { co: ChangeOrder }) {
  const t = coTotals(co)
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
      <table className="co-table">
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
          {co.cut.rows.length > 0 && <Block b={co.cut} side="cut" factor={co.factor} />}
          {co.add.rows.length > 0 && <Block b={co.add} side="add" factor={co.factor} />}
          <tr className="co-diff">
            <td />
            <td colSpan={7} className="co-c">ส่วนต่าง {t.kind ?? ''}</td>
            <td className="co-n">{coMoney(t.amount, false)}</td>
            <td />
          </tr>
        </tbody>
      </table>
    </article>
  )
}
