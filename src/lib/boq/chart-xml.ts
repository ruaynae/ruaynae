import JSZip from 'jszip'

/**
 * ใส่กราฟเส้นของ Excel จริง (ไม่ใช่รูป) ลงไฟล์ที่ exceljs เขียนแล้ว — exceljs สร้างกราฟไม่ได้
 * จึงต่อ XML ของ drawing + chart เข้า zip เอง · กราฟอ้างช่วงในชีต ตัวเลขเปลี่ยนแล้วเส้นเปลี่ยนตาม
 *
 * 🔴 ชีตเป้าหมายต้องยังไม่มี drawing (ไม่ใส่รูปด้วย exceljs ในชีตนั้น) — ไม่งั้นต้องรวมสอง drawing
 */

/** กราฟ XY: แกน X เป็นตัวเลข (สัปดาห์ที่ · ทศนิยมได้) ทุกเส้นวางจุดตามค่า x ของตัวเอง
 *  — เส้นผลงานจริงจึงวางจุดตรงวันส่งงวดได้ ไม่ต้องมีค่าทุกสัปดาห์เหมือนกราฟเส้นธรรมดา */
export type LineSeries = { name: string; x: string; y: string; color: string; dash?: boolean; marker?: boolean; width?: number }
export type BarSeries = { name: string; y: string; color: string }
type Base = {
  /** ลำดับชีตใน workbook นับจาก 1 */
  sheet: number
  title: string
  /** มุมบนซ้าย/ล่างขวา (คอลัมน์/แถวนับจาก 0) */
  from: { col: number; row: number }
  to: { col: number; row: number }
}
export type ChartSpec =
  | (Base & {
      kind: 'scatter'
      xTitle: string
      xMax: number
      series: LineSeries[]
      /**
       * วางทับตาราง: พื้นโปร่ง · ไม่มีหัว/คำอธิบาย/เส้นตาราง · ซ่อนแกน X · แกน % อยู่ขวา
       * `plotW` = สัดส่วนความกว้างของพื้นที่วาด (ที่เหลือทางขวาคือคอลัมน์ป้าย %) —
       * พื้นที่วาดต้องตรงกับขอบคอลัมน์สัปดาห์เป๊ะ จุดของสัปดาห์ที่ w จึงตกที่ขอบขวาของช่อง W
       */
      overlay?: { plotW: number }
    })
  /** กราฟแท่งแนวตั้ง — แกน X เป็นป้ายจากช่วง `cats` */
  | (Base & { kind: 'bar'; cats: string; series: BarSeries[] })

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const rich = (t: string, sz: number, bold: boolean) =>
  `<c:tx><c:rich><a:bodyPr/><a:p><a:pPr><a:defRPr sz="${sz}" b="${bold ? 1 : 0}"/></a:pPr><a:r><a:rPr lang="th-TH" sz="${sz}" b="${bold ? 1 : 0}"/><a:t>${esc(t)}</a:t></a:r></a:p></c:rich></c:tx>`

function barPlot(c: Extract<ChartSpec, { kind: 'bar' }>) {
  const ser = c.series
    .map((s, i) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${esc(s.name)}</c:v></c:tx>
<c:spPr><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>
<c:dLbls><c:numFmt formatCode="#,##0" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>
<c:cat><c:strRef><c:f>${esc(c.cats)}</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>${esc(s.y)}</c:f></c:numRef></c:val></c:ser>`)
    .join('')
  return `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${ser}<c:gapWidth val="80"/><c:axId val="5001"/><c:axId val="5002"/></c:barChart>
<c:catAx><c:axId val="5001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="5002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>
<c:valAx><c:axId val="5002"/><c:scaling><c:orientation val="minMax"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>
<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="D9DEE4"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>
<c:numFmt formatCode="#,##0" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="5001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`
}

const NO_FILL = '<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>'

function chartXml(c: ChartSpec) {
  const plot = c.kind === 'bar' ? barPlot(c) : scatterPlot(c)
  if (c.kind === 'scatter' && c.overlay) {
    const layout = `<c:layout><c:manualLayout><c:layoutTarget val="inner"/><c:xMode val="edge"/><c:yMode val="edge"/><c:x val="0"/><c:y val="0"/><c:w val="${c.overlay.plotW}"/><c:h val="1"/></c:manualLayout></c:layout>`
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<c:roundedCorners val="0"/>
<c:chart><c:autoTitleDeleted val="1"/>
<c:plotArea>${layout}${plot}${NO_FILL}</c:plotArea>
<c:plotVisOnly val="0"/><c:dispBlanksAs val="span"/></c:chart>${NO_FILL}
<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="800"><a:solidFill><a:srgbClr val="B42318"/></a:solidFill><a:latin typeface="Tahoma"/><a:cs typeface="Tahoma"/></a:defRPr></a:pPr><a:endParaRPr lang="th-TH"/></a:p></c:txPr>
</c:chartSpace>`
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<c:roundedCorners val="0"/>
<c:chart><c:title>${rich(c.title, 1400, true)}<c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>
<c:plotArea><c:layout/>${plot}</c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>
<c:plotVisOnly val="0"/><c:dispBlanksAs val="span"/></c:chart>
<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1000"><a:latin typeface="Tahoma"/><a:cs typeface="Tahoma"/></a:defRPr></a:pPr><a:endParaRPr lang="th-TH"/></a:p></c:txPr>
</c:chartSpace>`
}

function scatterPlot(c: Extract<ChartSpec, { kind: 'scatter' }>) {
  const ser = c.series
    .map((s, i) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${esc(s.name)}</c:v></c:tx>
<c:spPr><a:ln w="${s.width ?? (s.dash ? 22225 : 31750)}" cap="rnd"><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill>${s.dash ? '<a:prstDash val="dash"/>' : ''}<a:round/></a:ln></c:spPr>
${s.marker === false ? '<c:marker><c:symbol val="none"/></c:marker>' : `<c:marker><c:symbol val="circle"/><c:size val="4"/><c:spPr><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr></c:marker>`}
<c:xVal><c:numRef><c:f>${esc(s.x)}</c:f></c:numRef></c:xVal><c:yVal><c:numRef><c:f>${esc(s.y)}</c:f></c:numRef></c:yVal><c:smooth val="0"/></c:ser>`)
    .join('')
  const chart = `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${ser}<c:axId val="5001"/><c:axId val="5002"/></c:scatterChart>`
  if (c.overlay) {
    // แกน X ซ่อน (สัปดาห์มีหัวตารางอยู่แล้ว) · แกน Y ตัดแกน X ที่ค่าสูงสุด = อยู่ขอบขวา ป้ายตกในคอลัมน์ %
    return `${chart}
<c:valAx><c:axId val="5001"/><c:scaling><c:orientation val="minMax"/><c:max val="${c.xMax}"/><c:min val="0"/></c:scaling><c:delete val="1"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="none"/><c:crossAx val="5002"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>
<c:valAx><c:axId val="5002"/><c:scaling><c:orientation val="minMax"/><c:max val="1"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="r"/><c:numFmt formatCode="0%" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>
<c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="B42318"/></a:solidFill></a:ln></c:spPr><c:crossAx val="5001"/><c:crosses val="max"/><c:crossBetween val="midCat"/><c:majorUnit val="0.1"/></c:valAx>
`
  }
  return `${chart}
<c:valAx><c:axId val="5001"/><c:scaling><c:orientation val="minMax"/><c:max val="${c.xMax}"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>
<c:title>${rich(c.xTitle, 900, false)}<c:overlay val="0"/></c:title>
<c:numFmt formatCode="&quot;W&quot;0" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="5002"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/><c:majorUnit val="${c.xMax > 30 ? 4 : 2}"/></c:valAx>
<c:valAx><c:axId val="5002"/><c:scaling><c:orientation val="minMax"/><c:max val="1"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>
<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="D9DEE4"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>
<c:numFmt formatCode="0%" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="5001"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/><c:majorUnit val="0.25"/></c:valAx>
`
}

function drawingXml(c: ChartSpec, rid: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<xdr:twoCellAnchor editAs="twoCell"><xdr:from><xdr:col>${c.from.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${c.from.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
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
