"use client";

/**
 * "Switch persona" as a menu row (spec §3).
 *
 * The floating DEMO chip is the presenter's shortcut, but someone handed
 * the phone will look for the control where every other setting lives. This
 * puts it in the More menu, and renders nothing at all outside demo mode —
 * a real client never sees a seam where the demo used to be.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { currentPersonaId, personaById } from "@/lib/demo/mode";
import { homeFor } from "@/lib/routes";
import { useWorkforce } from "@/lib/store";
import { BottomSheet } from "../ui";
import { IChevronR, IUsers } from "../WfIcons";
import { PersonaGrid } from "./PersonaPicker";

export function PersonaMenuEntry() {
  const wf = useWorkforce();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (!wf.isDemo) return null;

  const persona = personaById(currentPersonaId());

  return (
    <>
      <div className="wf-card wf-list overflow-hidden">
        <button className="wf-row w-full text-left" onClick={() => setOpen(true)}>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--wf-fill-2)] text-[1.05rem]">
            {persona ? persona.emoji : <IUsers size={18} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[0.92rem] font-semibold">Switch persona</span>
            <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
              {persona
                ? `Signed in as ${persona.name} — ${persona.title}`
                : "Choose who to explore Workfence as"}
            </span>
          </span>
          <IChevronR size={16} className="shrink-0 text-[var(--wf-faint)]" />
        </button>
      </div>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Switch persona"
        tall
      >
        <div className="flex flex-col gap-3">
          <p className="text-[0.82rem] leading-relaxed text-[var(--wf-muted)]">
            Pick a seat at the demo company. The app reloads as that person —
            same data, their permissions.
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
      </BottomSheet>
    </>
  );
}
