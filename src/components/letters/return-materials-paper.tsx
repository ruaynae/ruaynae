import { RM_TITLE, rmItems, type ReturnMaterials } from '@/lib/return-materials'

/**
 * แผ่น A4 แนวตั้ง "ตารางวัสดุที่ส่งคืน" (หนังสือ "ขอนำส่งคืนวัสดุที่ได้จากการรื้อถอน") — ลำดับ · รายการ · จำนวน · หน่วย · ภาพประกอบ 1–4 รูป
 * 🔴 ไม่มี `'use client'` — ผังกระดาษล้วน · รูปจัดตาราง 2 คอลัมน์ในช่องภาพประกอบ · ไหลข้ามหน้าเอง ไม่ตัดรายการกลางคัน
 */
export function ReturnMaterialsPaper({ rm }: { rm: ReturnMaterials }) {
  const items = rmItems(rm)
  return (
    <article className="paper letter-sheet rm-sheet">
      <p className="rm-title">{RM_TITLE}</p>
      <table className="rm-table">
        <colgroup>
          <col style={{ width: '9%' }} />
          <col style={{ width: '31%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '38%' }} />
        </colgroup>
        <thead>
          <tr><th>ลำดับ</th><th>รายการ</th><th>จำนวน</th><th>หน่วย</th><th>ภาพประกอบ</th></tr>
        </thead>
        {items.map((it, i) => (
          <tbody key={i}>
            <tr>
              <td className="rm-c">{i + 1}</td>
              <td>{it.name.trim()}</td>
              <td className="rm-c">{it.qty.trim() || '-'}</td>
              <td className="rm-c">{it.unit.trim() || '-'}</td>
              <td className="rm-photos">
                {it.photos.length > 0 && (
                  <div className={it.photos.length === 1 ? 'rm-grid rm-one' : 'rm-grid'}>
                    {it.photos.map((p, k) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={k} src={p} alt={it.name} />
                    ))}
                  </div>
                )}
              </td>
            </tr>
          </tbody>
        ))}
      </table>
    </article>
  )
}
