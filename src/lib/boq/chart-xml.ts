import JSZip from 'jszip'

/**
 * ใส่กราฟเส้นของ Excel จริง (ไม่ใช่รูป) ลงไฟล์ที่ exceljs เขียนแล้ว — exceljs สร้างกราฟไม่ได้
 * จึงต่อ XML ของ drawing + chart เข้า zip เอง · กราฟอ้างช่วงในชีต ตัวเลขเปลี่ยนแล้วเส้นเปลี่ยนตาม
 *
 * 🔴 ชีตเป้าหมายต้องยังไม่มี drawing (ไม่ใส่รูปด้วย exceljs ในชีตนั้น) — ไม่งั้นต้องรวมสอง drawing
 */

export type LineSeries = { name: string; ref: string; color: string; dash?: boolean }
export type ChartSpec = {
  /** ลำดับชีตใน workbook นับจาก 1 */
  sheet: number
  title: string
  /** ช่วงป้ายแกน X เช่น `'แผน'!$G$8:$AF$8` */
  cats: string
  series: LineSeries[]
  /** มุมบนซ้าย/ล่างขวา (คอลัมน์/แถวนับจาก 0) */
  from: { col: number; row: number }
  to: { col: number; row: number }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const rich = (t: string, sz: number, bold: boolean) =>
  `<c:tx><c:rich><a:bodyPr/><a:p><a:pPr><a:defRPr sz="${sz}" b="${bold ? 1 : 0}"/></a:pPr><a:r><a:rPr lang="th-TH" sz="${sz}" b="${bold ? 1 : 0}"/><a:t>${esc(t)}</a:t></a:r></a:p></c:rich></c:tx>`

function chartXml(c: ChartSpec) {
  const ser = c.series
    .map((s, i) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${esc(s.name)}</c:v></c:tx>
<c:spPr><a:ln w="${s.dash ? 22225 : 31750}" cap="rnd"><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill>${s.dash ? '<a:prstDash val="dash"/>' : ''}<a:round/></a:ln></c:spPr>
<c:marker><c:symbol val="circle"/><c:size val="4"/><c:spPr><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr></c:marker>
<c:cat><c:strRef><c:f>${esc(c.cats)}</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>${esc(s.ref)}</c:f></c:numRef></c:val><c:smooth val="0"/></c:ser>`)
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<c:roundedCorners val="0"/>
<c:chart><c:title>${rich(c.title, 1400, true)}<c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>
<c:plotArea><c:layout/>
<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${ser}<c:marker val="1"/><c:axId val="5001"/><c:axId val="5002"/></c:lineChart>
<c:catAx><c:axId val="5001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="5002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>
<c:valAx><c:axId val="5002"/><c:scaling><c:orientation val="minMax"/><c:max val="1"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>
<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="D9DEE4"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>
<c:numFmt formatCode="0%" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="5001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/><c:majorUnit val="0.25"/></c:valAx>
</c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>
<c:plotVisOnly val="0"/><c:dispBlanksAs val="gap"/></c:chart>
<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1000"><a:latin typeface="Tahoma"/><a:cs typeface="Tahoma"/></a:defRPr></a:pPr><a:endParaRPr lang="th-TH"/></a:p></c:txPr>
</c:chartSpace>`
}

function drawingXml(c: ChartSpec, rid: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${c.from.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${c.from.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
<xdr:to><xdr:col>${c.to.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${c.to.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="S-Curve"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${rid}"/></a:graphicData></a:graphic>
</xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`
}

const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const T_DRAWING = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing'
const T_CHART = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart'

export async function addLineCharts(buf: ArrayBuffer, charts: ChartSpec[]): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(buf)
  let types = await zip.file('[Content_Types].xml')!.async('string')
  charts.forEach((c, i) => {
    const n = i + 1
    zip.file(`xl/charts/chart${n}.xml`, chartXml(c))
    zip.file(`xl/drawings/drawing${n}.xml`, drawingXml(c, 'rId1'))
    zip.file(`xl/drawings/_rels/drawing${n}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${T_CHART}" Target="../charts/chart${n}.xml"/></Relationships>`)
    types = types.replace('</Types>',
      `<Override PartName="/xl/drawings/drawing${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>` +
      `<Override PartName="/xl/charts/chart${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`)
  })
  zip.file('[Content_Types].xml', types)

  for (const [i, c] of charts.entries()) {
    const sheetPath = `xl/worksheets/sheet${c.sheet}.xml`
    const relsPath = `xl/worksheets/_rels/sheet${c.sheet}.xml.rels`
    const rid = `rIdChart${i + 1}`
    const relsFile = zip.file(relsPath)
    const rel = `<Relationship Id="${rid}" Type="${T_DRAWING}" Target="../drawings/drawing${i + 1}.xml"/>`
    zip.file(relsPath, relsFile
      ? (await relsFile.async('string')).replace('</Relationships>', `${rel}</Relationships>`)
      : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}">${rel}</Relationships>`)
    let xml = await zip.file(sheetPath)!.async('string')
    if (!xml.includes('xmlns:r=')) xml = xml.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ')
    // ลำดับใน schema: <drawing> ต้องมาก่อน legacyDrawing / tableParts / extLst
    const tag = `<drawing r:id="${rid}"/>`
    const at = ['<legacyDrawing', '<legacyDrawingHF', '<picture', '<oleObjects', '<controls', '<webPublishItems', '<tableParts', '<extLst', '</worksheet>']
      .map((t) => xml.indexOf(t)).filter((x) => x >= 0).sort((a, b) => a - b)[0]
    xml = xml.slice(0, at) + tag + xml.slice(at)
    zip.file(sheetPath, xml)
  }
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
}
