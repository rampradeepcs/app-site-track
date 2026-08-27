"use client";

/**
 * Workfence identity.
 *
 * The mark is a W cut like site signage: three strokes with gate-shaped
 * notches, reading as a route through a boundary. It ships as filled paths
 * in `currentColor`, so the same component is black on paper and white on
 * black — the mark IS the monochrome system, not a coloured badge on it.
 *
 * `size` is the mark's HEIGHT; width follows the natural 2.4:1 aspect.
 */

import { useEffect, useRef, useSyncExternalStore } from "react";

/* The supplied artwork, tightened to its content box. */
const VIEWBOX = "90 330 820 340";
const ASPECT = 820 / 340;

const STROKES = [
  "M103 345H192.521L286.537 507.232L317.224 453.285L357.685 523.651L281.846 654.805L103 345Z",
  "M281.846 345H371.367L461.279 499.805L506.039 422.598L461.279 345H896.178L852.004 422.598H595.56L460.693 654.805L281.846 345Z",
  "M640.32 499.218H814.084L768.737 577.011H685.08L640.515 655L595.364 577.207L640.32 499.218Z",
];

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
      viewBox={VIEWBOX}
      width={Math.round(size * ASPECT)}
      height={size}
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {STROKES.map((d) => (
        <path key={d} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}

/**
 * The mark, assembling itself: the three strokes land left to right, then
 * the wordmark settles under them. Short on purpose — this screen stands
 * between a worker and their shift.
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
      <svg viewBox={VIEWBOX} width={220} height={91} aria-hidden="true">
        {STROKES.map((d, i) => (
          <path
            key={d}
            d={d}
            fill="currentColor"
            className={reduced ? undefined : "wf-splash-stroke"}
            style={reduced ? undefined : { animationDelay: `${120 + i * 220}ms` }}
          />
        ))}
      </svg>

      <div className={reduced ? undefined : "wf-splash-word"}>
        <h1 className="wf-display text-center text-[1.9rem] tracking-tight">
          Workfence
        </h1>
        <p className="mt-1 text-center text-[0.82rem] text-[var(--wf-muted)]">
          Attendance that knows where you are
        </p>
      </div>
    </div>
  );
}
