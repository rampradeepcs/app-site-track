"use client";

/**
 * Performance — its own screen.
 *
 * Ranking a workforce is a thing you sit down with, not a segment you
 * land on because it happened to be the tab next to Reports.
 */

import Link from "next/link";
import { useMemo } from "react";
import { FeatureGate } from "@/components/FeatureGate";
import { ScreenHeader } from "@/components/shell";
import { Avatar, SectionTitle, useNowTick } from "@/components/ui";
import { ScoreBars } from "@/components/charts";
import { fmtDuration, pct } from "@/lib/format";
import { needsAttention, performanceFor } from "@/lib/metrics";
import { useWorkforce } from "@/lib/store";
import { IArrowR } from "@/components/WfIcons";

export default function ManagerPerformance() {
  const { state } = useWorkforce();
  const now = useNowTick(30);

  const employees = useMemo(
    () => state.users.filter((u) => u.role === "employee" && u.status === "active"),
    [state.users],
  );
  const perfs = useMemo(
    () =>
      employees
        .map((u) => ({ user: u, perf: performanceFor(state, u, 14, now) }))
        .sort((a, b) => b.perf.overall - a.perf.overall),
    [employees, state, now],
  );
  const attention = useMemo(() => needsAttention(state, now), [state, now]);

  return (
    <div>
      <ScreenHeader back title="Performance" sub="Last 14 days, ranked" />
      <div className="flex flex-col gap-3 px-4">
          <FeatureGate feature="performance">
            {attention.length > 0 && (
              <div className="wf-card border-[var(--wf-amber-edge)] p-4">
                <SectionTitle>Needs attention</SectionTitle>
                <div className="flex flex-col gap-2">
                  {attention.map((a) => (
                    <Link
                      key={a.user.id}
                      href={`/manager/employee?id=${a.user.id}`}
                      className="flex items-center gap-3 rounded-lg px-1 py-1 transition hover:bg-[var(--wf-surface2)]"
                    >
                      <Avatar name={a.user.name} hue={a.user.avatarHue} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.84rem] font-semibold">{a.user.name}</span>
                        <span className="block truncate text-[0.68rem] text-[var(--wf-amber)]">
                          {a.reasons.join(" · ")}
                        </span>
                      </span>
                      <span className="text-[0.8rem] font-bold tabular-nums">{Math.round(a.score)}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-col gap-2">
              {perfs.map(({ user, perf }, i) => (
                <Link
                  key={user.id}
                  href={`/manager/employee?id=${user.id}`}
                  className="wf-card2 flex items-center gap-3 px-3.5 py-3 transition hover:border-[var(--wf-line-strong)]"
                >
                  <span className="w-5 text-center text-[0.78rem] font-bold tabular-nums text-[var(--wf-faint)]">
                    {i + 1}
                  </span>
                  <Avatar name={user.name} hue={user.avatarHue} size={38} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.86rem] font-semibold">{user.name}</span>
                    <span className="block text-[0.68rem] text-[var(--wf-muted)]">
                      {pct(perf.attendancePct)} att · {perf.lateCount} late · {perf.updateCount} updates ·
                      avg {fmtDuration(perf.avgWorkedMinutes)}
                    </span>
                  </span>
                  <span
                    className="wf-display text-lg tabular-nums"
                    style={{
                      color:
                        perf.overall >= 75
                          ? "var(--wf-green)"
                          : perf.overall >= 55
                            ? "var(--wf-amber)"
                            : "var(--wf-red)",
                    }}
                  >
                    {Math.round(perf.overall)}
                  </span>
                </Link>
              ))}
            </div>
            <div className="wf-card p-4">
              <SectionTitle>Scoring model (transparent)</SectionTitle>
              <ScoreBars
                rows={[
                  { label: "Attendance", value: 30, weight: "weight", color: "var(--wf-green)" },
                  { label: "Punctuality", value: 20, weight: "weight", color: "var(--wf-amber)" },
                  { label: "Work updates", value: 20, weight: "weight", color: "var(--wf-violet)" },
                  { label: "Working hours", value: 15, weight: "weight", color: "var(--wf-blue)" },
                  { label: "Supervisor rating", value: 15, weight: "weight", color: "var(--wf-orange)" },
                ]}
              />
              <p className="mt-3 border-t border-[var(--wf-line)] pt-2.5 text-[0.72rem] leading-snug text-[var(--wf-faint)]">
                GPS distance travelled is deliberately excluded — movement data is
                an operational presence signal, not a productivity measure.
              </p>
            </div>
          </FeatureGate>
      </div>
    </div>
  );
}
