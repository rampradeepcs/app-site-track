"use client";

/**
 * Governance — the product owner's compliance surface: org-wide tracking
 * policy, privacy & access rules, the full audit trail and data export.
 */

import { useMemo, useState } from "react";
import { ScreenHeader } from "@/components/shell";
import { ThemeControl } from "@/components/ThemeControl";
import { Field, KpiCard, SectionTitle } from "@/components/ui";
import { fmtDateLong, fmtTime, todayISO } from "@/lib/format";
import { downloadCSV, toCSV } from "@/lib/reports";
import { useWorkforce } from "@/lib/store";
import {
  IDownload,
  IFile,
  ILogout,
  IRefresh,
  IShield,
} from "@/components/WfIcons";
import { useRouter } from "next/navigation";

export default function AdminGovernance() {
  const { state, updateSettings, resetDemo, logout } = useWorkforce();
  const router = useRouter();
  const [auditFilter, setAuditFilter] = useState("");

  const audit = useMemo(
    () =>
      state.audit.filter((a) => {
        if (!auditFilter.trim()) return true;
        const actor = state.users.find((u) => u.id === a.actorId)?.name ?? a.actorId;
        return `${a.action} ${a.detail ?? ""} ${a.target} ${actor}`
          .toLowerCase()
          .includes(auditFilter.trim().toLowerCase());
      }),
    [state.audit, state.users, auditFilter],
  );

  const exportEverything = () => {
    const snapshot = {
      exportedAt: new Date().toISOString(),
      users: state.users,
      projects: state.projects,
      attendance: state.attendance,
      locationPoints: state.points.length,
      workUpdates: state.updates,
      audit: state.audit,
      settings: state.settings,
    };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workfence-export-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <ScreenHeader
        back="/admin"
        title="Governance"
        sub="Tracking policy · privacy · audit · data"
      />
      <div className="flex flex-col gap-4 px-4">
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          <KpiCard label="Location points" value={state.points.length.toLocaleString()} sub="stored on device" />
          <KpiCard label="Attendance records" value={state.attendance.length} sub={`retention ${state.settings.retentionDays}d`} />
          <KpiCard label="Audit entries" value={state.audit.length} tone="blue" sub="all actions" />
          <KpiCard label="Outbox" value={state.outbox.length} tone={state.outbox.length ? "amber" : "green"} sub="awaiting sync" />
        </div>

        {/* tracking policy */}
        <div className="wf-card flex flex-col gap-4 p-4">
          <SectionTitle>Organisation tracking policy</SectionTitle>
          <Field
            label={`GPS sampling — every ${state.settings.samplingSeconds}s`}
            hint="The battery ↔ route-detail dial. Applies to every employee device."
          >
            <input
              type="range"
              min={5}
              max={60}
              step={5}
              value={state.settings.samplingSeconds}
              onChange={(e) => updateSettings({ samplingSeconds: Number(e.target.value) })}
              className="w-full accent-[var(--wf-violet)]"
            />
          </Field>
          <Field label={`Accuracy floor — reject fixes worse than ±${state.settings.accuracyFloor}m`}>
            <input
              type="range"
              min={15}
              max={100}
              step={5}
              value={state.settings.accuracyFloor}
              onChange={(e) => updateSettings({ accuracyFloor: Number(e.target.value) })}
              className="w-full accent-[var(--wf-violet)]"
            />
          </Field>
          <Field
            label={`Data retention — ${state.settings.retentionDays} days`}
            hint="Location history older than this window is purged automatically."
          >
            <input
              type="range"
              min={30}
              max={365}
              step={30}
              value={state.settings.retentionDays}
              onChange={(e) => updateSettings({ retentionDays: Number(e.target.value) })}
              className="w-full accent-[var(--wf-violet)]"
            />
          </Field>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Appearance</p>
              <p className="mb-2 text-[0.72rem] text-[var(--wf-muted)]">
                Applies to the whole app, maps included
              </p>
              <ThemeControl />
            </div>
          </div>
        </div>

        {/* privacy & access */}
        <div className="wf-inset flex items-start gap-2.5 px-3.5 py-3 text-[0.78rem] leading-relaxed text-[var(--wf-muted)]">
          <IShield size={16} className="mt-0.5 shrink-0 text-[var(--wf-violet)]" />
          <span>
            <strong className="text-[var(--wf-fg)]">Access model.</strong>{" "}
            Employees see only their own records. Managers see the projects they
            run. The product owner sees everything and is the only role that can
            change roles. Location is captured strictly between check-in and
            checkout, and every geofence, assignment and role change lands in
            the audit trail below.
          </span>
        </div>

        {/* data export */}
        <div className="wf-card flex flex-wrap items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Organisation data</p>
            <p className="text-[0.76rem] text-[var(--wf-muted)]">
              Full JSON snapshot, or the audit trail as CSV.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={exportEverything}>
              <IFile size={14} /> Export JSON
            </button>
            <button
              className="wf-btn wf-btn-ghost wf-btn-sm"
              onClick={() =>
                downloadCSV(
                  `audit-${todayISO()}.csv`,
                  toCSV(
                    ["When", "Actor", "Action", "Target", "Detail"],
                    state.audit.map((a) => [
                      new Date(a.at).toISOString(),
                      state.users.find((u) => u.id === a.actorId)?.name ?? a.actorId,
                      a.action,
                      a.target,
                      a.detail ?? "",
                    ]),
                  ),
                )
              }
            >
              <IDownload size={14} /> Audit CSV
            </button>
          </div>
        </div>

        {/* audit trail */}
        <div className="wf-card p-4">
          <SectionTitle>Audit trail</SectionTitle>
          <input
            className="wf-input mb-3"
            aria-label="Filter the audit trail"
            placeholder="Filter by action, person or detail…"
            value={auditFilter}
            onChange={(e) => setAuditFilter(e.target.value)}
          />
          <div className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-1">
            {audit.length === 0 && (
              <p className="py-6 text-center text-sm text-[var(--wf-muted)]">No entries match.</p>
            )}
            {audit.slice(0, 60).map((a) => {
              const actor = state.users.find((u) => u.id === a.actorId);
              return (
                <div key={a.id} className="flex items-baseline gap-2 border-b border-[var(--wf-line)] pb-1.5 text-[0.76rem] last:border-0">
                  <span className="shrink-0 tabular-nums text-[var(--wf-faint)]">
                    {fmtDateLong(a.at)} {fmtTime(a.at)}
                  </span>
                  <span className="shrink-0 font-semibold text-[var(--wf-violet)]">{a.action}</span>
                  <span className="truncate text-[var(--wf-muted)]">
                    {actor?.name ?? a.actorId} — {a.detail ?? a.target}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex gap-2.5">
          <button className="wf-btn wf-btn-ghost flex-1" onClick={resetDemo}>
            <IRefresh size={15} /> Reset demo data
          </button>
          <button
            className="wf-btn wf-btn-ghost flex-1"
            onClick={() => {
              logout();
              router.replace("/");
            }}
          >
            <ILogout size={15} /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
