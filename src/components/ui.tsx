"use client";

/**
 * Shared SiteTrack UI primitives — cards, chips, sheets, form fields.
 * Everything assumes the `.wf` token scope from workforce.css.
 */

import { useEffect, useRef, useState } from "react";
import { fmtClock, initialsOf } from "@/lib/format";
import type { AttendanceStatus } from "@/lib/types";
import { IX } from "./WfIcons";

/* ------------------------------------------------------------- avatar */

export function Avatar({
  name,
  hue,
  size = 40,
  ring,
}: {
  name: string;
  hue: number;
  size?: number;
  ring?: "green" | "amber" | "red" | "none";
}) {
  const ringColor =
    ring === "green"
      ? "var(--wf-green)"
      : ring === "amber"
        ? "var(--wf-amber)"
        : ring === "red"
          ? "var(--wf-red)"
          : "transparent";
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `hsl(${hue} 45% 26%)`,
        color: `hsl(${hue} 80% 82%)`,
        boxShadow: ring && ring !== "none" ? `0 0 0 2px var(--wf-bg), 0 0 0 4px ${ringColor}` : undefined,
      }}
    >
      {initialsOf(name)}
    </span>
  );
}

/* -------------------------------------------------------- status chips */

const STATUS_STYLES: Record<
  AttendanceStatus | "working" | "not-in" | "queued" | "synced",
  { bg: string; fg: string; label: string }
> = {
  present: { bg: "rgba(47,211,118,0.14)", fg: "var(--wf-green)", label: "Present" },
  absent: { bg: "rgba(244,87,77,0.14)", fg: "var(--wf-red)", label: "Absent" },
  late: { bg: "rgba(246,167,35,0.15)", fg: "var(--wf-amber)", label: "Late" },
  "early-checkout": { bg: "rgba(69,184,245,0.14)", fg: "var(--wf-blue)", label: "Early Out" },
  "missing-checkout": { bg: "rgba(244,87,77,0.14)", fg: "var(--wf-red)", label: "No Checkout" },
  "on-leave": { bg: "rgba(167,139,250,0.15)", fg: "var(--wf-violet)", label: "On Leave" },
  holiday: { bg: "rgba(148,163,184,0.14)", fg: "var(--wf-muted)", label: "Holiday" },
  working: { bg: "rgba(47,211,118,0.14)", fg: "var(--wf-green)", label: "Working" },
  "not-in": { bg: "rgba(148,163,184,0.14)", fg: "var(--wf-muted)", label: "Not In" },
  queued: { bg: "rgba(246,167,35,0.15)", fg: "var(--wf-amber)", label: "Queued" },
  synced: { bg: "rgba(47,211,118,0.14)", fg: "var(--wf-green)", label: "Synced" },
};

export function StatusChip({
  status,
  label,
  dot,
}: {
  status: keyof typeof STATUS_STYLES;
  label?: string;
  dot?: boolean;
}) {
  const s = STATUS_STYLES[status];
  return (
    <span className="wf-chip" style={{ background: s.bg, color: s.fg }}>
      {dot ? (
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: s.fg }}
        />
      ) : null}
      {label ?? s.label}
    </span>
  );
}

export function Chip({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "amber" | "green" | "red" | "blue";
}) {
  const map = {
    neutral: { bg: "rgba(148,163,184,0.13)", fg: "var(--wf-muted)" },
    amber: { bg: "rgba(246,167,35,0.15)", fg: "var(--wf-amber)" },
    green: { bg: "rgba(47,211,118,0.14)", fg: "var(--wf-green)" },
    red: { bg: "rgba(244,87,77,0.14)", fg: "var(--wf-red)" },
    blue: { bg: "rgba(69,184,245,0.14)", fg: "var(--wf-blue)" },
  }[tone];
  return (
    <span className="wf-chip" style={{ background: map.bg, color: map.fg }}>
      {children}
    </span>
  );
}

/* ----------------------------------------------------------- KPI card */

export function KpiCard({
  label,
  value,
  sub,
  tone,
  icon,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "amber" | "green" | "red" | "blue" | "neutral";
  icon?: React.ReactNode;
  onClick?: () => void;
}) {
  const accent =
    tone === "amber"
      ? "var(--wf-amber)"
      : tone === "green"
        ? "var(--wf-green)"
        : tone === "red"
          ? "var(--wf-red)"
          : tone === "blue"
            ? "var(--wf-blue)"
            : "var(--wf-fg)";
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={`wf-card flex flex-col gap-1.5 p-4 text-left ${onClick ? "cursor-pointer transition hover:border-[var(--wf-line-strong)]" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.68rem] font-semibold uppercase tracking-[0.09em] text-[var(--wf-muted)]">
          {label}
        </span>
        {icon ? <span style={{ color: accent }}>{icon}</span> : null}
      </div>
      <div
        className="wf-display text-[1.65rem] font-bold leading-none"
        style={{ color: accent }}
      >
        {value}
      </div>
      {sub ? <div className="text-xs text-[var(--wf-faint)]">{sub}</div> : null}
    </Comp>
  );
}

/* --------------------------------------------------------- list pieces */

export function SectionTitle({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="wf-display text-[0.95rem] font-bold tracking-tight">
        {children}
      </h2>
      {action}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="wf-card flex flex-col items-center gap-2 px-6 py-10 text-center">
      {icon ? <div className="mb-1 text-[var(--wf-faint)]">{icon}</div> : null}
      <p className="font-semibold">{title}</p>
      {body ? <p className="max-w-xs text-sm text-[var(--wf-muted)]">{body}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------- fields */

export function Field({
  label,
  children,
  hint,
  required,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="wf-label">
        {label}
        {required ? <span className="ml-1 text-[var(--wf-red)]">*</span> : null}
      </span>
      {children}
      {hint ? (
        <span className="mt-1 block text-xs text-[var(--wf-faint)]">{hint}</span>
      ) : null}
    </label>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  ariaLabel,
}: {
  options: Array<{ value: T; label: React.ReactNode }>;
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-[var(--wf-line)] bg-[var(--wf-surface)] p-1"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={`shrink-0 cursor-pointer whitespace-nowrap rounded-lg font-semibold transition ${
              size === "sm" ? "px-2.5 py-1.5 text-[0.72rem]" : "px-3.5 py-2 text-[0.8rem]"
            } ${
              active
                ? "bg-[var(--wf-surface3)] text-[var(--wf-amber)] shadow-sm"
                : "text-[var(--wf-muted)] hover:text-[var(--wf-fg)]"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative h-7 w-12 shrink-0 cursor-pointer rounded-full transition-colors"
      style={{ background: checked ? "var(--wf-green-dim)" : "var(--wf-surface3)" }}
    >
      <span
        className="absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all"
        style={{ left: checked ? "calc(100% - 26px)" : "2px" }}
      />
    </button>
  );
}

/* -------------------------------------------------------- bottom sheet */

export function BottomSheet({
  open,
  onClose,
  title,
  children,
  tall,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  tall?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="wf-fade-in fixed inset-0 z-[70]">
      <button
        aria-label="Close"
        className="absolute inset-0 cursor-pointer bg-black/60 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`wf-sheet-in absolute inset-x-0 bottom-0 mx-auto flex w-full max-w-[430px] flex-col rounded-t-3xl border border-b-0 border-[var(--wf-line)] bg-[var(--wf-surface)] ${
          tall ? "max-h-[92dvh]" : "max-h-[80dvh]"
        }`}
      >
        <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-3">
          <span className="mx-auto -mt-0.5 mb-1 block h-1 w-10 shrink-0 rounded-full bg-[var(--wf-line-strong)]" />
        </div>
        {title ? (
          <div className="flex items-center justify-between px-5 pb-3">
            <h2 className="wf-display text-lg font-bold">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close sheet"
              className="grid h-9 w-9 cursor-pointer place-items-center rounded-full bg-[var(--wf-surface2)] text-[var(--wf-muted)] hover:text-[var(--wf-fg)]"
            >
              <IX size={17} />
            </button>
          </div>
        ) : null}
        <div className="wf-safe-bottom min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          {children}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- modal */

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="wf-fade-in fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button
        aria-label="Close"
        className="absolute inset-0 cursor-pointer bg-black/60 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`wf-pop-in relative flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-2xl border border-[var(--wf-line)] bg-[var(--wf-surface)] ${
          wide ? "max-w-3xl" : "max-w-md"
        }`}
      >
        {title ? (
          <div className="flex items-center justify-between border-b border-[var(--wf-line)] px-5 py-4">
            <h2 className="wf-display text-lg font-bold">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close dialog"
              className="grid h-9 w-9 cursor-pointer place-items-center rounded-full bg-[var(--wf-surface2)] text-[var(--wf-muted)] hover:text-[var(--wf-fg)]"
            >
              <IX size={17} />
            </button>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- live clock */

/** Ticking elapsed time since `since` (ms). */
export function LiveDuration({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return <span className="tabular-nums">{fmtClock(now - since)}</span>;
}

/** Re-renders children every `seconds` so relative times stay fresh. */
export function useNowTick(seconds = 30): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), seconds * 1000);
    return () => window.clearInterval(t);
  }, [seconds]);
  return now;
}
