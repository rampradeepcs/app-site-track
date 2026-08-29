/**
 * Report builders — the three ways work leaves this app.
 *
 * Every one of them is letterheaded: the print sheet draws the mark as
 * vector, the workbook embeds it as a real picture part, and CSV — a plain
 * text format that cannot hold artwork — carries the wordmark and the
 * generation stamp as a preamble above the header row. An exported file
 * ends up in a client's inbox, so it should say where it came from.
 */

import { BRAND_LINE, BRAND_NAME, markSVG } from "./brand";
import { fmtDateLong, fmtDistance, fmtDuration, fmtTime } from "./format";
import type { WorkforceState } from "./types";
import { buildXlsx, type Cell } from "./xlsx";

/** For report bodies built as HTML strings — descriptions are user text. */
export function htmlEscape(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function csvEscape(v: string | number | undefined | null): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(headers: string[], rows: Cell[][]): string {
  return [headers, ...rows]
    .map((r) => r.map(csvEscape).join(","))
    .join("\r\n");
}

/** "29 August 2026 16:04" — the same stamp on every format. */
export function generatedAt(): string {
  const now = Date.now();
  return `Generated ${fmtDateLong(now)} ${fmtTime(now)}`;
}

function save(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * The banner CSV gets instead of a logo. Kept to three lines and a blank so
 * a reader scrolling for the header row finds it immediately, and so
 * skipping it is a fixed offset for anyone parsing the file.
 */
function csvBanner(title?: string): string {
  const lines = [BRAND_NAME];
  if (title) lines.push(title);
  lines.push(generatedAt());
  return lines.map((l) => csvEscape(l)).join("\r\n") + "\r\n\r\n";
}

export function downloadCSV(filename: string, csv: string, title?: string) {
  // The BOM keeps Excel from mangling the names of people and places.
  save(filename, new Blob(["﻿" + csvBanner(title) + csv], {
    type: "text/csv;charset=utf-8",
  }));
}

/**
 * Excel export as a real OOXML workbook, letterheaded with the mark.
 *
 * This used to be an HTML table wearing Excel's ProgID. That opens, but it
 * cannot carry an image, and phones — where this app actually runs — often
 * decline to open it at all.
 */
export function downloadExcel(
  filename: string,
  sheetName: string,
  headers: string[],
  rows: Cell[][],
  meta?: string,
) {
  const name = filename.replace(/\.xlsx?$/i, "") + ".xlsx";
  const bytes = buildXlsx({
    sheetName,
    title: sheetName,
    meta: [meta, BRAND_LINE, generatedAt()].filter(Boolean).join(" · "),
    headers,
    rows,
  });
  save(name, new Blob([bytes as unknown as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }));
}

/** Open a print window with a styled report; user saves as PDF natively. */
export function printReport(title: string, bodyHtml: string, subtitle?: string) {
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>${title}</title><style>
    body{font-family:system-ui,-apple-system,sans-serif;color:#111827;margin:32px;}
    .letterhead{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;
      border-bottom:2px solid #111827;padding-bottom:14px;margin-bottom:22px;}
    .letterhead svg{display:block;flex:none;}
    .letterhead .who{text-align:right;font-size:11px;line-height:1.5;color:#6b7280;}
    h1{font-size:22px;margin:14px 0 2px;} .sub{color:#6b7280;font-size:13px;margin-bottom:24px;}
    table{border-collapse:collapse;width:100%;font-size:12.5px;}
    th{text-align:left;background:#f3f4f6;padding:8px 10px;border-bottom:2px solid #d1d5db;font-weight:600;}
    td{padding:7px 10px;border-bottom:1px solid #e5e7eb;}
    .kpis{display:flex;gap:14px;flex-wrap:wrap;margin:0 0 22px;}
    .kpi{border:1px solid #e5e7eb;border-radius:10px;padding:10px 16px;}
    .kpi b{display:block;font-size:20px;} .kpi span{font-size:11.5px;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;}
    .chip{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;background:#f3f4f6;}
    /* The mark repeats at the top of every printed page, so a report that
       is read as loose sheets still identifies itself. */
    @media print{
      body{margin:12mm;}
      thead{display:table-header-group;}
      tr{break-inside:avoid;}
    }
  </style></head><body>
    <div class="letterhead">
      ${markSVG(34)}
      <div class="who">${BRAND_LINE}<br />${generatedAt()}</div>
    </div>
    <h1>${title}</h1>
    <div class="sub">${subtitle ?? BRAND_LINE}</div>
    ${bodyHtml}
  </body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
}

/* ------------------------------------------------------------ builders -- */

export function attendanceCSV(s: WorkforceState, date?: string, projectId?: string): string {
  return toCSV(...attendanceTable(s, date, projectId));
}

/** Shared by the CSV and the workbook so the two never disagree. */
export function attendanceTable(
  s: WorkforceState,
  date?: string,
  projectId?: string,
): [string[], Cell[][]] {
  const rows: Cell[][] = s.attendance
    .filter((a) => (!date || a.date === date) && (!projectId || a.projectId === projectId))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((a) => {
      const u = s.users.find((x) => x.id === a.employeeId);
      const p = s.projects.find((x) => x.id === a.projectId);
      return [
        a.date,
        u?.name,
        u?.employeeCode,
        p?.name,
        a.checkIn ? fmtTime(a.checkIn.at) : "—",
        a.checkOut ? fmtTime(a.checkOut.at) : "—",
        a.workedMinutes != null ? fmtDuration(a.workedMinutes) : "—",
        fmtDistance(a.distanceMeters),
        a.status,
      ];
    });
  return [
    ["Date", "Employee", "Code", "Project", "Check-in", "Check-out", "Hours", "Distance", "Status"],
    rows,
  ];
}

export function movementCSV(s: WorkforceState, attendanceId: string): string {
  const rows = s.points
    .filter((p) => p.attendanceId === attendanceId)
    .sort((a, b) => a.at - b.at)
    .map((p) => [
      new Date(p.at).toISOString(),
      p.lat.toFixed(6),
      p.lng.toFixed(6),
      p.accuracy.toFixed(1),
      p.speed.toFixed(2),
      Math.round(p.heading),
    ]);
  return toCSV(["Timestamp", "Latitude", "Longitude", "Accuracy (m)", "Speed (m/s)", "Heading"], rows);
}
