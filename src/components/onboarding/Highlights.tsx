"use client";

/**
 * What the product does, before anyone is asked for anything.
 *
 * Four claims, one per screen, in the order a site actually uses them:
 * a shift starts, a supervisor watches it, the record writes itself, and —
 * last, because it is the objection everyone arrives with — the company
 * decides how much is tracked at all.
 *
 * Built on scroll-snap rather than a gesture library: a horizontal scroller
 * is already swipeable, already keyboard-navigable, and already accessible
 * to a screen reader as a list. The dots read the scroll position instead of
 * driving it, so a swipe, a keypress and a dot tap all take the same path.
 */

import { useCallback, useRef, useState } from "react";
import { IArrowR, ICheckCircle, IHardHat, IMap, IShield } from "../WfIcons";
import { WorkfenceMark } from "../Brand";

interface Slide {
  key: string;
  icon: React.ReactNode;
  /* Literal colours, not tokens: the chip sits over dark video on every
     slide, so it must stay light in both themes. */
  tint: string;
  ink: string;
  title: string;
  body: string;
  /** Full-bleed background video; the copy drops to the bottom over a scrim. */
  video?: string;
}

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * Whether this device has been through the highlights once — the gate shows
 * them between the splash and sign-in on first run, and never again. Their
 * own key rather than the store: the store is versioned and can be
 * discarded, and "has seen the pitch" should survive that.
 */
const SEEN_KEY = "workfence.highlights-seen";

export function seenHighlights(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markHighlightsSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* private mode — they'll see them again, which is harmless */
  }
}

const SLIDES: Slide[] = [
  {
    key: "record",
    icon: <ICheckCircle size={34} />,
    tint: "rgba(255, 255, 255, 0.22)",
    ink: "#ffffff",
    title: "Attendance writes itself",
    body: "Hours, lateness, the day's route and the work logged against it — recorded as it happens, exportable when payroll asks.",
    video: "/onboarding/record.mp4",
  },
  {
    key: "live",
    icon: <IMap size={34} />,
    tint: "rgba(255, 255, 255, 0.22)",
    ink: "#ffffff",
    title: "See the whole site live",
    body: "Every crew member on one map while their shift is open — who is on site, who left the boundary, and how long ago.",
    video: "/onboarding/live.mp4",
  },
  {
    key: "policy",
    icon: <IShield size={34} />,
    tint: "rgba(255, 255, 255, 0.22)",
    ink: "#ffffff",
    title: "Track what matters, not everything",
    body: "Per site, choose whether on-site movement is recorded at all. Turn it off and only trips away from the boundary are — material runs, client visits, nothing else.",
    video: "/onboarding/policy.mp4",
  },
  {
    key: "checkin",
    icon: <IHardHat size={34} />,
    tint: "rgba(255, 255, 255, 0.22)",
    ink: "#ffffff",
    title: "The gate is the clock",
    body: "A shift starts with a selfie, inside the site boundary. No paper register, no one signing in for a mate who is still on the bus.",
    video: "/onboarding/checkin.mp4",
  },
];

export function Highlights({
  onDone,
  onSkip,
  doneLabel = "Create your company",
}: {
  onDone: () => void;
  onSkip: () => void;
  /** Last slide's CTA — the wizard creates a company, the gate signs in. */
  doneLabel?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const last = index === SLIDES.length - 1;

  const goTo = useCallback((i: number) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  }, []);

  /* The scroller is the source of truth: a swipe and a dot tap both land here. */
  const onScroll = () => {
    const el = scroller.current;
    if (!el || el.clientWidth === 0) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    setIndex(Math.min(SLIDES.length - 1, Math.max(0, i)));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="flex items-center justify-between">
        <WorkfenceMark size={34} title="Workfence" />
        <button
          className="cursor-pointer text-sm font-semibold text-[var(--wf-muted)] hover:text-[var(--wf-fg)]"
          onClick={onSkip}
        >
          Skip
        </button>
      </div>

      <div
        ref={scroller}
        onScroll={onScroll}
        role="group"
        aria-label="Product highlights"
        // No padding on the scroller: a panel is exactly one clientWidth, which
        // is what makes `goTo` land on a slide and the dots agree with it. Any
        // gutter here also lets the next panel peek in, which reads as the
        // layout overflowing rather than as an invitation to swipe.
        className="wf-snap-x flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto"
      >
        {SLIDES.map((s, i) => (
          <section
            key={s.key}
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${SLIDES.length}: ${s.title}`}
            className={
              s.video
                ? "relative flex w-full shrink-0 snap-start flex-col items-center justify-end gap-4 overflow-hidden rounded-3xl pb-7 text-center"
                : "flex w-full shrink-0 snap-start flex-col items-center justify-center gap-6 text-center"
            }
          >
            {s.video ? (
              <>
                <video
                  className="absolute inset-0 h-full w-full object-cover"
                  src={`${BASE}${s.video}`}
                  autoPlay
                  muted
                  loop
                  playsInline
                  aria-hidden
                />
                {/* Scrim so the copy stays legible over whatever frame is up. */}
                <div
                  className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent"
                  aria-hidden
                />
              </>
            ) : null}
            <span
              className={`grid place-items-center ${
                s.video
                  ? "relative z-10 h-16 w-16 rounded-[1.3rem]"
                  : "h-20 w-20 rounded-[1.6rem]"
              }`}
              style={{ background: s.tint, color: s.ink }}
            >
              {s.icon}
            </span>
            <div className={s.video ? "relative z-10 max-w-sm px-5" : "max-w-sm"}>
              <h2
                className={`wf-display text-[1.65rem] leading-tight font-bold ${
                  s.video ? "text-white" : ""
                }`}
              >
                {s.title}
              </h2>
              <p
                className={`mt-3 text-[0.92rem] leading-relaxed ${
                  s.video ? "text-white/85" : "text-[var(--wf-muted)]"
                }`}
              >
                {s.body}
              </p>
            </div>
          </section>
        ))}
      </div>

      <div className="flex items-center justify-center gap-2" aria-hidden>
        {SLIDES.map((s, i) => (
          <button
            key={s.key}
            onClick={() => goTo(i)}
            tabIndex={-1}
            className="cursor-pointer p-2"
          >
            <span
              className={`block h-1.5 rounded-full transition-all ${
                i === index
                  ? "w-6 bg-[var(--wf-amber)]"
                  : "w-1.5 bg-[var(--wf-line-strong)]"
              }`}
            />
          </button>
        ))}
      </div>

      <button
        className="wf-btn wf-btn-primary wf-btn-lg"
        onClick={() => (last ? onDone() : goTo(index + 1))}
      >
        {last ? doneLabel : "Next"} <IArrowR size={18} />
      </button>
    </div>
  );
}
