"use client";

/** Small presentational pieces shared across the Super Admin portal. */

import type { LimitState } from "@/lib/entitlements";
import { LIMIT_TONE } from "@/lib/entitlements";
import { healthTone } from "@/lib/saas-metrics";
import type {
  InvoiceStatus,
  OrgStatus,
  SubscriptionStatus,
} from "@/lib/saas-types";

/** Typed so an unknown tone is a compile error, not a colourless card. */
const TONES = {
  neutral: "var(--wf-fg)",
  green: "var(--wf-green)",
  blue: "var(--wf-blue)",
  amber: "var(--wf-amber)",
  orange: "var(--wf-orange)",
  red: "var(--wf-red)",
  violet: "var(--wf-violet)",
} as const satisfies Record<string, string>;

export function MetricCard({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: keyof typeof TONES;
}) {
  return (
    <div className="wf-card min-w-0 p-3.5">
      <p className="truncate text-[0.66rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
        {label}
      </p>
      <p
        className="wf-display mt-1 truncate text-[1.45rem] leading-none"
        style={{ color: TONES[tone] }}
      >
        {value}
      </p>
      {sub ? (
        <p className="mt-1 truncate text-[0.68rem] text-[var(--wf-faint)]">{sub}</p>
      ) : null}
    </div>
  );
}

const ORG_TONE: Record<OrgStatus, [string, string]> = {
  active: ["var(--wf-green-soft)", "var(--wf-green)"],
  trial: ["var(--wf-blue-soft)", "var(--wf-blue)"],
  suspended: ["var(--wf-red-soft)", "var(--wf-red)"],
  "payment-hold": ["var(--wf-amber-soft)", "var(--wf-amber)"],
  cancelled: ["var(--wf-slate-soft)", "var(--wf-faint)"],
};

export function StatusPill({ status }: { status: OrgStatus }) {
  const [bg, fg] = ORG_TONE[status];
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[0.66rem] font-bold capitalize"
      style={{ background: bg, color: fg }}
    >
      {status.replace("-", " ")}
    </span>
  );
}

const SUB_TONE: Record<SubscriptionStatus, [string, string]> = {
  trial: ["var(--wf-blue-soft)", "var(--wf-blue)"],
  active: ["var(--wf-green-soft)", "var(--wf-green)"],
  "past-due": ["var(--wf-amber-soft)", "var(--wf-amber)"],
  paused: ["var(--wf-slate-soft)", "var(--wf-faint)"],
  suspended: ["var(--wf-red-soft)", "var(--wf-red)"],
  cancelled: ["var(--wf-slate-soft)", "var(--wf-faint)"],
};

export function SubPill({ status }: { status: SubscriptionStatus }) {
  const [bg, fg] = SUB_TONE[status];
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[0.66rem] font-bold capitalize"
      style={{ background: bg, color: fg }}
    >
      {status.replace("-", " ")}
    </span>
  );
}

const INV_TONE: Record<InvoiceStatus, [string, string]> = {
  draft: ["var(--wf-slate-soft)", "var(--wf-faint)"],
  issued: ["var(--wf-blue-soft)", "var(--wf-blue)"],
  paid: ["var(--wf-green-soft)", "var(--wf-green)"],
  pending: ["var(--wf-amber-soft)", "var(--wf-amber)"],
  overdue: ["var(--wf-orange-soft)", "var(--wf-orange)"],
  failed: ["var(--wf-red-soft)", "var(--wf-red)"],
  refunded: ["var(--wf-violet-soft)", "var(--wf-violet)"],
  cancelled: ["var(--wf-slate-soft)", "var(--wf-faint)"],
};

export function InvoicePill({ status }: { status: InvoiceStatus }) {
  const [bg, fg] = INV_TONE[status];
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[0.66rem] font-bold capitalize"
      style={{ background: bg, color: fg }}
    >
      {status}
    </span>
  );
}

export function HealthPill({ score }: { score: number }) {
  const tone = healthTone(score);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.7rem] font-bold tabular-nums"
      style={{ background: `color-mix(in oklab, ${tone} 16%, transparent)`, color: tone }}
    >
      <i className="h-1.5 w-1.5 rounded-full" style={{ background: tone }} />
      {score}
    </span>
  );
}

/** Usage meter with the 80 / 90 / 100 % thresholds colour-coded. */
export function UsageMeter({
  label,
  state,
  unit,
}: {
  label: string;
  state: LimitState;
  unit?: string;
}) {
  const tone = LIMIT_TONE[state.level];
  const pct = state.limit === null ? 0 : Math.min(100, state.ratio * 100);
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[0.72rem] font-semibold text-[var(--wf-muted)]">{label}</span>
        <span className="shrink-0 text-[0.76rem] font-bold tabular-nums" style={{ color: tone }}>
          {state.label}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
      <div
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--wf-surface3)]"
        role="meter"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} utilisation`}
      >
        <span
          className="block h-full rounded-full transition-[width] duration-500"
          style={{ width: `${state.limit === null ? 6 : pct}%`, background: tone }}
        />
      </div>
      {state.level !== "ok" && (
        <p className="mt-0.5 text-[0.62rem] font-semibold" style={{ color: tone }}>
          {state.level === "reached"
            ? "Limit reached"
            : state.level === "critical"
              ? "Critical — 90%+"
              : "Warning — 80%+"}
        </p>
      )}
    </div>
  );
}
