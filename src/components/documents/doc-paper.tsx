import { DOC_KIND_LABEL, SECOND_DATE_LABEL, type DocKind, type DocStatus } from '@/lib/documents'
import type { SellerSnapshot } from '@/lib/doc-server'

/**
 * กระดาษเอกสาร A4 — ผังตามแบบฟอร์มที่เจ้าของใช้อยู่เดิม (Excel · 28 ก.ย. 2569)
 *
 * หัวสองภาษา · กรอบลูกค้าซ้าย / เลขที่-วันที่ขวา · ตารางมีเส้นแบ่งคอลัมน์ยาวลงถึงช่องยอดรวม
 * · ใบเสร็จมีช่อง "รายการรับชำระเงิน" ให้เขียนมือ · ลายเซ็นสามช่อง
 *
 * 🔴 ไม่มี `'use client'` — เป็นแค่ผังกระดาษ อ่านจากสำเนาที่แช่แข็งในแถวเท่านั้น
 * 🔴 คำว่า "ผู้รับเงิน" พิมพ์เฉพาะใบเสร็จ — ใบแจ้งหนี้/ใบเสนอราคายังไม่มีใครรับเงิน
 * การพิมพ์คำนี้ลงไปคือการรับรองเท็จ
 */

export type PaperDoc = {
  kind: DocKind
  status: DocStatus
  doc_no: string | null
  doc_date: string
  valid_until: string | null
  customer_name: string
  customer_tax_id: string | null
  customer_branch: string | null
  customer_address: string | null
  customer_phone: string | null
  vat_mode: string
  vat_rate: number | string
  subtotal: number | string
  vat_amount: number | string
  total: number | string
  amount_words: string | null
  note: string | null
  void_reason: string | null
}

export type PaperLine = {
  id: string
  seq: number
  description: string
  qty: number | string
  unit: string | null
  line_total: number | string
}

/** เงินบนกระดาษ — ทศนิยมสองตำแหน่งเสมอ ต่างจากบนหน้าจอที่ตัดเศษทิ้ง */
const money = (n: number) =>
  n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** `2026-09-23` → `23 / 09 / 2569` แบบฟอร์มเดิม · วันที่ล้วนไม่มีเวลา จึงไม่ต้องแปลงเขตเวลา
 * (พ.ศ. เป็นเรื่องการแสดงผลเท่านั้น — ในฐานข้อมูลยังเป็น ค.ศ.) */
const slashDate = (iso: string) => {
  const [y, m, d] = iso.split('-')
  return `${d} / ${m} / ${Number(y) + 543}`
}

/** ความกว้างคอลัมน์ — ใช้ทั้ง `<col>` และเส้นแบ่งที่ยืดลงถึงก้นตาราง ต้องตรงกันเป๊ะ */
const COLS = [8, 53, 11, 13, 15] as const
const EDGES = COLS.slice(0, -1).map((_, i) => COLS.slice(0, i + 1).reduce((a, b) => a + b, 0))

const SIGN_LABELS: Record<DocKind, [string, string]> = {
  quotation: ['ผู้สั่งซื้อ / อนุมัติ', 'ผู้เสนอราคา'],
  invoice: ['ผู้รับวางบิล', 'ผู้วางบิล'],
  receipt: ['ผู้รับเงิน', 'ผู้ส่งสินค้า'],
}

const Box = ({ className = '', children }: { className?: string; children: React.ReactNode }) => (
  <div className={`border border-black ${className}`}>{children}</div>
)

export function DocPaper({
  doc,
  lines,
  seller,
}: {
  doc: PaperDoc
  lines: PaperLine[]
  seller: SellerSnapshot | null
}) {
  const hasVat = doc.vat_mode !== 'none'
  const company = seller?.companyName ?? ''

  return (
    <article className="paper mx-auto flex aspect-[210/297] w-full max-w-[794px] flex-col rounded-lg border border-line bg-white p-8 text-[13px] leading-snug text-black shadow-e1">
      {/* ── หัว: ผู้ขาย / ชื่อเอกสาร ───────────────────────────────── */}
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">
            {company}
            {seller?.branchLabel ? ` ${seller.branchLabel}` : ''}
          </h1>
        </div>
        <Box className="shrink-0 px-4 py-3 text-center">
          <h2 className="text-base font-bold">{DOC_KIND_LABEL[doc.kind]}</h2>
        </Box>
      </header>

      <div className="mt-2 space-y-0.5">
        {seller?.address && (
          <p className="whitespace-pre-line">
            {doc.kind === 'receipt' ? 'ที่อยู่ที่ได้จดทะเบียนภาษีมูลค่าเพิ่ม : ' : 'ที่อยู่ : '}
            {seller.address}
          </p>
        )}
        {(seller?.phone || seller?.email) && (
          <p>
            {seller?.phone ? `โทร ${seller.phone}` : ''}
            {seller?.phone && seller?.email ? ' · ' : ''}
            {seller?.email ?? ''}
          </p>
        )}
        {seller?.taxId && <p>เลขประจำตัวผู้เสียภาษีอากร&nbsp;&nbsp;{seller.taxId}</p>}
      </div>

      {doc.status === 'void' && (
        <p className="mt-2 text-center text-base font-bold">** ยกเลิก — {doc.void_reason} **</p>
      )}

      {/* ── ลูกค้า / เลขที่-วันที่ ─────────────────────────────────── */}
      <div className="mt-2 flex gap-2">
        <Box className="min-w-0 flex-1 px-2 py-1.5">
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
            <dt className="text-xs">ชื่อลูกค้า / Customers</dt>
            <dd className="min-w-0 border-b border-dotted border-black">{doc.customer_name}</dd>
            <dt className="text-xs">ที่อยู่ / Address</dt>
            <dd className="min-w-0 whitespace-pre-line border-b border-dotted border-black">
              {doc.customer_address ?? ''}
            </dd>
          </dl>
          <p className="mt-1">
            เลขประจำตัวผู้เสียภาษี&nbsp;&nbsp;{doc.customer_tax_id ?? ''}
            {doc.customer_branch ? ` · ${doc.customer_branch}` : ''}
            {doc.customer_phone ? ` · โทร ${doc.customer_phone}` : ''}
          </p>
        </Box>
        <Box className="w-52 shrink-0 px-3 py-2">
          <table className="w-full">
            <tbody>
              <tr>
                <td className="py-1 text-xs">เลขที่ / No.</td>
                <td className="py-1 text-right font-bold tnum">{doc.doc_no ?? '—'}</td>
              </tr>
              <tr>
                <td className="py-1 text-xs">วันที่ / Date</td>
                <td className="py-1 text-right tnum">{slashDate(doc.doc_date)}</td>
              </tr>
              {/* วันที่สอง — "ยืนราคาถึง" บนใบเสนอราคา · "กำหนดชำระ" บนใบแจ้งหนี้ */}
              {doc.valid_until && SECOND_DATE_LABEL[doc.kind] && (
                <tr>
                  <td className="py-1 text-xs">{SECOND_DATE_LABEL[doc.kind]}</td>
                  <td className="py-1 text-right tnum">{slashDate(doc.valid_until)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </Box>
      </div>

      {/* ── ตารางรายการ — ยืดเต็มที่ว่าง เส้นแบ่งคอลัมน์ลากลงถึงก้น ─────── */}
      <div className="relative mt-2 flex min-h-40 flex-1 flex-col border border-black">
        {EDGES.map((left) => (
          <span
            key={left}
            aria-hidden
            className="absolute inset-y-0 border-l border-black"
            style={{ left: `${left}%` }}
          />
        ))}
        <table className="relative w-full table-fixed border-collapse">
          <colgroup>
            {COLS.map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}
          </colgroup>
          <thead>
            <tr className="border-b border-black text-center text-xs">
              <th className="px-1 py-1 font-normal">ลำดับที่<br />Item</th>
              <th className="px-1 py-1 font-normal">รายการ<br />Description</th>
              <th className="px-1 py-1 font-normal">จำนวน<br />Quantity</th>
              <th className="px-1 py-1 font-normal">ราคา/หน่วย<br />Unit Price</th>
              <th className="px-1 py-1 font-normal">จำนวนเงิน<br />Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const qty = Number(l.qty)
              return (
                <tr key={l.id} className="align-top">
                  <td className="px-1 pt-1.5 text-center tnum">{l.seq}</td>
                  <td className="whitespace-pre-line px-1.5 pt-1.5 [overflow-wrap:anywhere]">{l.description}</td>
                  <td className="px-1 pt-1.5 text-center tnum">
                    {money(qty)}{l.unit ? ` ${l.unit}` : ''}
                  </td>
                  {/* 🔴 ราคา/หน่วยที่พิมพ์คือ **ยอดก่อน VAT** ที่หารกลับแล้ว
                      เพื่อให้คอลัมน์จำนวนเงินบวกได้ยอดรวมก่อนภาษีเป๊ะ */}
                  <td className="px-1.5 pt-1.5 text-right tnum">
                    {money(qty > 0 ? Number(l.line_total) / qty : 0)}
                  </td>
                  <td className="px-1.5 pt-1.5 text-right tnum">{money(Number(l.line_total))}</td>
                </tr>
              )
            })}
            {doc.note && (
              <tr className="align-top">
                <td />
                <td className="whitespace-pre-line px-1.5 pt-3 text-xs">{doc.note}</td>
                <td /><td /><td />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── ชำระเงิน / ยอดรวม ─────────────────────────────────────── */}
      <div className="grid grid-cols-[61fr_24fr_15fr] border-x border-b border-black">
        <div className="row-span-3 px-1.5 py-1 text-xs">
          {doc.kind === 'receipt' ? (
            <div className="space-y-2">
              <p className="flex flex-wrap gap-x-4">
                <span>รายการรับชำระเงิน</span>
                <span>☐ เงินสด</span>
                <span>☐ เงินโอน</span>
                <span>☐ เช็ค</span>
              </p>
              <p className="grid grid-cols-2 gap-x-3">
                <span>ธนาคาร/Bank <span className="inline-block w-24 border-b border-dotted border-black" /></span>
                <span>เลขที่/Chq # <span className="inline-block w-20 border-b border-dotted border-black" /></span>
              </p>
              <p className="grid grid-cols-2 gap-x-3">
                <span>สาขา/Branch <span className="inline-block w-24 border-b border-dotted border-black" /></span>
                <span>ลว./Date <span className="inline-block w-24 border-b border-dotted border-black" /></span>
              </p>
              <p>จำนวนเงิน/Amount <span className="inline-block w-48 border-b border-dotted border-black" /></p>
            </div>
          ) : null}
          {seller?.bankAccount && <p className="mt-2 whitespace-pre-line">{seller.bankAccount}</p>}
        </div>
        <div className="border-l border-black px-1 py-1 text-center text-xs">รวมเงิน<br />TOTAL</div>
        <div className="border-l border-black px-1.5 py-1 text-right tnum">{money(Number(doc.subtotal))}</div>
        {hasVat ? (
          <>
            <div className="border-l border-t border-black px-1 py-1 text-center text-xs">
              ภาษีมูลค่าเพิ่ม<br />( VAT {Math.round(Number(doc.vat_rate) * 100)}% )
            </div>
            <div className="border-l border-t border-black px-1.5 py-1 text-right tnum">
              {money(Number(doc.vat_amount))}
            </div>
          </>
        ) : (
          <>
            <div className="border-l border-t border-black" />
            <div className="border-l border-t border-black" />
          </>
        )}
        <div className="border-l border-t border-black bg-[#e4e4e4] px-1 py-1 text-center text-xs font-semibold">
          ยอดเงินสุทธิ<br />NET AMOUNT
        </div>
        <div className="border-l border-t border-black px-1.5 py-1 text-right font-bold tnum">
          {money(Number(doc.total))}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <span className="shrink-0 text-xs">ตัวอักษร</span>
        <Box className="px-3 py-1 font-semibold">( {doc.amount_words} )</Box>
      </div>

      {/* ── ลายเซ็น — ดันลงก้นกระดาษ ──────────────────────────────── */}
      <div className="mt-auto grid grid-cols-[1fr_1fr_2fr] gap-0 pt-4 text-xs">
        {SIGN_LABELS[doc.kind].map((label) => (
          <Box key={label} className="-ml-px flex h-28 flex-col px-2 py-1 first:ml-0">
            <p className="text-center font-semibold">{label}</p>
            <p className="mt-auto">วันที่ ..................................</p>
          </Box>
        ))}
        <Box className="-ml-px flex h-28 flex-col px-2 py-1 text-center">
          <p className="font-semibold">ในนาม {company}</p>
          <p className="mt-auto border-t border-dotted border-black pt-0.5">
            {seller?.signatoryName ? `(${seller.signatoryName}) ` : ''}ผู้มีอำนาจลงนาม
          </p>
          {seller?.signatoryTitle && <p>{seller.signatoryTitle}</p>}
        </Box>
      </div>

      {seller?.footer && <p className="mt-1.5 text-center text-xs">{seller.footer}</p>}
    </article>
  )
}
