"use client";

/**
 * Shared Workfence UI primitives — cards, chips, sheets, form fields.
 * Everything assumes the `.wf` token scope from workforce.css.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DECELERATION, VelocityTracker, project, rubberband, spring } from "@/lib/spring";
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
  present: { bg: "var(--wf-green-soft)", fg: "var(--wf-green)", label: "Present" },
  absent: { bg: "var(--wf-red-soft)", fg: "var(--wf-red)", label: "Absent" },
  late: { bg: "var(--wf-amber-soft)", fg: "var(--wf-amber)", label: "Late" },
  "early-checkout": { bg: "var(--wf-blue-soft)", fg: "var(--wf-blue)", label: "Early Out" },
  "missing-checkout": { bg: "var(--wf-red-soft)", fg: "var(--wf-red)", label: "No Checkout" },
  "on-leave": { bg: "var(--wf-violet-soft)", fg: "var(--wf-violet)", label: "On Leave" },
  holiday: { bg: "var(--wf-slate-soft)", fg: "var(--wf-muted)", label: "Holiday" },
  working: { bg: "var(--wf-green-soft)", fg: "var(--wf-green)", label: "Working" },
  "not-in": { bg: "var(--wf-slate-soft)", fg: "var(--wf-muted)", label: "Not In" },
  queued: { bg: "var(--wf-amber-soft)", fg: "var(--wf-amber)", label: "Queued" },
  synced: { bg: "var(--wf-green-soft)", fg: "var(--wf-green)", label: "Synced" },
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
  tone?: "neutral" | "amber" | "green" | "red" | "blue" | "violet";
}) {
  const map = {
    // Full label ink, not secondary: a chip already sits on a fill, and
    // secondary-on-a-wash measured 3.82:1. iOS puts label colour on a
    // system fill for exactly this reason.
    neutral: { bg: "var(--wf-fill-2)", fg: "var(--wf-fg)" },
    amber: { bg: "var(--wf-amber-soft)", fg: "var(--wf-amber)" },
    green: { bg: "var(--wf-green-soft)", fg: "var(--wf-green)" },
    red: { bg: "var(--wf-red-soft)", fg: "var(--wf-red)" },
    blue: { bg: "var(--wf-blue-soft)", fg: "var(--wf-blue)" },
    violet: { bg: "var(--wf-violet-soft)", fg: "var(--wf-violet)" },
  }[tone];
  return (
    <span className="wf-chip" style={{ background: map.bg, color: map.fg }}>
      {children}
    </span>
  );
}

/* ----------------------------------------------------------- KPI card */

/**
 * Display size for a KPI value, chosen from how much there is to show.
 *
 * Only strings and numbers can be measured; a node (a value with its own
 * markup) keeps the full size, which is what those are built for.
 */
function valueSize(value: React.ReactNode): string {
  const text =
    typeof value === "string" || typeof value === "number" ? String(value) : "";
  if (!text || text.length <= 7) return "text-[1.65rem]";
  if (text.length <= 9) return "text-[1.4rem]";
  if (text.length <= 12) return "text-[1.2rem]";
  return "text-[1.05rem]";
}

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
      {/* The display size steps down for long values. A fixed size clipped
          them at the card edge, which on a money figure is not a cosmetic
          problem: "₹10,50,812.31" rendered as "₹10,50,812.3" reads as a
          real, wrong number. Short values keep the full size. */}
      <div
        className={`wf-display font-bold leading-none [overflow-wrap:anywhere] ${valueSize(value)}`}
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
  const track = useRef<HTMLDivElement>(null);
  const index = Math.max(0, options.findIndex((o) => o.value === value));

  /*
   * The pill's geometry is measured from the DOM rather than computed as
   * `100 / options.length` percent, because the segments are not equal
   * width — "Don't record it" is twice "Record it" — and a pill that
   * assumes they are lands off the label it is meant to be under.
   *
   * Measured in a layout effect so the first paint already has it right:
   * a pill that snaps into place after mount is a visible flicker on the
   * screen a worker sees first.
   */
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const measure = () => {
      const active = el.querySelectorAll<HTMLElement>("[data-seg]")[index];
      if (!active) return;
      setPill({ x: active.offsetLeft - 2, w: active.offsetWidth });
    };
    measure();
    // Re-measure on resize: the labels reflow, so the pill must follow.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [index, options.length]);

  return (
    <div
      ref={track}
      role="tablist"
      aria-label={ariaLabel}
      className="wf-seg max-w-full"
      style={{ minHeight: size === "sm" ? 28 : 32 }}
    >
      {pill ? (
        <span
          aria-hidden
          className="wf-seg-pill"
          style={{ width: pill.w, transform: `translateX(${pill.x}px)` }}
        />
      ) : null}
      {options.map((o) => (
        <button
          key={o.value}
          data-seg
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className="wf-seg-item inline-flex items-center justify-center whitespace-nowrap"
          style={{ minHeight: size === "sm" ? 24 : 28 }}
        >
          {o.label}
        </button>
      ))}
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
    /*
     * 51×31 with a 27px knob — the real UIKit dimensions, in the CSS. The
     * button around it is 44px tall so a gloved thumb at a site gate can
     * hit it; the switch itself does not grow, because a switch that is
     * bigger than iOS's reads as a toy on every settings row.
     */
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="grid h-11 shrink-0 cursor-pointer place-items-center bg-transparent"
    >
      <span className="wf-switch" data-on={checked} />
    </button>
  );
}

/* -------------------------------------------------------- bottom sheet */

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function BottomSheet({
  open,
  onClose,
  title,
  children,
  tall,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  tall?: boolean;
  /** Roomier column for the desktop platform console. */
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const sheet = ref.current;
    const restoreTo = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Trap Tab inside the dialog: without this, focus walks onto the page
      // behind the scrim, where aria-modal has already hidden it from AT.
      if (e.key !== "Tab" || !sheet) return;
      const items = [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        sheet.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!e.shiftKey && (active === last || !sheet.contains(active))) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || !sheet.contains(active))) {
        e.preventDefault();
        last.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    sheet?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      // Send focus back where it came from, so closing never dumps the user
      // at the top of the document.
      restoreTo?.focus?.();
    };
  }, [open, onClose]);

  /* ------------------------------------------------------- the drag */
  /*
   * A sheet you can throw. Tracking is 1:1 with the finger from the first
   * move, and the release either dismisses or springs home — decided by
   * where the throw was *going*, not where the finger happened to stop.
   *
   * Pointer capture keeps the drag alive when the finger leaves the sheet,
   * which it always does on a downward flick.
   */
  const surface = useRef<HTMLDivElement>(null);
  /*
   * The entry animation has to be taken off once it has played.
   * `wf-sheet-in` uses `animation-fill-mode: both`, so its final keyframe
   * keeps applying a transform — and a running animation beats an inline
   * style in the cascade. The drag below sets `style.transform` every
   * frame and it was being silently overridden, so the sheet did not move
   * at all: it only ever appeared to work because a dismissing sheet
   * unmounts. Dropping the class when the animation ends hands control
   * back to the gesture.
   */
  const [entering, setEntering] = useState(true);
  // Adjusted during render rather than in an effect: the sheet stays mounted
  // when closed (the early return is below the hooks), so `entering` has to
  // be re-armed when `open` flips or the second opening plays no animation.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setEntering(open);
  }
  const scrim = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ startY: number; y: number; height: number } | null>(null);
  const tracker = useRef(new VelocityTracker());
  const stopSpring = useRef<(() => void) | null>(null);

  const paint = useCallback((y: number) => {
    const el = surface.current;
    if (el) el.style.transform = y === 0 ? "" : `translate3d(0, ${y}px, 0)`;
    // The scrim thins as the sheet leaves, so the background comes back at
    // the rate the sheet is actually moving rather than at the end.
    const sc = scrim.current;
    const h = drag.current?.height ?? 1;
    if (sc) sc.style.opacity = String(Math.max(0, 1 - y / h));
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    // Only from the grabber/header area: dragging from inside a scrolling
    // list would fight the scroll, and the loser is always the user.
    //
    // Controls are excluded for a subtler reason. Starting a drag calls
    // setPointerCapture, which redirects the pointerup to the surface — so
    // the browser never pairs down and up on the button and never fires a
    // click. That is why the sheet's own close button did nothing: the
    // press was being taken for the start of a dismiss gesture.
    if (
      (e.target as HTMLElement).closest(
        "[data-sheet-scroll], button, a, input, select, textarea, [role='button']",
      )
    ) {
      return;
    }
    const el = surface.current;
    if (!el) return;
    stopSpring.current?.();
    stopSpring.current = null;
    // Grabbing mid-entry: take over from the presentation value rather than
    // letting the animation keep running underneath the drag.
    setEntering(false);
    el.setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, y: 0, height: el.offsetHeight };
    tracker.current.reset();
    tracker.current.add(0);
    el.style.transition = "none";
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const raw = e.clientY - d.startY;
    // Downward tracks the finger exactly. Upward resists, because there is
    // nothing above the top of a sheet — but it must not feel stuck.
    d.y = raw >= 0 ? raw : -rubberband(-raw, d.height);
    tracker.current.add(d.y);
    paint(d.y);
  };

  const onPointerUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    const v = tracker.current.velocity();
    // Where the throw lands, not where the finger stopped. A fast flick
    // from near the top dismisses; a slow drag most of the way does not.
    const projected = d.y + project(v, DECELERATION.sheet);
    if (projected > d.height * 0.4) {
      stopSpring.current = spring(d.y, d.height, paint,
        { damping: 1, response: 0.32, velocity: v }, onClose);
    } else {
      // Home. A little bounce is earned here — the gesture had momentum.
      stopSpring.current = spring(d.y, 0, paint,
        { damping: 0.82, response: 0.4, velocity: v });
    }
  };

  useEffect(() => () => stopSpring.current?.(), []);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70]">
      <button
        ref={scrim}
        aria-label="Close"
        className="wf-fade-in absolute inset-0 cursor-pointer"
        style={{ background: "var(--wf-scrim)", backdropFilter: "blur(2px)" }}
        onClick={onClose}
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`absolute inset-x-0 bottom-0 mx-auto flex w-full flex-col ${
          wide ? "max-w-[720px]" : "max-w-[430px]"
        } ${
          // Leave the status bar clear: a tall sheet on a short screen would
          // otherwise reach up under the clock.
          tall
            ? "max-h-[calc(92dvh-var(--wf-safe-top))]"
            : "max-h-[calc(80dvh-var(--wf-safe-top))]"
        }`}
      >
        <div
          ref={surface}
          className={`${entering ? "wf-sheet-in" : ""} flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-[20px] bg-[var(--wf-surface)] shadow-[0_-1px_0_var(--wf-line)] touch-none`}
          onAnimationEnd={() => setEntering(false)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span className="wf-grabber" aria-hidden />
          {title ? (
            <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-2.5">
              <h2 className="wf-title">{title}</h2>
              <button
                onClick={onClose}
                aria-label="Close sheet"
                className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full bg-[var(--wf-fill-2)] text-[var(--wf-muted)]"
              >
                <IX size={16} />
              </button>
            </div>
          ) : (
            <div className="h-2" />
          )}
          {/* Marked so the drag handler lets the scroll win in here. */}
          <div
            data-sheet-scroll
            className="wf-safe-bottom min-h-0 flex-1 touch-pan-y overflow-y-auto px-5 pb-5"
          >
            {children}
          </div>
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
