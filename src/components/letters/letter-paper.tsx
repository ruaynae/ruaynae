import { ReturnMaterialsPaper } from '@/components/letters/return-materials-paper'
import { hasRmItems, type ReturnMaterials } from '@/lib/return-materials'
import { Fragment } from 'react'
import { ProjectSummaryPaper } from '@/components/letters/project-summary-paper'
import type { ProjectSummary } from '@/lib/project-summary'
import { DomesticSummaryPaper } from '@/components/letters/domestic-summary-paper'
import { hasDomesticSummary, type DomesticSummary } from '@/lib/domestic-summary'
import { EquipmentSummaryPaper } from '@/components/letters/equipment-summary-paper'
import { hasEqItems, type EquipSummary } from '@/lib/equipment-summary'
import { MaintenancePlanPaper } from '@/components/letters/maintenance-plan-paper'
import { hasMpItems, type MaintPlan } from '@/lib/maintenance-plan'
import { SCurvePaper } from '@/components/letters/s-curve-paper'
import { hasSCurve, type SCurveAttach } from '@/lib/s-curve-attach'
import type { CSSProperties } from 'react'
import { BLANK, PHOTOS_PER_PAGE, bodyBlocks, letterDateLine, type LetterPaperData, type PhotoLayout } from '@/lib/letters'
import { hasItems, type ChangeOrder } from '@/lib/change-order'
import { ChangeOrderPaper } from '@/components/letters/change-order-paper'
import { MaterialApprovalPaper } from '@/components/letters/material-approval-paper'
import { MaterialListPaper } from '@/components/letters/material-list-paper'
import { hasMaItems, type MaterialApproval } from '@/lib/material-approval'
import { ProgressWorkPaper } from '@/components/letters/progress-work-paper'
import { hasPwItems, type ProgressWork } from '@/lib/progress-work'

/**
 * กระดาษหนังสือบริษัท A4 (R19) — ผังเดียวกับไฟล์ Word ที่ `letter-docx.ts` สร้าง
 *
 * 🔴 ไม่มี `'use client'` — เป็นผังกระดาษล้วน · ฟอร์มใส่ข้อมูลสดเข้ามา
 * · คลาส `paper` ทำให้ตอนพิมพ์เหลือแค่กระดาษ (globals.css) · `letter-sheet` ทับขอบเป็น 1″
 */

/** `stamped` = ประทับตราบริษัทมุมขวาล่างของรูปนี้ (R27) */
/** หัวข้อของหน้าแค็ตตาล็อก: ของหน้านั้นก่อน · ไม่มี = หน้าแรกใช้หัวข้อรวม · หน้าอื่นไม่มี */
const pageHeading = (p: { heading?: string }, i: number, groupTitle: string) =>
  p.heading?.trim() || (i === 0 ? groupTitle.trim() : '')

export type PaperPhoto = { url: string; caption: string; heading?: string; stamped?: boolean; asPage?: boolean; /** หน้าคั่นก่อนรูปนี้ (หน้าเปล่าพิมพ์ข้อความกลางหน้า) */ divider?: string }

/** หน้าคั่นแนบท้ายหนังสือ — หน้าเปล่า ข้อความกลางหน้า (เช่น "รูปภาพระหว่างก่อสร้าง") */
const DividerPage = ({ text }: { text: string }) => (
  <article className="paper letter-sheet lt-divider">
    <p>{text}</p>
  </article>
)

/** รูปแนบ + ตราประทับซ้อนมุมขวาล่าง — multiply: พื้นขาวของตราที่สแกนมาไม่บังหน้าแค็ตตาล็อก (ตำแหน่ง/ขนาดตรงกับไฟล์ Word) */
function StampedImg({ p, stampUrl, style }: { p: PaperPhoto; stampUrl: string | null; style?: CSSProperties }) {
  return (
    <span className="lt-stampwrap">
      {/* eslint-disable-next-line @next/next/no-img-element -- blob/presigned URL ของรูปแนบ (§9) */}
      <img src={p.url} alt="" style={style} />
      {p.stamped && stampUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- presigned URL ของตราประทับ (§9)
        <img className="lt-stamp" src={stampUrl} alt="" />
      )}
    </span>
  )
}

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
  stampUrl = null,
  breakAt = null,
  copyLabel = null,
  changeOrder = null,
  materialApproval = null,
  materialList = null,
  progressWork = null,
  sCurve = null,
  maintPlan = null,
  equipSummary = null,
  domesticSummary = null,
  photoProject = '',
  projectSummary = null,
  returnMaterials = null,
}: {
  letter: LetterPaperData
  logoUrl: string | null
  photos?: PaperPhoto[]
  photoTitle?: string
  photoLayout?: PhotoLayout
  /** รูปตราประทับบริษัท — ใช้กับรูปที่ติ๊ก `stamped` (R27) */
  stampUrl?: string | null
  /** ตำแหน่ง (px จากขอบบนกระดาษ) ที่เนื้อหาจะเลยไปหน้า 2 · null = ไม่เลย */
  breakAt?: number | null
  /** "สำเนาคู่ฉบับ" กลางหน้าบนสุด — ตรงกับไฟล์ Word · null = ไม่มีป้าย */
  copyLabel?: string | null
  /** ตารางงานเพิ่ม-ลด (R25) — แผ่นแนบต่อจากหนังสือ ก่อนรูปภาพ · ไปกับต้นฉบับเท่านั้น */
  changeOrder?: ChangeOrder | null
  /** ตารางรายการขออนุมัติใช้วัสดุ (R26 · แบบแนบตาราง) — แผ่นแนวนอนต่อจากหนังสือ ก่อนรูปภาพ · ต้นฉบับเท่านั้น */
  materialApproval?: MaterialApproval | null
  /** รายการขออนุมัติใช้วัสดุแบบ "แนบรายการ" — แผ่นแนวตั้งต่อจากหนังสือ ก่อนรูปภาพ · ต้นฉบับเท่านั้น */
  materialList?: MaterialApproval | null
  /** ปริมาณงานที่แล้วเสร็จ (R28 · หนังสือส่งมอบงาน) — แผ่นแนวนอนต่อจากหนังสือ ก่อนรูปภาพ · ต้นฉบับเท่านั้น */
  progressWork?: ProgressWork | null
  sCurve?: SCurveAttach | null
  /** แผนบำรุงรักษาครุภัณฑ์ (R33) — แผ่นแนวนอนต่อจากหนังสือ ก่อนรูปภาพ · ต้นฉบับเท่านั้น */
  maintPlan?: MaintPlan | null
  /** สรุปรายการครุภัณฑ์ (R34) — แผ่นแนวตั้งต่อจากหนังสือ ก่อนรูปภาพ · ต้นฉบับเท่านั้น */
  equipSummary?: EquipSummary | null
  /** สรุปการใช้พัสดุในประเทศ (R35) — แผ่นแนวตั้งต่อจากหนังสือ ก่อนรูปภาพ · ต้นฉบับเท่านั้น */
  domesticSummary?: DomesticSummary | null
  /** ชื่อโครงการบนหัวใบทดสอบ (แบบ 6 รูปต่อหน้าที่รูปมีหัวข้อ) */
  photoProject?: string
  /** รายละเอียดโครงการ + สรุปความก้าวหน้า (R37) — แผ่นแนวตั้ง 2 ใบ ต่อจากใบปะหน้า ก่อนตารางปริมาณงาน · ต้นฉบับเท่านั้น */
  projectSummary?: ProjectSummary | null
  /** ตารางวัสดุที่ส่งคืน — แผ่นแนวตั้งต่อจากหนังสือ ก่อนรูปภาพ · ต้นฉบับเท่านั้น */
  returnMaterials?: ReturnMaterials | null
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

      {projectSummary && <ProjectSummaryPaper info={projectSummary} pw={hasPwItems(progressWork) ? progressWork : null} asOf={progressWork?.asOf ?? ''} />}
      {changeOrder && hasItems(changeOrder) && <ChangeOrderPaper co={changeOrder} />}
      {materialApproval && hasMaItems(materialApproval) && <MaterialApprovalPaper ma={materialApproval} letter={letter} />}
      {materialList && hasMaItems(materialList) && <MaterialListPaper ma={materialList} />}
      {hasPwItems(progressWork) && <ProgressWorkPaper pw={progressWork} company={lh.companyName} />}
      {returnMaterials && hasRmItems(returnMaterials) && <ReturnMaterialsPaper rm={returnMaterials} />}
      {hasDomesticSummary(domesticSummary) && <DomesticSummaryPaper ds={domesticSummary} />}
      {equipSummary && hasEqItems(equipSummary) && <EquipmentSummaryPaper eq={equipSummary} />}
      {maintPlan && hasMpItems(maintPlan) && <MaintenancePlanPaper plan={maintPlan} />}
      {hasSCurve(sCurve) && <SCurvePaper s={sCurve} company={lh.companyName} />}

      {photos.length > 0 && photoLayout === 'p' && (
        // 1 รูปต่อ 1 หน้ากระดาษ (แค็ตตาล็อก · R27) — หัวข้อขึ้นต่อหน้า (heading ของรูป · หน้าแรกถอยไปใช้หัวข้อรวม) · ไม่พิมพ์คำอธิบายใต้รูป (ตรงกับไฟล์ Word)
        photos.map((p, i) => (
          <Fragment key={i}>
            {p.divider && <DividerPage text={p.divider} />}
            <article className="paper letter-sheet lt-fullpage">
              {pageHeading(p, i, photoTitle) && <p className="lt-photo-title">{pageHeading(p, i, photoTitle)}</p>}
              <p className="lt-photo">
                <StampedImg p={p} stampUrl={stampUrl} />
              </p>
            </article>
          </Fragment>
        ))
      )}

      {photos.length > 0 && photoLayout !== 'p' && (() => {
        // แบ่งเป็นหน้า ๆ — ทุกหน้ากระดาษมีขอบของตัวเอง (เดิมรูปที่ล้นไปหน้าถัดไปชิดขอบบน) · หัวข้อรวมขึ้นเฉพาะหน้าแรก
        // หน้าเอกสาร (PDF · asPage) = 1 หน้าต่อ 1 แผ่นเต็มหน้า · รูปถ่ายที่ติดกันจัดตามการจัดวางที่เลือก
        // ใบทดสอบ (แบบ 6 รูปต่อหน้า): รูปที่มี `heading` = เริ่มการทดสอบใหม่ (ขึ้นหน้าใหม่) · รูปถัดไปที่ไม่มีหัวข้อต่อกลุ่มเดิม
        // เกิน 6 รูปขึ้นหน้าถัดไปของการทดสอบเดิม — ทุกหน้ามีหัว โครงการ / ผู้รับเหมา / เอกสาร
        // `divider` = หน้าคั่นก่อนรูปนี้ (หน้าเปล่าพิมพ์ข้อความกลางหน้า) — รูปนั้นขึ้นหน้าใหม่เสมอ
        type Group = { page: PaperPhoto; divider?: string } | { photos: PaperPhoto[]; test: string; divider?: string }
        const groups: Group[] = []
        let test = ''
        for (const p of photos) {
          if (p.asPage) { groups.push({ page: p, divider: p.divider }); test = ''; continue }
          const head = photoLayout === '6' ? (p.heading?.trim() ?? '') : ''
          if (head) test = head
          const last = groups[groups.length - 1]
          const per = PHOTOS_PER_PAGE[photoLayout]
          if (!head && !p.divider && last && 'photos' in last && last.photos.length < per) last.photos.push(p)
          else groups.push({ photos: [p], test, divider: p.divider })
        }
        const single = photos.length === 1 && photoLayout === '1'
        const cell = (p: PaperPhoto | undefined, c: number) => (
          <td key={c}>
            {p && (
              <>
                <StampedImg p={p} stampUrl={stampUrl} />
                {p.caption && <p>{p.caption}</p>}
              </>
            )}
          </td>
        )
        const renderGroup = (g: Group, k: number) => {
          const testTitle = 'photos' in g ? g.test : ''
          const title = testTitle ? (
            <div className="lt-testhead">
              <p><b>โครงการ :</b> {photoProject.trim() || BLANK}</p>
              <p><b>ผู้รับเหมา :</b> {lh.companyName || BLANK}</p>
              <p><b>เอกสาร :</b> {testTitle}</p>
            </div>
          ) : k === 0 && photoTitle.trim() ? <p className="lt-photo-title">{photoTitle.trim()}</p> : null
          if ('page' in g) {
            return (
              <article key={k} className="paper letter-sheet lt-fullpage">
                {title}
                <p className="lt-photo"><StampedImg p={g.page} stampUrl={stampUrl} /></p>
              </article>
            )
          }
          const pg = g.photos
          return (
            <article key={k} className="paper letter-sheet">
              {title}
              {photoLayout === '2' || photoLayout === '6' ? (
                <table className={photoLayout === '6' ? 'lt-grid lt-six' : 'lt-grid'}>
                  <tbody>
                    {Array.from({ length: Math.ceil(pg.length / 2) }, (_, r) => (
                      <tr key={r}>{[pg[r * 2], pg[r * 2 + 1]].map((p, c) => cell(p, c))}</tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                pg.map((p, i) => (
                  <div key={i}>
                    <p className="lt-photo">
                      <StampedImg p={p} stampUrl={stampUrl} style={{ maxHeight: single ? 560 * 1.333 : 270 * 1.333 }} />
                    </p>
                    {p.caption && <p className="lt-caption">{p.caption}</p>}
                  </div>
                ))
              )}
            </article>
          )
        }
        return groups.map((g, k) => (
          <Fragment key={k}>
            {g.divider && <DividerPage text={g.divider} />}
            {renderGroup(g, k)}
          </Fragment>
        ))
      })()}
    </>
  )
}
