import { notFound } from 'next/navigation'
import { getSupabaseServer } from '@/lib/supabase/server'
import { PAGE_SIZE } from '@/lib/constants'
import { DOC_KIND_SHORT } from '@/lib/documents'
import { DocPaper } from '@/components/documents/doc-paper'
import { PageHeader } from '@/components/ui/page-header'
import { DataError } from '@/components/ui/data-error'
import { PrintButton } from '@/components/documents/print-button'
import type { SellerSnapshot } from '@/lib/doc-server'

export const metadata = { title: 'พิมพ์เอกสาร' }

export default async function PrintDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const sb = await getSupabaseServer()

  const { data: doc, error } = await sb
    .from('documents')
    .select(`
      id, kind, doc_no, status, doc_date, valid_until, customer_name, customer_tax_id,
      customer_branch, customer_address, customer_phone, vat_mode, vat_rate,
      subtotal, vat_amount, total, amount_words, note, seller, void_reason
    `)
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('[documents] อ่านเอกสารเพื่อพิมพ์ไม่ได้', error.message)
    return <DataError message="โหลดเอกสารไม่สำเร็จ" />
  }
  if (!doc) notFound()

  const { data: lines } = await sb
    .from('document_lines')
    .select('id, seq, description, qty, unit, unit_price, line_total')
    .eq('document_id', id)
    .order('seq', { ascending: true })
    .range(0, PAGE_SIZE * 2 - 1)

  /**
   * 🔴 ผู้ขายอ่านจาก **สำเนาในแถว** ที่แช่แข็งไว้ตอนออกเอกสาร
   * ไม่ได้ join กลับไปที่ `branding`/`app_settings` — ใบที่ออกไปปีที่แล้ว
   * ต้องพิมพ์ออกมาเหมือนใบที่ลูกค้าถืออยู่ แม้ที่อยู่บริษัทจะเปลี่ยนไปแล้ว
   * · ร่างยังไม่มีสำเนา จึงว่างไว้ (ร่างไม่ควรถูกส่งให้ใครอยู่แล้ว)
   */
  const seller = (doc.seller ?? null) as SellerSnapshot | null

  return (
    <>
      {/* หัวข้อหน้ากับปุ่มย้อนกลับถูกซ่อนตอนพิมพ์ — กระดาษมีหัวของตัวเองอยู่แล้ว */}
      <PageHeader
        className="print-hide"
        title={`พิมพ์${DOC_KIND_SHORT[doc.kind]}`}
        subtitle={doc.doc_no ? `เลขที่ ${doc.doc_no}` : 'ยังเป็นร่าง — ยังไม่มีเลขที่เอกสาร'}
        action={<PrintButton docId={doc.id} canMarkSent={doc.status === 'issued'} />}
        backHref={`/documents/${doc.id}`}
      />

      {!seller && (
        <p className="print-hide mb-3 rounded-lg border border-status-progress-ring bg-status-progress-bg px-3 py-2.5 text-sm text-status-progress">
          ใบนี้ยังเป็น<span className="font-semibold">ร่าง</span> — ยังไม่มีเลขที่เอกสารและยังไม่ได้บันทึก
          ข้อมูลผู้ขายลงในใบ · กด &ldquo;ออกเอกสาร&rdquo; ก่อนพิมพ์ส่งลูกค้า
        </p>
      )}

      {/* ── กระดาษ ─────────────────────────────────────────────────── */}
      <DocPaper doc={doc} lines={lines ?? []} seller={seller} />
    </>
  )
}
