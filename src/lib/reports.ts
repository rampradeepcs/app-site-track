/**
 * Report builders — CSV downloads and a print-friendly window for "PDF"
 * export (the browser's print-to-PDF is the portable, dependency-free path).
 */

import { fmtDateLong, fmtDistance, fmtDuration, fmtTime } from "./format";
import type { WorkforceState } from "./types";

function csvEscape(v: string | number | undefined | null): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(headers: string[], rows: Array<Array<string | number | undefined>>): string {
  return [headers, ...rows]
    .map((r) => r.map(csvEscape).join(","))
    .join("\r\n");
}

export function downloadCSV(filename: string, csv: string) {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function attendanceCSV(s: WorkforceState, date?: string, projectId?: string): string {
  const rows = s.attendance
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
  return toCSV(
    ["Date", "Employee", "Code", "Project", "Check-in", "Check-out", "Hours", "Distance", "Status"],
    rows,
  );
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

/** Open a print window with a styled report; user saves as PDF natively. */
export function printReport(title: string, bodyHtml: string) {
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>${title}</title><style>
    body{font-family:system-ui,-apple-system,sans-serif;color:#111827;margin:32px;}
    h1{font-size:22px;margin:0 0 2px;} .sub{color:#6b7280;font-size:13px;margin-bottom:24px;}
    table{border-collapse:collapse;width:100%;font-size:12.5px;}
    th{text-align:left;background:#f3f4f6;padding:8px 10px;border-bottom:2px solid #d1d5db;font-weight:600;}
    td{padding:7px 10px;border-bottom:1px solid #e5e7eb;}
    .kpis{display:flex;gap:14px;flex-wrap:wrap;margin:0 0 22px;}
    .kpi{border:1px solid #e5e7eb;border-radius:10px;padding:10px 16px;}
    .kpi b{display:block;font-size:20px;} .kpi span{font-size:11.5px;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;}
    .chip{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;background:#f3f4f6;}
    @media print{body{margin:12mm;}}
  </style></head><body>
    <h1>${title}</h1>
    <div class="sub">SiteTrack · Nachi Tekneka · Generated ${fmtDateLong(Date.now())} ${fmtTime(Date.now())}</div>
    ${bodyHtml}
  </body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
}
