import 'server-only'

import JSZip from 'jszip'
import { DOC_OPEN, RECEIPT_BOX } from '@/lib/letter-docx-xml'
import { bodyBlocks, letterDateLine, type LetterPaperData } from '@/lib/letters'

/**
 * ไฟล์ Word ของหนังสือบริษัท (R19) — ผังตามหนังสือจริงของห้าง (`reg002`)
 *
 * A4 · ขอบบน/ซ้าย/ขวา 1″ ล่าง 0.75″ · TH Sarabun New 16pt · บรรทัด 1.15 แบบ Word
 * · โลโก้ลอยมุมซ้ายบน · ชื่อห้าง 20pt หนา · ที่อยู่ 14pt กึ่งกลางพร้อมเส้นใต้
 * · เรื่อง/เรียน/อ้างถึง ชิด 0.5″ · สิ่งที่ส่งมาด้วย ชิด 1″ (บรรทัดที่ตัดขึ้นใหม่ชิดตามกัน)
 * · ย่อหน้าเยื้อง 0.5″ กระจายแบบไทย · ลายเซ็นกลางหน้า · กล่อง "รับเอกสารแล้ว"
 *
 * 🔴 ประกอบไฟล์เองจากชิ้นส่วน ไม่มีไฟล์ .docx ต้นแบบใน repo — ต้นแบบมีชื่อห้าง
 * ที่อยู่ และชื่อผู้ลงนามอยู่ข้างใน ซึ่งต้องมาจากฐานข้อมูลเท่านั้น (§5)
 */

export type DocxImage = { data: Buffer; width: number; height: number }
export type DocxPhoto = DocxImage & { caption: string }

const FONT = 'TH Sarabun New'
const EMU = 914400
/** ความกว้างพื้นที่พิมพ์ (twips) = A4 11906 − ขอบซ้ายขวา 1440×2 */
const TEXT_WIDTH = 9026
/** ช่องชื่อผู้ลงนามตอนยังไม่ได้ตั้งที่ `/settings/documents` */
const BLANK_SIGNER = '……………………………………'

const xesc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
    // อักขระควบคุมทำให้ Word ปฏิเสธทั้งไฟล์ว่า "ไฟล์เสีย"
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')

type RunOpt = { b?: boolean; sz?: number | null }

function rPr(o: RunOpt = {}) {
  const sz = o.sz === undefined ? 32 : o.sz
  return `<w:rPr><w:rFonts w:ascii="${FONT}" w:eastAsia="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/>` +
    (o.b ? '<w:b/><w:bCs/>' : '') +
    (sz ? `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>` : '') +
    '</w:rPr>'
}

/** ข้อความ → run · `\t` = แท็บ */
function runs(text: string, o: RunOpt = {}) {
  return text.split('\t').map((seg, i) =>
    (i ? `<w:r>${rPr(o)}<w:tab/></w:r>` : '') +
    (seg ? `<w:r>${rPr(o)}<w:t xml:space="preserve">${xesc(seg)}</w:t></w:r>` : ''),
  ).join('')
}

/** ย่อหน้า · `ppr` ต้องเรียงตามลำดับของ schema: keepNext → pBdr → spacing → ind → jc */
const para = (ppr: string, content = '', o: RunOpt = {}) =>
  `<w:p><w:pPr>${ppr}${rPr(o)}</w:pPr>${content}</w:p>`

const spacing = (after = 160, line = 278) =>
  `<w:spacing w:after="${after}" w:line="${line}" w:lineRule="auto"/>`

const KEEP = '<w:keepNext/>'
const THAI = '<w:jc w:val="thaiDistribute"/>'
const CENTER = '<w:jc w:val="center"/>'

/** ย่อรูปให้อยู่ในกรอบ (นิ้ว) โดยคงสัดส่วน → EMU */
function fit(img: { width: number; height: number }, maxWin: number, maxHin: number): [number, number] {
  const s = Math.min((maxWin * EMU) / img.width, (maxHin * EMU) / img.height)
  return [Math.round(img.width * s), Math.round(img.height * s)]
}

const graphic = (rid: string, cx: number, cy: number, id: number, name: string) =>
  `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`

/** รูปในบรรทัด (รูปแนบท้าย) */
const inlineImage = (rid: string, cx: number, cy: number, id: number) =>
  `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${id}" name="รูปแนบ ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>${graphic(rid, cx, cy, id, `photo${id}.jpeg`)}</wp:inline></w:drawing></w:r>`

/**
 * โลโก้ลอย ไม่ดันตัวหนังสือ — ตำแหน่งเดียวกับต้นฉบับ (เยื้องเข้าขอบซ้าย 0.32″ ·
 * สูงกว่าบรรทัดชื่อห้าง 0.49″) · กรอบ 1.26″ × 1.27″ ย่อรูปให้พอดีกรอบ
 */
function logoAnchor(cx: number, cy: number) {
  return `<w:r>${rPr({ sz: null })}<w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="251659264" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>-289231</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>-451839</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="1" name="โลโก้"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>${graphic('rIdLogo', cx, cy, 1, 'logo.png')}</wp:anchor></w:drawing></w:r>`
}

/** ชิ้นส่วนแพ็กเกจที่ไม่ขึ้นกับเนื้อหา */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${FONT}" w:eastAsia="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/><w:sz w:val="32"/><w:szCs w:val="32"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="th-TH"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="278" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style><w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:pPr><w:tabs><w:tab w:val="center" w:pos="4513"/><w:tab w:val="right" w:pos="9026"/></w:tabs><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style></w:styles>`

const SETTINGS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:applyBreakingRules/><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`

const SECTION = '<w:sectPr><w:pgSz w:w="11906" w:h="16838" w:code="9"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1080" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:space="708"/><w:docGrid w:linePitch="360"/></w:sectPr>'

function coreXml(title: string, author: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xesc(title)}</dc:title><dc:creator>${xesc(author)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`
}

export type LetterDocxInput = {
  letter: LetterPaperData
  logo: DocxImage | null
  photos: DocxPhoto[]
  photoTitle: string
  photoLayout: '1' | '2'
  /** 2 ฉบับ = "ต้นฉบับ" + "สำเนา" ต่อกันในไฟล์เดียว (ให้เจ้าหน้าที่เซ็นรับในสำเนาแล้วเก็บกลับมา) */
  copies?: 1 | 2
}

/**
 * ฉบับที่สอง = เนื้อเดียวกันทุกตัวอักษร · ขึ้นหน้าใหม่ด้วย `pageBreakBefore` ที่ย่อหน้าแรก (ไม่เพิ่มบรรทัดว่างหัวหน้า)
 * · id ของรูป/กล่องต้องไม่ซ้ำฉบับแรก ไม่งั้น Word ขึ้น "ไฟล์เสีย ต้องซ่อม"
 */
function asSecondCopy(xml: string) {
  return xml
    .replace('<w:pStyle w:val="Header"/>', '<w:pStyle w:val="Header"/><w:pageBreakBefore/>')
    .replace(/(<wp:docPr id=")(\d+)/g, (_, a: string, n: string) => `${a}${Number(n) + 1000}`)
    .replace(/(<pic:cNvPr id=")(\d+)/g, (_, a: string, n: string) => `${a}${Number(n) + 1000}`)
    .replace(/ wp14:anchorId="[^"]*" wp14:editId="[^"]*"/g, '')
    .replace(/ w14:anchorId="[^"]*"/g, '')
    .replace(/o:spid="_x0000_s(\d+)"/g, (_, n: string) => `o:spid="_x0000_s${Number(n) + 1000}"`)
}

/** run ของกล่องรับเอกสาร ย้ายจาก "ใต้ลายเซ็น" ไปชิดขอบล่างขวาของพื้นที่พิมพ์ (ทั้ง DrawingML และ VML สำรอง) */
const RECEIPT_RUN = (() => {
  const run = RECEIPT_BOX.slice(RECEIPT_BOX.indexOf('</w:pPr>') + '</w:pPr>'.length, RECEIPT_BOX.lastIndexOf('</w:p>'))
  const out = run
    .replace(/<wp:positionH relativeFrom="column"><wp:posOffset>\d+<\/wp:posOffset><\/wp:positionH>/, '<wp:positionH relativeFrom="margin"><wp:align>right</wp:align></wp:positionH>')
    .replace(/<wp:positionV relativeFrom="paragraph"><wp:posOffset>\d+<\/wp:posOffset><\/wp:positionV>/, '<wp:positionV relativeFrom="margin"><wp:align>bottom</wp:align></wp:positionV>')
    .replace('margin-left:364.2pt;margin-top:3.6pt;', '')
    .replace(
      'mso-position-horizontal:absolute;mso-position-horizontal-relative:text;mso-position-vertical:absolute;mso-position-vertical-relative:text;',
      'mso-position-horizontal:right;mso-position-horizontal-relative:margin;mso-position-vertical:bottom;mso-position-vertical-relative:margin;',
    )
  // แม่แบบ XML เปลี่ยนแล้วแทนที่ไม่ติด = กล่องกลับไปลอยใต้ลายเซ็นเงียบ ๆ — ให้พังตอน build/test แทน
  if (!out.includes('<wp:align>bottom</wp:align>') || !out.includes('mso-position-vertical:bottom')) throw new Error('RECEIPT_RUN')
  return out
})()

/** เนื้อ `word/document.xml` + ความสัมพันธ์ของรูป */
export function letterDocumentXml(input: LetterDocxInput) {
  if (input.copies !== 2) {
    const { body, rels } = letterBodyXml(input, null)
    return { xml: wrapDocument(body), rels }
  }
  // ต้นฉบับยื่นหน่วยงาน: ไม่มีป้าย ไม่มีกล่องรับเอกสาร · สำเนาคู่ฉบับ: ป้ายกลางบนสุด + กล่องให้เจ้าหน้าที่เซ็นรับ (เจ้าของสั่ง 22 ต.ค. 2569)
  const a = letterBodyXml({ ...input, letter: { ...input.letter, showReceipt: false } }, null)
  // รูปแนบไปกับต้นฉบับเท่านั้น — สำเนาคู่ฉบับเก็บกลับมาแค่หน้าที่เจ้าหน้าที่เซ็นรับ (เจ้าของสั่ง 23 ต.ค. 2569)
  const b = letterBodyXml({ ...input, photos: [] }, COPY_LABEL)
  return { xml: wrapDocument(a.body + asSecondCopy(b.body)), rels: a.rels }
}

export const COPY_LABEL = 'สำเนาคู่ฉบับ'

/**
 * ป้ายกลางหน้า บนสุดของกระดาษ — ย่อหน้าแบบกรอบ (`framePr`) วางตามพิกัดหน้ากระดาษ ไม่ดันบรรทัดอื่น
 * หนังสือจึงตัดหน้าเหมือนต้นฉบับทุกบรรทัด · y = 0.25″ จากขอบบน (เหนือหัวกระดาษ)
 */
const copyBanner = (label: string) =>
  para('<w:framePr w:w="9026" w:wrap="around" w:vAnchor="page" w:hAnchor="margin" w:xAlign="center" w:y="360"/>' + CENTER,
    runs(label, { b: true }), { b: true })

const wrapDocument = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${DOC_OPEN}${body}${SECTION}</w:body></w:document>`

function letterBodyXml({ letter, logo, photos, photoTitle, photoLayout }: LetterDocxInput, copyLabel: string | null) {
  const lh = letter.letterhead
  const x: string[] = []

  // ── หัวกระดาษ ───────────────────────────────────────────────────────
  const [lcx, lcy] = logo ? fit(logo, 1149144 / EMU, 1158843 / EMU) : [0, 0]
  x.push(para('<w:pStyle w:val="Header"/><w:ind w:firstLine="1440"/>',
    (logo ? logoAnchor(lcx, lcy) : '') + runs(lh.companyName, { b: true, sz: 40 }), { b: true, sz: 40 }))
  if (copyLabel) x.push(copyBanner(copyLabel))
  // ที่อยู่กึ่งกลางด้วยแท็บกลางของสไตล์ Header (4513 = กึ่งกลางพื้นที่พิมพ์) + เส้นใต้เต็มความกว้าง
  x.push(para('<w:pStyle w:val="Header"/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr>',
    runs(`\t${lh.address}`, { sz: 28 }), { sz: 28 }))
  x.push(para(spacing(), '', { b: true, sz: 30 }))

  // ── เลขที่ · วันที่ ──────────────────────────────────────────────────
  x.push(para(spacing(), runs(`เลขที่ ${letter.letterNo}`, { b: true }), { b: true }))
  x.push(para(spacing() + '<w:jc w:val="right"/>', runs(letterDateLine(letter.date), { b: true }), { b: true }))
  x.push(para(spacing(), '', { b: true }))

  // ── เรื่อง / เรียน / อ้างถึง / สิ่งที่ส่งมาด้วย ─────────────────────────
  // ระยะเยื้องแขวน = จุดที่ข้อความเริ่ม · บรรทัดที่ตัดขึ้นใหม่ชิดตามกัน ไม่ไหลกลับไปขอบซ้าย
  type Row = { label: string; text: string; b?: boolean; ind: number }
  const rows: Row[] = [
    { label: 'เรื่อง', text: letter.subject, b: true, ind: 720 },
    { label: 'เรียน', text: letter.recipient, b: true, ind: 720 },
    ...letter.refs.map((r, i) => ({ label: i ? '' : 'อ้างถึง', text: `${i + 1}. ${r}`, ind: 720 })),
    ...letter.attachments.map((a, i) => ({ label: i ? '' : 'สิ่งที่ส่งมาด้วย', text: `${i + 1}. ${a}`, ind: 1440 })),
  ]
  rows.forEach((r, i) => {
    const last = i === rows.length - 1
    x.push(para(spacing(last ? 160 : 0) + `<w:ind w:left="${r.ind}" w:hanging="${r.ind}"/>`,
      runs(`${r.label}\t${r.text}`, { b: r.b }), { b: r.b }))
  })

  // ── เนื้อความ ───────────────────────────────────────────────────────
  if (letter.intro) x.push(para(spacing() + '<w:ind w:firstLine="720"/>' + THAI, runs(letter.intro)))
  for (const b of bodyBlocks(letter.body)) {
    if (b.type === 'li') {
      x.push(para(spacing(b.last ? 160 : 0) + '<w:ind w:left="1080" w:hanging="360"/>' + THAI, runs(`${b.mark}\t${b.text}`)))
    } else {
      x.push(para(spacing() + '<w:ind w:firstLine="720"/>' + THAI, runs(b.text)))
    }
  }

  // ── ปิดท้าย + ลายเซ็น — keepNext ทั้งก้อน ลายเซ็นไม่แยกหน้ากับข้อความปิด ──
  const sig = '<w:ind w:left="360"/>' + CENTER
  x.push(para(KEEP + spacing(0, 276) + '<w:ind w:firstLine="720"/>', runs(letter.closing)))
  x.push(para(KEEP + spacing(0, 276)))
  x.push(para(KEEP + spacing(0, 276) + sig, runs('ขอแสดงความนับถือ')))
  for (let i = 0; i < 3; i++) x.push(para(KEEP + spacing(0, 276) + sig))
  x.push(para(KEEP + spacing(0, 276) + sig, runs(`(${lh.signerName || BLANK_SIGNER})`)))
  // กล่อง "รับเอกสารแล้ว" ลอยชิดมุมล่างขวาของหน้าที่ลงชื่อ — ผูกกับย่อหน้าตำแหน่งผู้ลงนาม
  // (ไม่ใช่ย่อหน้าของตัวเอง) หนังสือที่เต็มหน้าจึงไม่ถูกดันไปขึ้นหน้าใหม่เพราะกล่อง (เจ้าของแจ้ง 23 ต.ค. 2569)
  x.push(para(spacing(0, 276) + sig, runs(letter.signerTitle) + (letter.showReceipt ? RECEIPT_RUN : '')))

  // ── รูปแนบท้าย (หน้าใหม่) ────────────────────────────────────────────
  const rels: { rid: string; file: string; data: Buffer }[] = []
  if (photos.length) {
    x.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
    if (photoTitle.trim()) x.push(para(spacing() + CENTER, runs(photoTitle.trim(), { b: true }), { b: true }))
    photos.forEach((p, i) => rels.push({ rid: `rIdPhoto${i + 1}`, file: `photo${i + 1}.jpeg`, data: p.data }))

    if (photoLayout === '2') {
      const half = TEXT_WIDTH / 2
      const cell = (p: DocxPhoto | undefined, i: number) => {
        if (!p) return `<w:tc><w:tcPr><w:tcW w:w="${half}" w:type="dxa"/></w:tcPr>${para(spacing(0, 240))}</w:tc>`
        const [cx, cy] = fit(p, 2.95, 2.4)
        return `<w:tc><w:tcPr><w:tcW w:w="${half}" w:type="dxa"/></w:tcPr>` +
          para(spacing(0, 240) + CENTER, inlineImage(`rIdPhoto${i + 1}`, cx, cy, 100 + i)) +
          para(spacing(80, 240) + CENTER, runs(p.caption, { sz: 28 }), { sz: 28 }) + '</w:tc>'
      }
      const border = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
        .map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`).join('')
      let tbl = `<w:tbl><w:tblPr><w:tblW w:w="${TEXT_WIDTH}" w:type="dxa"/><w:jc w:val="center"/><w:tblBorders>${border}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="${half}"/><w:gridCol w:w="${half}"/></w:tblGrid>`
      for (let i = 0; i < photos.length; i += 2) {
        tbl += `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell(photos[i], i)}${cell(photos[i + 1], i + 1)}</w:tr>`
      }
      x.push(tbl + '</w:tbl>')
      // เอกสารต้องจบด้วยย่อหน้า ไม่ใช่ตาราง
      x.push(para(spacing(0, 240)))
    } else {
      const maxH = photos.length === 1 ? 7.8 : 3.75
      photos.forEach((p, i) => {
        const [cx, cy] = fit(p, 6.0, maxH)
        x.push(para(spacing(p.caption ? 40 : 200, 240) + CENTER, inlineImage(`rIdPhoto${i + 1}`, cx, cy, 100 + i)))
        if (p.caption) x.push(para(spacing(200, 240) + CENTER, runs(p.caption)))
      })
    }
  }

  return { body: x.join(''), rels }
}

export async function buildLetterDocx(input: LetterDocxInput): Promise<Buffer> {
  const { xml, rels } = letterDocumentXml(input)
  const docRels = [
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>',
    ...(input.logo ? ['<Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/>'] : []),
    ...rels.map((r) => `<Relationship Id="${r.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${r.file}"/>`),
  ].join('')

  const zip = new JSZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES)
  zip.file('_rels/.rels', ROOT_RELS)
  zip.file('docProps/core.xml', coreXml(input.letter.subject, input.letter.letterhead.companyName))
  zip.file('word/document.xml', xml)
  zip.file('word/styles.xml', STYLES)
  zip.file('word/settings.xml', SETTINGS)
  zip.file('word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${docRels}</Relationships>`)
  if (input.logo) zip.file('word/media/logo.png', input.logo.data)
  for (const r of rels) zip.file(`word/media/${r.file}`, r.data)

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
