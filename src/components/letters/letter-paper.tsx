import { BLANK, bodyBlocks, letterDateLine, type LetterPaperData } from '@/lib/letters'

/**
 * กระดาษหนังสือบริษัท A4 (R19) — ผังเดียวกับไฟล์ Word ที่ `letter-docx.ts` สร้าง
 *
 * 🔴 ไม่มี `'use client'` — เป็นผังกระดาษล้วน · ฟอร์มใส่ข้อมูลสดเข้ามา
 * · คลาส `paper` ทำให้ตอนพิมพ์เหลือแค่กระดาษ (globals.css) · `letter-sheet` ทับขอบเป็น 1″
 */

export type PaperPhoto = { url: string; caption: string }

/** ไฮไลต์ช่องที่ยังไม่ได้กรอก (จุดไข่ปลา · ข้อความในวงเล็บที่ต้องแทน) — บนจอเท่านั้น */
const MARK = new RegExp(`(${BLANK}|\\((?:อธิบาย|ระบุ)[^)]*\\))`)

function Marked({ text }: { text: string }) {
  const parts = text.split(MARK)
  return (
    <>
      {parts.map((p, i) =>
        p === BLANK || /^\((?:อธิบาย|ระบุ)/.test(p)
          ? <span key={i} className="lt-blank-mark">{p}</span>
          : p,
      )}
    </>
  )
}

export function LetterPaper({
  letter,
  logoUrl,
  photos = [],
  photoTitle = '',
  photoLayout = '1',
  breakAt = null,
  copyLabel = null,
}: {
  letter: LetterPaperData
  logoUrl: string | null
  photos?: PaperPhoto[]
  photoTitle?: string
  photoLayout?: '1' | '2'
  /** ตำแหน่ง (px จากขอบบนกระดาษ) ที่เนื้อหาจะเลยไปหน้า 2 · null = ไม่เลย */
  breakAt?: number | null
  /** "สำเนาคู่ฉบับ" กลางหน้าบนสุด — ตรงกับไฟล์ Word · null = ไม่มีป้าย */
  copyLabel?: string | null
}) {
  const lh = letter.letterhead
  const rows = [
    { k: 'เรื่อง', t: letter.subject || BLANK, b: true, wide: false },
    { k: 'เรียน', t: letter.recipient || BLANK, b: true, wide: false },
    ...letter.refs.map((r, i) => ({ k: i ? '' : 'อ้างถึง', t: `${i + 1}. ${r}`, b: false, wide: false })),
    ...letter.attachments.map((a, i) => ({ k: i ? '' : 'สิ่งที่ส่งมาด้วย', t: `${i + 1}. ${a}`, b: false, wide: true })),
  ]

  return (
    <>
      <article className="paper letter-sheet" data-letter-page="1">
        {copyLabel && <p className="lt-copy">{copyLabel}</p>}
        <div className="lt-head">
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- ลิงก์ R2 ที่เซ็นแล้ว ห้ามผ่าน next/image (§9)
            <img className="lt-logo" src={logoUrl} alt="" />
          )}
          <p className="lt-name">{lh.companyName || 'ชื่อบริษัท (ตั้งที่หน้าตั้งค่า)'}</p>
          <p className="lt-addr">{lh.address || ' '}</p>
        </div>
        <p className="lt-gap lt-blank" />
        <p className="lt-b">เลขที่ {letter.letterNo}</p>
        <p className="lt-b lt-date">{letterDateLine(letter.date)}</p>
        <p className="lt-b lt-blank" />

        {rows.map((r, i) => (
          <p
            key={i}
            className={`lt-row${r.wide ? ' lt-wide' : ''}${r.b ? ' lt-b' : ''}${i === rows.length - 1 ? ' lt-last' : ''}`}
          >
            <span className="lt-k">{r.k}</span>
            <Marked text={r.t} />
          </p>
        ))}

        {letter.intro && <p className="lt-p"><Marked text={letter.intro} /></p>}
        {bodyBlocks(letter.body).map((b, i) =>
          b.type === 'li' ? (
            <p key={i} className={`lt-li${b.last ? ' lt-last' : ''}`}>
              <span className="lt-k">{b.mark}</span>
              <Marked text={b.text} />
            </p>
          ) : (
            <p key={i} className="lt-p"><Marked text={b.text} /></p>
          ),
        )}

        <p className="lt-close"><Marked text={letter.closing} /></p>
        <p className="lt-tight lt-blank" />
        <p className="lt-sig">ขอแสดงความนับถือ</p>
        <p className="lt-sig lt-blank" />
        <p className="lt-sig lt-blank" />
        <p className="lt-sig lt-blank" />
        <p className="lt-sig">({lh.signerName || '……………………………………'})</p>
        <p className="lt-sig">{letter.signerTitle || ' '}</p>
        {letter.showReceipt && (
          <div className="lt-receipt">
            <div>รับเอกสารแล้ว</div>
            <div>ลงชื่อ...................................</div>
            <div>วันที่ ........................</div>
          </div>
        )}

        {breakAt !== null && (
          <div className="lt-break print-hide" style={{ top: breakAt }}>
            <span>ขึ้นหน้า 2</span>
          </div>
        )}
      </article>

      {photos.length > 0 && (
        <article className="paper letter-sheet">
          {photoTitle.trim() && <p className="lt-photo-title">{photoTitle.trim()}</p>}
          {photoLayout === '2' ? (
            <table className="lt-grid">
              <tbody>
                {Array.from({ length: Math.ceil(photos.length / 2) }, (_, r) => (
                  <tr key={r}>
                    {[photos[r * 2], photos[r * 2 + 1]].map((p, c) => (
                      <td key={c}>
                        {p && (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element -- blob URL ของรูปที่เพิ่งเลือก */}
                            <img src={p.url} alt="" />
                            {p.caption && <p>{p.caption}</p>}
                          </>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            photos.map((p, i) => (
              <div key={i}>
                <p className="lt-photo">
                  {/* eslint-disable-next-line @next/next/no-img-element -- blob URL ของรูปที่เพิ่งเลือก */}
                  <img src={p.url} alt="" style={{ maxHeight: photos.length === 1 ? 560 * 1.333 : 270 * 1.333 }} />
                </p>
                {p.caption && <p className="lt-caption">{p.caption}</p>}
              </div>
            ))
          )}
        </article>
      )}
    </>
  )
}
