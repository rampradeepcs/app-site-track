"use client";

/**
 * Workfence identity.
 *
 * The mark is the product stated in one shape: a perimeter, a way through it,
 * and someone inside. A hexagon reads as a surveyed plot rather than a generic
 * circle; the open right edge is the gate, which is the only part of a
 * boundary a worker actually interacts with; the dot is presence.
 *
 * It is drawn from six computed vertices rather than a traced path so it stays
 * exact at any size — the same geometry serves a 16px favicon and a full
 * splash screen.
 */

import { useEffect, useRef, useSyncExternalStore } from "react";

/** Flat sides left, gate on the right. Vertices at 30°…330°, r=18 in a 48 box. */
const PERIMETER = "M39.588,33 L24,42 L8.412,33 L8.412,15 L24,6 L39.588,15";
/** Length of that polyline, for the draw-on animation. */
const PERIMETER_LEN = 90;

export function WorkfenceMark({
  size = 48,
  className,
  title,
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <linearGradient id="wf-mark-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f6a723" />
          <stop offset="100%" stopColor="#ee6c2b" />
        </linearGradient>
      </defs>
      <path
        d={PERIMETER}
        fill="none"
        stroke="url(#wf-mark-g)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="24" cy="24" r="5" fill="url(#wf-mark-g)" />
    </svg>
  );
}

/**
 * The mark, assembling itself.
 *
 * Order matters: the boundary is drawn first, then the worker appears inside
 * it, then a single pulse leaves through the gate. That is the product's
 * sequence — a site exists, someone arrives, their presence is recorded — so
 * the splash is a sentence rather than decoration.
 *
 * `onDone` fires once the sequence finishes. Under prefers-reduced-motion
 * everything is already in its final state and `onDone` fires promptly, so a
 * worker who has switched motion off is not made to wait for animation they
 * are not seeing.
 */
const MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Subscribed rather than read into state: the preference is an external store,
 * and setting state from an effect to mirror it costs a second render on every
 * mount — on the very first screen the app shows. The server snapshot is
 * `false` so the markup matches, and the client corrects it before paint.
 */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(MOTION_QUERY);
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    () => window.matchMedia(MOTION_QUERY).matches,
    () => false,
  );
}

export function WorkfenceSplash({ onDone }: { onDone?: () => void }) {
  const reduced = usePrefersReducedMotion();
  const done = useRef(false);

  useEffect(() => {
    const t = window.setTimeout(
      () => {
        if (done.current) return;
        done.current = true;
        onDone?.();
      },
      reduced ? 600 : 1850,
    );
    return () => window.clearTimeout(t);
  }, [onDone, reduced]);

  return (
    <div className="wf-splash">
      <svg viewBox="0 0 48 48" width={112} height={112} aria-hidden="true">
        <defs>
          <linearGradient id="wf-splash-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f6a723" />
            <stop offset="100%" stopColor="#ee6c2b" />
          </linearGradient>
        </defs>

        {/* The pulse leaving through the gate — behind the perimeter. */}
        {!reduced && (
          <circle
            className="wf-splash-pulse"
            cx="24"
            cy="24"
            r="14"
            fill="none"
            stroke="var(--wf-amber)"
            strokeWidth="1.5"
          />
        )}

        <path
          className={reduced ? undefined : "wf-splash-perimeter"}
          d={PERIMETER}
          fill="none"
          stroke="url(#wf-splash-g)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={reduced ? undefined : PERIMETER_LEN}
          strokeDashoffset={reduced ? undefined : PERIMETER_LEN}
        />

        <circle
          className={reduced ? undefined : "wf-splash-dot"}
          cx="24"
          cy="24"
          r="5"
          fill="url(#wf-splash-g)"
        />
      </svg>

      <div className={reduced ? undefined : "wf-splash-word"}>
        <h1 className="wf-display text-[1.9rem] font-bold tracking-tight">
          Work<span className="text-[var(--wf-amber)]">fence</span>
        </h1>
        <p className="mt-1 text-center text-[0.82rem] text-[var(--wf-muted)]">
          Attendance that knows where you are
        </p>
      </div>
    </div>
  );
}
