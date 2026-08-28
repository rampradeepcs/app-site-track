"use client";

/**
 * Persona selection and switching (spec §2, §3).
 *
 * A persona is a seat, not a login: choosing one signs the demo in as a
 * seeded person, and switching changes who the app thinks you are without
 * asking for a code again. Everything downstream — dashboard, permissions,
 * projects, payroll — follows from the role and the organisation, exactly
 * as it would for a real employee.
 */

import { PERSONAS, type Persona } from "@/lib/demo/mode";
import { useWorkforce } from "@/lib/store";
import { WorkfenceMark } from "../Brand";
import { IChevronR } from "../WfIcons";

export function PersonaGrid({
  onPick,
  currentId,
}: {
  onPick: (p: Persona) => void;
  currentId?: string | null;
}) {
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      {PERSONAS.map((p) => {
        const current = p.id === currentId;
        return (
          <button
            key={p.id}
            className="wf-card flex cursor-pointer items-center gap-3 p-3.5 text-left transition hover:border-[var(--wf-line-strong)]"
            style={
              current
                ? { boxShadow: "0 0 0 1.5px var(--wf-fg)" }
                : undefined
            }
            onClick={() => onPick(p)}
          >
            <span
              aria-hidden
              className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[var(--wf-fill-2)] text-[1.3rem]"
            >
              {p.emoji}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.92rem] font-semibold">
                {p.title}
              </span>
              <span className="block truncate text-[0.76rem] text-[var(--wf-muted)]">
                {p.name} · {p.subtitle}
              </span>
              {/* The verb belongs to the card, but at phone width the name
                  is what identifies it — so the call to action drops to its
                  own line rather than squeezing the person off the row. */}
              <span className="mt-0.5 block truncate text-[0.7rem] font-semibold text-[var(--wf-fg)]">
                {current ? "Current persona" : p.cta}
              </span>
            </span>
            <IChevronR size={16} className="shrink-0 text-[var(--wf-faint)]" />
          </button>
        );
      })}
    </div>
  );
}

/** The screen shown straight after the demo number signs in (spec §2). */
export function PersonaChooser() {
  const { enterDemo } = useWorkforce();
  return (
    <div className="wf-fade-in flex flex-col gap-5">
      <div className="flex flex-col items-center gap-3 text-center">
        <WorkfenceMark size={54} />
        <div>
          <h1 className="wf-display text-2xl">Welcome to Workfence Demo</h1>
          <p className="mt-1 text-sm text-[var(--wf-muted)]">
            Choose a persona to continue. You can switch at any time without
            signing in again.
          </p>
        </div>
      </div>

      <PersonaGrid onPick={(p) => enterDemo(p.id)} />

      <p className="text-center text-[0.72rem] leading-relaxed text-[var(--wf-faint)]">
        Everything inside is fictional demonstration data, kept in its own
        storage and never mixed with a real company&apos;s records.
      </p>
    </div>
  );
}
