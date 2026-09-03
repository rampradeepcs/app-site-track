"use client";

/**
 * The work-update feed — its own screen, and the place the site's written
 * record leaves the app.
 *
 * Export is the reason the filters exist. "Send me the safety updates for
 * Metro Line 3 last week" is the actual request a manager gets, and an
 * export button over an unfiltered feed answers it with three hundred rows
 * the client has to sift. So the strip above the feed narrows it, and every
 * format exports exactly what is on screen — the count on the button says
 * so, out loud, before anything downloads.
 *
 * The three formats are not the same report. CSV and the workbook carry the
 * full record, including the structured end-of-day fields, because they are
 * going into someone's spreadsheet. The PDF is written to be read: the
 * narrative fields appear as prose, and only when the author filled them in.
 */

import { useMemo, useState } from "react";
import { ScreenHeader } from "@/components/shell";
import { UpgradeNotice, useFeature } from "@/components/FeatureGate";
import { StatusPills, countByStatus } from "@/components/StatusPills";
import { Avatar, BottomSheet, Chip, Segmented, useNowTick } from "@/components/ui";
import { fmtDateLong, fmtTime, todayISO } from "@/lib/format";
import {
  downloadCSV,
  downloadExcel,
  generatedAt,
  htmlEscape,
  printReport,
  toCSV,
} from "@/lib/reports";
import { useWorkforce } from "@/lib/store";
import { showToast } from "@/lib/toast";
import type { WorkUpdate } from "@/lib/types";
import { IDownload, IFile, IMapPin, IShare } from "@/components/WfIcons";

type Period = "today" | "7" | "30" | "all";

const PERIOD_LABEL: Record<Period, string> = {
  today: "Today",
  "7": "Last 7 days",
  "30": "Last 30 days",
  all: "All time",
};

/** The structured fields a daily summary carries, in the order they're asked for. */
const DAILY_FIELDS: Array<[keyof WorkUpdate, string]> = [
  ["completed", "Completed"],
  ["inProgress", "In progress"],
  ["blockers", "Blockers"],
  ["materials", "Materials"],
  ["safety", "Safety"],
  ["tomorrow", "Tomorrow"],
];

export default function ManagerUpdates() {
  const { state } = useWorkforce();
  const now = useNowTick(60);
  const canExport = useFeature("dataExport");

  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState<Period>("30");
  const [projectId, setProjectId] = useState("all");
  const [category, setCategory] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);

  const nameOf = useMemo(
    () => new Map(state.users.map((u) => [u.id, u])),
    [state.users],
  );
  const projectOf = useMemo(
    () => new Map(state.projects.map((p) => [p.id, p])),
    [state.projects],
  );

  /* Everything except the category filter. The pill counts are taken over
     this set, so picking one pill doesn't zero the others. */
  const scoped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const cutoff =
      period === "all"
        ? 0
        : period === "today"
          ? 0
          : now - Number(period) * 86_400_000;
    return state.updates
      .filter((u) => {
        if (period === "today" && u.date !== todayISO(now)) return false;
        if (period !== "today" && u.at < cutoff) return false;
        if (projectId !== "all" && u.projectId !== projectId) return false;
        if (!q) return true;
        const emp = nameOf.get(u.employeeId);
        const proj = projectOf.get(u.projectId);
        return `${emp?.name ?? ""} ${emp?.employeeCode ?? ""} ${proj?.name ?? ""} ${u.place ?? ""} ${u.category} ${u.description}`
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => b.at - a.at);
  }, [state.updates, period, projectId, query, now, nameOf, projectOf]);

  const counts = useMemo(
    () => countByStatus(scoped, (u) => u.category),
    [scoped],
  );

  const rows = useMemo(
    () => (category ? scoped.filter((u) => u.category === category) : scoped),
    [scoped, category],
  );

  /* One description of the selection, reused as the file name, the sheet
     subtitle and the line under the export button. */
  const scopeLabel = [
    PERIOD_LABEL[period],
    projectId === "all" ? "All projects" : projectOf.get(projectId)?.name,
    category ?? undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  const stamp = period === "all" ? todayISO(now) : `${period}-${todayISO(now)}`;

  const table = useMemo((): [string[], (string | number)[][]] => {
    const headers = [
      "Date",
      "Time",
      "Employee",
      "Code",
      "Trade",
      "Project",
      "Zone",
      "Type",
      "Category",
      "Update",
      ...DAILY_FIELDS.map(([, label]) => label),
      "Photos",
      "Voice note (s)",
      "Sync",
    ];
    const body = rows.map((u) => {
      const emp = nameOf.get(u.employeeId);
      return [
        u.date,
        fmtTime(u.at),
        emp?.name ?? "—",
        emp?.employeeCode ?? "—",
        emp?.designation ?? "—",
        projectOf.get(u.projectId)?.name ?? "—",
        u.place ?? "—",
        u.kind === "daily" ? "Daily summary" : "Shift update",
        u.category,
        u.description,
        ...DAILY_FIELDS.map(([key]) => (u[key] as string | undefined) ?? ""),
        u.photos.length,
        u.voiceNoteSeconds ?? 0,
        u.status,
      ];
    });
    return [headers, body];
  }, [rows, nameOf, projectOf]);

  const done = (what: string) => {
    setSheet(false);
    showToast(`${what} exported — ${rows.length} updates`);
  };

  const exportCSV = () => {
    downloadCSV(
      `work-updates-${stamp}.csv`,
      toCSV(table[0], table[1]),
      `Work updates — ${scopeLabel}`,
    );
    done("CSV");
  };

  const exportExcel = () => {
    downloadExcel(
      `work-updates-${stamp}.xlsx`,
      "Work updates",
      table[0],
      table[1],
      scopeLabel,
    );
    done("Excel");
  };

  const exportPDF = () => {
    const people = new Set(rows.map((u) => u.employeeId)).size;
    const blockers = rows.filter((u) => u.blockers?.trim()).length;
    const photos = rows.reduce((n, u) => n + u.photos.length, 0);

    /* Grouped by day, because that is how a site diary is read. */
    const byDate = new Map<string, WorkUpdate[]>();
    for (const u of rows) {
      const list = byDate.get(u.date);
      if (list) list.push(u);
      else byDate.set(u.date, [u]);
    }

    const sections = [...byDate.entries()]
      .map(([date, list]) => {
        const body = list
          .map((u) => {
            const emp = nameOf.get(u.employeeId);
            const detail = DAILY_FIELDS.map(([key, label]) => {
              const v = (u[key] as string | undefined)?.trim();
              return v
                ? `<div class="fld"><b>${label}:</b> ${htmlEscape(v)}</div>`
                : "";
            }).join("");
            return `<tr>
              <td class="when">${htmlEscape(fmtTime(u.at))}</td>
              <td>
                <div class="who">${htmlEscape(emp?.name ?? "—")}</div>
                <div class="meta">${htmlEscape(emp?.employeeCode ?? "")}${
                  emp?.designation ? " · " + htmlEscape(emp.designation) : ""
                }</div>
              </td>
              <td>
                <div>${htmlEscape(projectOf.get(u.projectId)?.name ?? "—")}</div>
                <div class="meta">${htmlEscape(u.place ?? "")}</div>
              </td>
              <td><span class="chip">${htmlEscape(u.category)}</span>${
                u.kind === "daily" ? ' <span class="chip">Daily</span>' : ""
              }</td>
              <td>${htmlEscape(u.description)}${detail}${
                u.photos.length
                  ? `<div class="meta">${u.photos.length} photo${u.photos.length > 1 ? "s" : ""} attached</div>`
                  : ""
              }</td>
            </tr>`;
          })
          .join("");
        return `<h2>${htmlEscape(fmtDateLong(date))} <span>${list.length} update${
          list.length > 1 ? "s" : ""
        }</span></h2>
        <table><thead><tr><th>Time</th><th>Employee</th><th>Project</th><th>Category</th><th>Update</th></tr></thead>
        <tbody>${body}</tbody></table>`;
      })
      .join("");

    printReport(
      "Work updates",
      `<style>
        h2{font-size:14px;margin:26px 0 8px;padding-bottom:5px;border-bottom:1px solid #e5e7eb;}
        h2 span{float:right;font-weight:400;color:#6b7280;font-size:12px;}
        td.when{white-space:nowrap;color:#6b7280;font-variant-numeric:tabular-nums;}
        .who{font-weight:600;} .meta{color:#6b7280;font-size:11px;margin-top:2px;}
        .fld{margin-top:4px;font-size:11.5px;} .fld b{color:#374151;}
        table{margin-bottom:4px;}
      </style>
      <div class="kpis">
        <div class="kpi"><b>${rows.length}</b><span>Updates</span></div>
        <div class="kpi"><b>${people}</b><span>People</span></div>
        <div class="kpi"><b>${byDate.size}</b><span>Days</span></div>
        <div class="kpi"><b>${blockers}</b><span>With blockers</span></div>
        <div class="kpi"><b>${photos}</b><span>Photos</span></div>
      </div>
      ${sections || '<p style="color:#6b7280">No updates match this selection.</p>'}`,
      scopeLabel,
    );
    done("PDF");
  };

  return (
    <div>
      <ScreenHeader
        back
        title="Work updates"
        sub={`${state.updates.length} from the site`}
        action={
          <button
            className="wf-btn wf-btn-primary wf-btn-sm"
            onClick={() => setSheet(true)}
            disabled={!canExport || rows.length === 0}
            title={canExport ? undefined : "Export isn't available on your plan"}
          >
            <IShare size={15} /> Export
          </button>
        }
      />

      <div className="flex flex-col gap-3 px-4">
        {!canExport && (
          <UpgradeNotice
            title="Export isn't available on your current plan."
            body="Updates stay readable in-app. Ask your administrator to upgrade to download CSV, Excel or PDF copies."
            compact
          />
        )}

        <input
          className="wf-input wf-input-search"
          aria-label="Search work updates"
          placeholder="Search person, project, zone or text…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <Segmented
          ariaLabel="Period"
          value={period}
          onChange={setPeriod}
          size="sm"
          options={[
            { value: "today", label: "Today" },
            { value: "7", label: "7 days" },
            { value: "30", label: "30 days" },
            { value: "all", label: "All" },
          ]}
        />

        {state.projects.length > 1 && (
          <select
            className="wf-input"
            aria-label="Filter by project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="all">All projects</option>
            {state.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}

        <StatusPills
          counts={counts}
          value={category}
          onChange={setCategory}
          emptyLabel="No updates in this period."
        />

        <div className="flex flex-col gap-2.5">
          {rows.length === 0 && (
            <p className="wf-card2 px-4 py-8 text-center text-sm text-[var(--wf-muted)]">
              No updates match.
            </p>
          )}
          {rows.slice(0, 60).map((u) => {
            const emp = nameOf.get(u.employeeId);
            const proj = projectOf.get(u.projectId);
            return (
              <article key={u.id} className="wf-card2 p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Avatar name={emp?.name ?? "?"} hue={emp?.avatarHue ?? 0} photo={emp?.photo} size={26} />
                  <span className="text-[0.82rem] font-semibold">{emp?.name}</span>
                  <Chip tone={u.kind === "daily" ? "blue" : "neutral"}>
                    {u.kind === "daily" ? "Daily" : u.category}
                  </Chip>
                  <span className="ml-auto text-[0.66rem] tabular-nums text-[var(--wf-faint)]">
                    {fmtDateLong(u.date)} · {fmtTime(u.at)}
                  </span>
                </div>
                <p className="mt-1.5 text-[0.84rem] leading-relaxed text-[var(--wf-muted)]">
                  {u.description}
                </p>
                <p className="mt-1 flex items-center gap-2 text-[0.66rem] text-[var(--wf-faint)]">
                  {proj?.name}
                  {u.place ? (
                    <span className="flex items-center gap-1">
                      · <IMapPin size={10} /> {u.place}
                    </span>
                  ) : null}
                </p>
              </article>
            );
          })}
          {rows.length > 60 && (
            <p className="px-1 py-2 text-center text-[0.72rem] text-[var(--wf-faint)]">
              Showing the 60 most recent. Export includes all {rows.length}.
            </p>
          )}
        </div>
      </div>

      <BottomSheet open={sheet} onClose={() => setSheet(false)} title="Export work updates">
        <div className="flex flex-col gap-3">
          <div className="wf-card2 px-4 py-3">
            <p className="text-[0.92rem] font-semibold">
              {rows.length} update{rows.length === 1 ? "" : "s"}
            </p>
            <p className="mt-0.5 text-[0.74rem] text-[var(--wf-muted)]">{scopeLabel}</p>
            <p className="mt-1.5 text-[0.68rem] text-[var(--wf-faint)]">{generatedAt()}</p>
          </div>

          <ExportOption
            icon={<IFile size={16} />}
            title="PDF"
            body="A day-by-day site diary, formatted to read on paper. Opens your print dialog."
            onClick={exportPDF}
          />
          <ExportOption
            icon={<IDownload size={16} />}
            title="Excel workbook"
            body="Every field, including the end-of-day summaries. Letterheaded."
            onClick={exportExcel}
          />
          <ExportOption
            icon={<IDownload size={16} />}
            title="CSV"
            body="The same columns as plain text, for importing elsewhere."
            onClick={exportCSV}
          />

          <p className="text-center text-[0.7rem] leading-relaxed text-[var(--wf-faint)]">
            Every file carries the Workfence mark and the time it was generated.
          </p>
        </div>
      </BottomSheet>
    </div>
  );
}

function ExportOption({
  icon,
  title,
  body,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      className="wf-card2 flex w-full cursor-pointer items-center gap-3 px-3.5 py-3 text-left hover:border-[var(--wf-line-strong)]"
      onClick={onClick}
    >
      <span className="shrink-0 text-[var(--wf-muted)]">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.88rem] font-semibold">{title}</span>
        <span className="block text-[0.72rem] leading-relaxed text-[var(--wf-muted)]">
          {body}
        </span>
      </span>
    </button>
  );
}
