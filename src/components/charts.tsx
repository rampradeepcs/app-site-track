"use client";

/**
 * Lightweight SVG charts for Workfence dashboards — no chart library, so the
 * bundle stays lean and the styling matches the design tokens exactly.
 */

import { useId } from "react";

/* --------------------------------------------------------- bar trend */

export function BarTrend({
  data,
  height = 120,
  format = (v: number) => `${Math.round(v)}`,
  color = "var(--wf-amber)",
  labels,
  ariaLabel,
}: {
  data: number[];
  height?: number;
  format?: (v: number) => string;
  color?: string;
  labels?: string[];
  ariaLabel?: string;
}) {
  const max = Math.max(1, ...data);
  return (
    <div role="img" aria-label={ariaLabel ?? "Bar chart"}>
      <div className="flex items-end gap-[6px]" style={{ height }}>
        {data.map((v, i) => (
          <div
            key={i}
            className="group relative flex-1 rounded-t-[4px] transition-all"
            style={{
              height: `${Math.max(3, (v / max) * 100)}%`,
              background: `color-mix(in oklab, ${color} ${45 + (v / max) * 55}%, transparent)`,
              minWidth: 6,
            }}
          >
            <span className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-black/80 px-1.5 py-0.5 text-[0.62rem] font-semibold text-white group-hover:block">
              {format(v)}
            </span>
          </div>
        ))}
      </div>
      {labels ? (
        <div className="mt-1.5 flex gap-[6px]">
          {labels.map((l, i) => (
            <span
              key={i}
              className="flex-1 truncate text-center text-[0.58rem] font-medium text-[var(--wf-faint)]"
            >
              {l}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------- donut */

export function Donut({
  segments,
  size = 130,
  thickness = 16,
  centerLabel,
  centerSub,
}: {
  segments: Array<{ value: number; color: string; label: string }>;
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerSub?: string;
}) {
  const total = Math.max(
    1e-6,
    segments.reduce((t, s) => t + s.value, 0),
  );
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const label = segments.map((s) => `${s.label}: ${Math.round(s.value)}`).join(", ");
  // Precompute cumulative offsets so render stays pure.
  const arcs = segments.map((s) => ({ ...s, dash: (s.value / total) * c }));
  const offsets = arcs.map((_, i) =>
    arcs.slice(0, i).reduce((t, a) => t + a.dash, 0),
  );
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--wf-surface3)"
        strokeWidth={thickness}
      />
      {arcs.map((s, i) => (
        <circle
          key={i}
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={s.color}
          strokeWidth={thickness}
          strokeDasharray={`${s.dash} ${c - s.dash}`}
          strokeDashoffset={-offsets[i]}
          strokeLinecap={s.dash / c > 0.02 ? "round" : "butt"}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      ))}
      {centerLabel ? (
        <text
          x="50%"
          y={centerSub ? "47%" : "52%"}
          textAnchor="middle"
          fill="var(--wf-fg)"
          fontSize={size * 0.17}
          fontWeight={700}
          fontFamily="var(--font-display)"
        >
          {centerLabel}
        </text>
      ) : null}
      {centerSub ? (
        <text
          x="50%"
          y="63%"
          textAnchor="middle"
          fill="var(--wf-muted)"
          fontSize={size * 0.085}
          fontWeight={600}
        >
          {centerSub}
        </text>
      ) : null}
    </svg>
  );
}

/* ----------------------------------------------------------- sparkline */

export function Sparkline({
  data,
  width = 120,
  height = 36,
  color = "var(--wf-green)",
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  const gid = useId();
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const span = Math.max(1e-6, max - min);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - 3 - ((v - min) / span) * (height - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${pts.join(" ")} ${width},${height}`}
        fill={`url(#${gid})`}
      />
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ------------------------------------------------------ breakdown bars */

export function ScoreBars({
  rows,
}: {
  rows: Array<{ label: string; value: number; weight?: string; color?: string }>;
}) {
  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="text-[0.78rem] font-semibold text-[var(--wf-muted)]">
              {r.label}
              {r.weight ? (
                <span className="ml-1.5 text-[0.65rem] font-medium text-[var(--wf-faint)]">
                  {r.weight}
                </span>
              ) : null}
            </span>
            <span className="text-[0.8rem] font-bold tabular-nums">
              {Math.round(r.value)}
            </span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-[var(--wf-surface3)]"
            role="progressbar"
            aria-valuenow={Math.round(r.value)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={r.label}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(100, Math.max(2, r.value))}%`,
                background: r.color ?? "var(--wf-amber)",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------- progress ring */

export function ProgressRing({
  value,
  size = 74,
  thickness = 7,
  color = "var(--wf-green)",
  label,
}: {
  value: number; // 0–100
  size?: number;
  thickness?: number;
  color?: string;
  label?: string;
}) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const dash = (Math.min(100, Math.max(0, value)) / 100) * c;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label ?? `${Math.round(value)} percent`}
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--wf-surface3)" strokeWidth={thickness} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={thickness}
        strokeDasharray={`${dash} ${c - dash}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="54%"
        textAnchor="middle"
        fill="var(--wf-fg)"
        fontSize={size * 0.24}
        fontWeight={700}
        fontFamily="var(--font-display)"
      >
        {Math.round(value)}
      </text>
    </svg>
  );
}
