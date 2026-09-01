"use client";

/**
 * The demo control (spec §4, §30).
 *
 * Two jobs, and they pull against each other: the presenter must never
 * mistake demonstration data for a real client's, and the audience must not
 * be looking at a banner instead of the product. So it is a small, fixed
 * marker that says DEMO at a glance and opens the full controls — switch
 * persona, reset, guide, exit — only when tapped.
 *
 * It sits above the tab bar rather than over the content, so nothing it
 * covers is ever the thing being demonstrated.
 */

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { PERSONAS, currentPersonaId, personaById } from "@/lib/demo/mode";
import { useWorkforce } from "@/lib/store";
import { homeFor } from "@/lib/routes";
import { BottomSheet } from "../ui";
import { PersonaGrid } from "./PersonaPicker";
import { IChevronR, IRefresh, IX } from "../WfIcons";

/** The five-step story the product tells, in the order it lands best. */
const GUIDE: Array<{ persona: string; title: string; steps: string }> = [
  {
    persona: "owner",
    title: "1 · Super Admin",
    steps: "Clients → subscription → usage → billing",
  },
  {
    persona: "client-owner",
    title: "2 · Client Owner",
    steps: "Organisation → people & roles → projects",
  },
  {
    persona: "pm",
    title: "3 · Project Manager",
    steps: "Project → geofence → live workforce → attendance",
  },
  {
    persona: "employee",
    title: "4 · Employee",
    steps: "Check in → shift → break → work update → checkout → voice note",
  },
  {
    persona: "payroll",
    title: "5 · Payroll",
    steps: "Attendance → overtime → allowances → salary → payroll → lock",
  },
];

export function DemoBar() {
  const wf = useWorkforce();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [guide, setGuide] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  // The chip clears the tab bar on the app surfaces; the platform console has
  // no tab bar, so there it would float in dead space over the content.
  const pathname = usePathname();
  const [hasTabs, setHasTabs] = useState(true);
  useEffect(() => {
    setHasTabs(!!document.querySelector(".wf-tabbar"));
  }, [pathname]);

  /* Tell the page a floating chip is present, so it can reserve the room —
     the chip is fixed, and without this it sits on the last card. */
  const demoOn = wf.isDemo;
  useEffect(() => {
    const root = document.documentElement;
    if (demoOn) root.dataset.demoChip = "true";
    else delete root.dataset.demoChip;
    return () => {
      delete root.dataset.demoChip;
    };
  }, [demoOn]);

  if (!wf.isDemo) return null;

  const persona = personaById(currentPersonaId());

  return (
    <>
      <button
        className="wf-demo-chip"
        data-tabs={hasTabs}
        onClick={() => setOpen(true)}
        aria-label="Demo controls"
      >
        <span className="wf-demo-dot" aria-hidden />
        DEMO
        {persona ? (
          <span className="wf-demo-persona">{persona.title}</span>
        ) : null}
      </button>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Workfence Demo"
        tall
      >
        <div className="flex flex-col gap-4">
          {persona ? (
            <div className="wf-card2 flex items-center gap-3 px-4 py-3">
              <span aria-hidden className="text-[1.4rem]">
                {persona.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[0.66rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
                  Current persona
                </p>
                <p className="truncate text-[0.92rem] font-semibold">
                  {persona.name} — {persona.title}
                </p>
              </div>
            </div>
          ) : null}

          <div>
            <p className="mb-2 text-[0.72rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
              Switch persona
            </p>
            <PersonaGrid
              currentId={persona?.id}
              onPick={(p) => {
                wf.switchPersona(p.id);
                setOpen(false);
                router.push(homeFor(p.role));
              }}
            />
          </div>

          <div className="flex flex-col gap-2">
            <button
              className="wf-btn wf-btn-ghost"
              onClick={() => {
                setOpen(false);
                setGuide(true);
              }}
            >
              Demo guide <IChevronR size={15} />
            </button>
            <button
              className="wf-btn wf-btn-ghost"
              onClick={() => setConfirmReset(true)}
            >
              <IRefresh size={15} /> Reset demo data
            </button>
            <button
              className="wf-btn wf-btn-ghost wf-btn-danger-text"
              onClick={() => wf.exitDemo()}
            >
              <IX size={15} /> Exit demo mode
            </button>
          </div>

          <p className="text-center text-[0.7rem] leading-relaxed text-[var(--wf-faint)]">
            Demonstration data only. Nothing here touches a real company&apos;s
            records, and no message, invoice or payment leaves this device.
          </p>
        </div>
      </BottomSheet>

      {/* guided walkthrough (spec §31) */}
      <BottomSheet open={guide} onClose={() => setGuide(false)} title="Demo guide" tall>
        <div className="flex flex-col gap-2.5">
          <p className="text-[0.82rem] leading-relaxed text-[var(--wf-muted)]">
            The whole product in five moves. Tap a step to switch to that
            persona and start there.
          </p>
          {GUIDE.map((g) => {
            const p = PERSONAS.find((x) => x.id === g.persona);
            return (
              <button
                key={g.persona}
                className="wf-card2 flex cursor-pointer items-center gap-3 px-3.5 py-3 text-left hover:border-[var(--wf-line-strong)]"
                onClick={() => {
                  if (!p) return;
                  wf.switchPersona(p.id);
                  setGuide(false);
                  router.push(homeFor(p.role));
                }}
              >
                <span aria-hidden className="text-[1.2rem]">
                  {p?.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.88rem] font-semibold">{g.title}</span>
                  <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
                    {g.steps}
                  </span>
                </span>
                <IChevronR size={15} className="shrink-0 text-[var(--wf-faint)]" />
              </button>
            );
          })}
        </div>
      </BottomSheet>

      {/* reset confirmation (spec §28) */}
      <BottomSheet
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset demo data"
      >
        <div className="flex flex-col gap-4">
          <p className="text-[0.88rem] leading-relaxed">
            Reset demo data to the original Workfence demonstration state?
            Everything demonstrated so far — check-ins, approvals, payroll
            changes — goes back to how it started.
          </p>
          <p className="text-[0.76rem] leading-relaxed text-[var(--wf-muted)]">
            Real company data is not touched: the demonstration lives in its
            own storage.
          </p>
          <button
            className="wf-btn wf-btn-primary wf-btn-lg"
            onClick={() => wf.resetDemo()}
          >
            Reset demo
          </button>
          <button
            className="wf-btn wf-btn-ghost"
            onClick={() => setConfirmReset(false)}
          >
            Keep current state
          </button>
        </div>
      </BottomSheet>
    </>
  );
}
