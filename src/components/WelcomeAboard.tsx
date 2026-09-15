"use client";

/**
 * The first thing somebody sees after an invitation.
 *
 * A worker taps a link in an email, signs in, and lands on a shift screen
 * that names a site they were never told about. They know they were asked to
 * install something by a foreman; they do not necessarily know the company
 * they now appear inside, and nothing on the screens ever says it — the
 * company name was deliberately taken out of the headers, because it is the
 * same on every screen and earns its space on none of them.
 *
 * Except this one. Arriving is the single moment the name is the whole
 * message, so it gets a screen of its own, once, and then never again.
 *
 * Shown once per person per company. Somebody who joins a second company is
 * welcomed into that one too, because it is a different place to arrive.
 */

import { useEffect, useState } from "react";
import { WorkfenceMark } from "./Brand";
import { ICheck } from "./WfIcons";
import { useWorkforce } from "@/lib/store";
import { isLiveBackend } from "@/lib/supabase/client";
import { demoActive } from "@/lib/demo/mode";
import { claimWelcomeRemote } from "@/lib/supabase/repository";
import { describeError } from "@/lib/errors";

export interface Greeting {
  company: string;
  site: string;
  name: string;
  role: string;
}

/** What the role actually means to the person holding it, in one line. */
function roleLine(role: string): string {
  switch (role) {
    case "admin":
      return "You can set up sites, manage people and run payroll.";
    case "manager":
      return "You can mark your crew present, approve travel and see your site live.";
    default:
      return "You will start and end your shifts from your phone.";
  }
}

export function WelcomeAboard() {
  const { state, currentUser } = useWorkforce();
  const [greeting, setGreeting] = useState<Greeting | null>(null);

  const signedIn = !!state?.session && !!currentUser;

  useEffect(() => {
    /*
     * Demo personas are not arriving anywhere — they are a tour of a company
     * that already exists, and greeting them on every persona switch would
     * be six welcomes to the same fictional firm.
     */
    if (!signedIn || !isLiveBackend || demoActive()) return;

    let cancelled = false;
    void (async () => {
      try {
        const claim = await claimWelcomeRemote();
        if (cancelled || !claim.due || !claim.company) return;
        setGreeting({
          company: claim.company,
          site: claim.site,
          name: claim.name,
          role: claim.role,
        });
      } catch (e) {
        /*
         * Never in the way. A greeting that cannot be fetched is not a
         * reason to hold up somebody's first shift, and the claim is
         * idempotent — an error leaves welcomed_at unset, so the next
         * launch tries again.
         */
        console.warn("[workfence] welcome:", describeError(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  if (!greeting) return null;
  return <WelcomeScreen greeting={greeting} onDone={() => setGreeting(null)} />;
}

/**
 * The screen itself, separated from the claim that decides whether to show
 * it: what it looks like and when it appears are different questions, and
 * only one of them needs a database to answer.
 */
export function WelcomeScreen({
  greeting,
  onDone,
}: {
  greeting: Greeting;
  onDone: () => void;
}) {
  const first = greeting.name.trim().split(/\s+/)[0] || "";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Welcome to ${greeting.company}`}
      className="wf-fade-in fixed inset-0 z-[80] flex flex-col bg-[var(--wf-bg)]"
    >
      {/*
        The overlay is fixed, so it escapes the padding .wf puts under the
        status bar and has to keep clear of the clock itself.

        Centred, but scrollable with it: a long legal name and a long site
        name on a short phone is taller than the screen, and centred content
        that overflows is content with its head and feet cut off. `my-auto`
        on the inner column centres it while there is room and gives up
        gracefully when there is not.
      */}
      <div
        className="flex flex-1 flex-col overflow-y-auto px-6 text-center"
        style={{ paddingTop: "calc(var(--wf-safe-top) + 1.5rem)" }}
      >
        <div className="my-auto flex flex-col items-center gap-6 py-4">
        <WorkfenceMark size={34} className="text-[var(--wf-fg)]" title="Workfence" />

        <div className="flex flex-col gap-3">
          <p className="text-[0.8rem] font-bold uppercase tracking-[0.16em] text-[var(--wf-amber)]">
            {first ? `Welcome, ${first}` : "Welcome"}
          </p>

          {/* The name is the message, so it gets the size — but a company
              registered as "… & Construction Pvt. Ltd." is four lines at
              2rem and pushes everything else off a short screen. The scale
              steps down as the name grows rather than wrapping forever. */}
          <h1
            className={`wf-display text-balance leading-[1.15] ${
              greeting.company.length > 34
                ? "text-[1.45rem]"
                : greeting.company.length > 20
                  ? "text-[1.7rem]"
                  : "text-[2rem]"
            }`}
          >
            You&rsquo;re part of {greeting.company}
          </h1>

          <p className="text-[0.95rem] leading-relaxed text-[var(--wf-muted)]">
            {greeting.site
              ? `They record site attendance on Workfence, and your site is ${greeting.site}.`
              : "They record site attendance on Workfence."}
          </p>
        </div>

        <ul className="flex w-full max-w-sm flex-col gap-2.5 text-left">
          {[
            roleLine(greeting.role),
            "Your hours and the day's route are recorded as they happen.",
            "Nothing is recorded until you start a shift.",
          ].map((line) => (
            <li
              key={line}
              className="wf-card2 flex items-start gap-3 px-3.5 py-3 text-[0.85rem] leading-snug"
            >
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--wf-amber-soft)] text-[var(--wf-amber)]">
                <ICheck size={12} />
              </span>
              <span>{line}</span>
            </li>
            ))}
          </ul>
        </div>
      </div>

      {/* The bar sits where every other action in the app sits. */}
      <div className="wf-safe-bottom px-5 pb-5">
        <button
          className="wf-btn wf-btn-primary w-full"
          onClick={onDone}
          autoFocus
        >
          Get started
        </button>
      </div>
    </div>
  );
}
