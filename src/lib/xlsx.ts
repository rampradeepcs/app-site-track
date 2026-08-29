/**
 * A minimal .xlsx writer — enough of SpreadsheetML to put a titled,
 * logo-bearing sheet on disk, and nothing more.
 *
 * The export used to be an HTML table stamped with Excel's ProgID. That
 * trick opens in Excel, but it is not a spreadsheet: it cannot carry an
 * embedded image, Numbers and Sheets treat it as a web page, and Android's
 * spreadsheet apps often refuse it outright. A real OOXML package fixes all
 * three, and the only hard part is the zip container, which is 60 lines.
 *
 * Entries are STORED, not deflated. The payload is already-compressed PNG
 * plus a few KB of XML, so compressing would buy nothing and cost a
 * dependency.
 */

import { markPngBytes, MARK_PNG_HEIGHT, MARK_PNG_WIDTH } from "./brand-mark-png";

export type Cell = string | number | null | undefined;

/* ---------------------------------------------------------------- zip -- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** Store-only zip. Returns the archive bytes. */
function zip(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const now = new Date();
  // MS-DOS packed date/time: seconds have 2-second resolution, hence >> 1.
  const time =
    (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date =
    ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);

    const local = new Uint8Array(30 + name.length + e.data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, e.data.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    local.set(e.data, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, e.data.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);

    offset += local.length;
  }

  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + cdSize + end.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const b of [...locals, ...centrals, end]) {
    out.set(b, p);
    p += b.length;
  }
  return out;
}

/* --------------------------------------------------------------- xml -- */

function xml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Control characters are illegal in XML 1.0 and will make Excel declare
    // the file unreadable, so they are dropped rather than escaped.
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** A1, B1 … Z1, AA1 … */
function ref(col: number, row: number): string {
  let s = "";
  for (let n = col; n >= 0; n = Math.floor(n / 26) - 1) {
    s = String.fromCharCode(65 + (n % 26)) + s;
  }
  return s + row;
}

/* Style indexes, matching the cellXfs order written in STYLES below. */
const S_TITLE = 1;
const S_META = 2;
const S_HEADER = 3;
const S_BODY = 4;

const STYLES = `${HEAD}
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4">
<font><sz val="11"/><color rgb="FF111827"/><name val="Calibri"/></font>
<font><b/><sz val="16"/><color rgb="FF111827"/><name val="Calibri"/></font>
<font><sz val="9"/><color rgb="FF6B7280"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF111827"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FFE5E7EB"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/* The logo occupies row 1. 1.5in wide at the mark's natural aspect. */
const LOGO_CX = 1371600;
const LOGO_CY = Math.round(LOGO_CX * (MARK_PNG_HEIGHT / MARK_PNG_WIDTH));

const DRAWING = `${HEAD}
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<xdr:oneCellAnchor>
<xdr:from><xdr:col>0</xdr:col><xdr:colOff>45720</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>45720</xdr:rowOff></xdr:from>
<xdr:ext cx="${LOGO_CX}" cy="${LOGO_CY}"/>
<xdr:pic>
<xdr:nvPicPr><xdr:cNvPr id="2" name="Workfence" descr="Workfence"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>
<xdr:blipFill><a:blip xmlns:r="${NS_REL}" r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>
<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${LOGO_CX}" cy="${LOGO_CY}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>
</xdr:pic>
<xdr:clientData/>
</xdr:oneCellAnchor>
</xdr:wsDr>`;

export interface SheetSpec {
  /** Tab name. Excel forbids []:*?/\ and caps it at 31 characters. */
  sheetName: string;
  /** Shown large under the logo. */
  title: string;
  /** One grey line under the title — scope, period, who generated it. */
  meta: string;
  headers: string[];
  rows: Cell[][];
}

function sheetXml({ title, meta, headers, rows }: SheetSpec): string {
  // Rows 1-4 are the letterhead: logo, title, meta, spacer.
  const HEADER_ROW = 5;
  const body: string[] = [];

  body.push(`<row r="1" ht="52" customHeight="1"/>`);
  body.push(
    `<row r="2" ht="21" customHeight="1"><c r="A2" s="${S_TITLE}" t="inlineStr"><is><t>${xml(title)}</t></is></c></row>`,
  );
  body.push(
    `<row r="3"><c r="A3" s="${S_META}" t="inlineStr"><is><t>${xml(meta)}</t></is></c></row>`,
  );
  body.push(`<row r="4"/>`);

  body.push(
    `<row r="${HEADER_ROW}" ht="22" customHeight="1">` +
      headers
        .map(
          (h, i) =>
            `<c r="${ref(i, HEADER_ROW)}" s="${S_HEADER}" t="inlineStr"><is><t>${xml(h)}</t></is></c>`,
        )
        .join("") +
      `</row>`,
  );

  rows.forEach((row, r) => {
    const n = HEADER_ROW + 1 + r;
    const cells = row
      .map((v, i) => {
        if (v == null || v === "") return "";
        const at = `r="${ref(i, n)}" s="${S_BODY}"`;
        return typeof v === "number" && Number.isFinite(v)
          ? `<c ${at}><v>${v}</v></c>`
          : `<c ${at} t="inlineStr"><is><t>${xml(String(v))}</t></is></c>`;
      })
      .join("");
    body.push(`<row r="${n}">${cells}</row>`);
  });

  // Width follows the widest value in the column, clamped so one long note
  // cannot push the rest of the table off the screen.
  const cols = headers
    .map((h, i) => {
      const longest = rows.reduce(
        (m, r) => Math.max(m, String(r[i] ?? "").length),
        h.length,
      );
      const w = Math.min(52, Math.max(10, longest + 3));
      return `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`;
    })
    .join("");

  const last = ref(Math.max(headers.length - 1, 0), HEADER_ROW + rows.length);
  return `${HEAD}
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS_REL}">
<dimension ref="A1:${last}"/>
<sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="${HEADER_ROW}" topLeftCell="A${HEADER_ROW + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData>${body.join("")}</sheetData>
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
<drawing r:id="rId1"/>
</worksheet>`;
}

/** Build a one-sheet workbook with the Workfence mark on the letterhead. */
export function buildXlsx(spec: SheetSpec): Uint8Array {
  const enc = new TextEncoder();
  const t = (s: string) => enc.encode(s);
  const name = xml(spec.sheetName.replace(/[[\]:*?/\\]/g, " ").slice(0, 31));

  return zip([
    {
      name: "[Content_Types].xml",
      data: t(`${HEAD}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
</Types>`),
    },
    {
      name: "_rels/.rels",
      data: t(`${HEAD}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    },
    {
      name: "xl/workbook.xml",
      data: t(`${HEAD}
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS_REL}">
<sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: t(`${HEAD}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="${NS_REL}/styles" Target="styles.xml"/>
</Relationships>`),
    },
    { name: "xl/styles.xml", data: t(STYLES) },
    { name: "xl/worksheets/sheet1.xml", data: t(sheetXml(spec)) },
    {
      name: "xl/worksheets/_rels/sheet1.xml.rels",
      data: t(`${HEAD}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${NS_REL}/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`),
    },
    { name: "xl/drawings/drawing1.xml", data: t(DRAWING) },
    {
      name: "xl/drawings/_rels/drawing1.xml.rels",
      data: t(`${HEAD}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${NS_REL}/image" Target="../media/image1.png"/>
</Relationships>`),
    },
    { name: "xl/media/image1.png", data: markPngBytes() },
  ]);
}
