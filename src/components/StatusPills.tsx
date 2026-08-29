"use client";

/**
 * Status counts that are also the status filter.
 *
 * Every table of attendance wants the same two things above it: how the
 * day broke down, and a way to see just one part of it. Splitting those
 * into a summary strip and a separate dropdown makes you read the number
 * in one place and act on it in another, and the two drift — one screen
 * had pills, one had a select, one had nothing at all.
 *
 * One rule about the counts, and it is the reason this is a component
 * rather than a snippet: they must be computed over the set *before* the
 * status filter is applied. Counting the filtered rows zeroes every other
 * pill the moment you pick one, which removes the only thing that made
 * the strip worth reading — what else is there.
 */

import { StatusChip } from "./ui";

/** Short labels; the chip is already narrow. */
export const STATUS_TEXT: Record<string, string> = {
  present: "Present",
  late: "Late",
  absent: "Absent",
  "early-checkout": "Early out",
  "missing-checkout": "No checkout",
  "on-leave": "On leave",
  holiday: "Holiday",
  working: "Working",
  "not-in": "Not in",
};

export function StatusPills({
  counts,
  value,
  onChange,
  emptyLabel = "Nothing recorded here.",
}: {
  /** Status → count, over the rows *before* the status filter. */
  counts: Map<string, number>;
  value: string | null;
  onChange: (status: string | null) => void;
  emptyLabel?: string;
}) {
  const total = [...counts.values()].reduce((t, n) => t + n, 0);

  return (
    /* Vertical padding inside the scroller, cancelled by the negative
       margin: `overflow-x: auto` clips the other axis too, and without it
       the selected pill's ring is sliced off top and bottom. */
    <div className="wf-scroll-x -mx-1 -my-1.5 flex items-center gap-2 px-1 py-1.5">
      <button
        type="button"
        aria-pressed={value === null}
        onClick={() => onChange(null)}
        className="wf-chip shrink-0 cursor-pointer whitespace-nowrap font-bold"
        style={{
          background: value === null ? "var(--wf-amber)" : "var(--wf-fill-2)",
          color: value === null ? "var(--wf-on-amber)" : "var(--wf-fg)",
        }}
      >
        All {total}
      </button>

      {[...counts.entries()].map(([status, count]) => {
        const on = value === status;
        return (
          <button
            key={status}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? null : status)}
            className="shrink-0 cursor-pointer rounded-full"
            style={on ? { boxShadow: "0 0 0 1.5px var(--wf-fg)" } : undefined}
          >
            <StatusChip
              status={status as Parameters<typeof StatusChip>[0]["status"]}
              label={`${STATUS_TEXT[status] ?? status} ${count}`}
            />
          </button>
        );
      })}

      {total === 0 ? (
        <span className="text-[0.78rem] text-[var(--wf-muted)]">{emptyLabel}</span>
      ) : null}
    </div>
  );
}

/** Tally a status field over rows, in the order the statuses first appear. */
export function countByStatus<T>(rows: T[], of: (r: T) => string): Map<string, number> {
  const by = new Map<string, number>();
  for (const r of rows) {
    const s = of(r);
    by.set(s, (by.get(s) ?? 0) + 1);
  }
  return by;
}
