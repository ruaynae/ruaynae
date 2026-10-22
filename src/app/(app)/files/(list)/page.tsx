import Link from 'next/link'
import { ChevronLeft, ChevronRight, FileArchive, FileImage, FileSpreadsheet, FileText, FolderArchive, type LucideIcon } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { DataError } from '@/components/ui/data-error'
import { EmptyState } from '@/components/ui/states'
import { Badge } from '@/components/ui/badge'
import { FileActions, FileFilters, UploadFilesButton } from '@/components/files/files-client'
import { getSupabaseServer } from '@/lib/supabase/server'
import { isFilesTableMissing } from '@/lib/files-server'
import { FILE_CATEGORY_LABEL, FILE_MESSAGES, extOf, isFileCategory, safeFileQuery, type FileCategory } from '@/lib/files'
import { fmtBytes, fmtDate, fmtDateTime, todayInBangkok } from '@/lib/format'
import { isUuid } from '@/lib/transactions'

export const metadata = { title: 'คลังเอกสาร' }

const PAGE = 50

const iconOf = (name: string): LucideIcon => {
  const e = extOf(name)
  if (['jpg', 'jpeg', 'png', 'webp', 'heic', 'tif', 'tiff'].includes(e)) return FileImage
  if (['xlsx', 'xls', 'csv'].includes(e)) return FileSpreadsheet
  if (['zip', 'rar', '7z'].includes(e)) return FileArchive
  return FileText
}

/**
 * คลังเอกสาร — สัญญาจ้าง · แบบก่อสร้าง · BOQ · หนังสือรับรองผลงาน (คำขอเจ้าของ 22 ต.ค. 2569 "กลับมาค้นหาง่าย")
 * · ค้นจากชื่อเอกสาร ชื่อไฟล์ เลขที่ หมายเหตุ · กรองหมวด/โครงการ/ปี (ปีของวันที่เอกสาร)
 * · order + range (§7) · ตารางยังไม่มี = บอกให้รัน migration ไม่ใช่หน้าพัง
 */
export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cat?: string; site?: string; year?: string; page?: string }>
}) {
  const sp = await searchParams
  const q = safeFileQuery(sp.q ?? '')
  const cat: FileCategory | null = isFileCategory(sp.cat) ? sp.cat : null
  const site = sp.site && (isUuid(sp.site) || sp.site === 'none') ? sp.site : null
  const year = /^\d{4}$/.test(sp.year ?? '') ? Number(sp.year) : null
  const page = Math.max(0, Math.min(1000, Number(sp.page) || 0))

  const sb = await getSupabaseServer()
  let list = sb
    .from('project_files')
    .select('id, category, title, doc_no, doc_date, note, file_name, byte_size, site_id, created_at')
  if (q) list = list.or(`title.ilike.%${q}%,file_name.ilike.%${q}%,doc_no.ilike.%${q}%,note.ilike.%${q}%`)
  if (cat) list = list.eq('category', cat)
  if (site === 'none') list = list.is('site_id', null)
  else if (site) list = list.eq('site_id', site)
  if (year) list = list.gte('doc_date', `${year}-01-01`).lte('doc_date', `${year}-12-31`)

  const [{ data, error }, { data: sites, error: sErr }] = await Promise.all([
    list.order('created_at', { ascending: false }).order('id', { ascending: false }).range(page * PAGE, page * PAGE + PAGE),
    sb.from('sites').select('id, name').order('name', { ascending: true }).range(0, 499),
  ])
  if (sErr) console.error('[files] อ่านรายชื่อโครงการไม่ได้', sErr.message)
  const siteName = new Map((sites ?? []).map((s) => [s.id, s.name]))
  const rows = (data ?? []).slice(0, PAGE)
  const hasMore = (data ?? []).length > PAGE
  const filtered = Boolean(q || cat || site || year)

  const thisYear = Number(todayInBangkok().slice(0, 4))
  const qs = (p: number) => {
    const u = new URLSearchParams()
    if (sp.q) u.set('q', sp.q)
    if (cat) u.set('cat', cat)
    if (site) u.set('site', site)
    if (year) u.set('year', String(year))
    if (p) u.set('page', String(p))
    const s = u.toString()
    return s ? `/files?${s}` : '/files'
  }

  let body
  if (error && isFilesTableMissing(error)) {
    body = <div className="panel px-5 py-6 text-sm font-semibold text-status-progress">{FILE_MESSAGES.TABLE_MISSING}</div>
  } else if (error) {
    console.error('[files] อ่านคลังเอกสารไม่ได้', error.message)
    body = <DataError message="โหลดคลังเอกสารไม่สำเร็จ" />
  } else if (!rows.length) {
    body = (
      <EmptyState
        icon={FolderArchive}
        message={filtered ? 'ไม่พบเอกสารที่ค้นหา — ลองคำอื่น หรือล้างตัวกรอง' : 'ยังไม่มีเอกสาร — กด "อัปโหลดเอกสาร" เพื่อเก็บสัญญา แบบ BOQ หรือหนังสือรับรองผลงาน'}
        action={filtered ? <Link href="/files" className="btn-secondary">ล้างตัวกรอง</Link> : undefined}
      />
    )
  } else {
    body = (
      <>
        <ul className="panel divide-y divide-line-soft">
          {rows.map((f) => {
            const Icon = iconOf(f.file_name)
            return (
              <li key={f.id} className="flex items-start gap-3 px-4 py-3">
                <Icon className="mt-0.5 size-6 shrink-0 text-brand" strokeWidth={1.7} />
                <div className="min-w-0 flex-1">
                  <a href={`/api/files/${f.id}`} target="_blank" rel="noopener" className="break-words font-semibold text-ink hover:text-brand hover:underline">
                    {f.title}
                  </a>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-token">
                    <Badge tone="info">{FILE_CATEGORY_LABEL[f.category as FileCategory] ?? f.category}</Badge>
                    {f.site_id && siteName.has(f.site_id) && (
                      <Link href={`/sites/${f.site_id}`} className="hover:text-brand hover:underline">{siteName.get(f.site_id)}</Link>
                    )}
                    {f.doc_no && <span>เลขที่ {f.doc_no}</span>}
                    {f.doc_date && <span>ลงวันที่ {fmtDate(f.doc_date)}</span>}
                  </div>
                  {f.note && <p className="mt-1 whitespace-pre-line break-words text-sm text-ink-2">{f.note}</p>}
                  <p className="mt-0.5 break-all text-xs text-muted-token">
                    {f.file_name} · {fmtBytes(f.byte_size)} · เพิ่มเมื่อ {fmtDateTime(f.created_at)}
                  </p>
                </div>
                <FileActions
                  file={{
                    id: f.id, category: f.category as FileCategory, title: f.title, siteId: f.site_id, docNo: f.doc_no ?? '',
                    docDate: f.doc_date ?? '', note: f.note ?? '', fileName: f.file_name,
                  }}
                  sites={sites ?? []}
                />
              </li>
            )
          })}
        </ul>
        {(page > 0 || hasMore) && (
          <div className="mt-3 flex items-center justify-between gap-2">
            {page > 0 ? <Link href={qs(page - 1)} className="btn-secondary"><ChevronLeft className="size-4" />ก่อนหน้า</Link> : <span />}
            <span className="text-sm text-muted-token">หน้า {page + 1}</span>
            {hasMore ? <Link href={qs(page + 1)} className="btn-secondary">ถัดไป<ChevronRight className="size-4" /></Link> : <span />}
          </div>
        )}
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="คลังเอกสาร"
        subtitle="สัญญาจ้าง · แบบก่อสร้าง · BOQ · หนังสือรับรองผลงาน — เก็บไว้ค้นหาย้อนหลัง"
        action={<UploadFilesButton sites={sites ?? []} defaultSiteId={site && site !== 'none' ? site : null} defaultCategory={cat} />}
      />
      <FileFilters
        sites={sites ?? []}
        years={Array.from({ length: 15 }, (_, i) => thisYear - i)}
        value={{ q: sp.q ?? '', cat: cat ?? '', site: site ?? '', year: year ? String(year) : '' }}
      />
      {body}
    </>
  )
}
