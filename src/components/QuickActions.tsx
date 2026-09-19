"use client";

/**
 * The screens somebody reaches for, on the screen they land on.
 *
 * Five things fit in the bar at the bottom, and the fifth is "More". So the
 * live map, shifts, payroll and travel — the work an administrator actually
 * opens the app to do — all sit two taps away behind a menu, while the
 * dashboard above them spends its whole height on numbers. Both overview
 * screens had noticed and both had answered the same way: a couple of
 * full-width buttons hardcoded into the page, Shifts and Payroll, chosen
 * because they were the two that annoyed somebody most.
 *
 * This is that idea done once and done properly. A tile is a destination and
 * nothing else — no counts, no state, nothing that needs keeping up to date —
 * because the moment a shortcut starts reporting something it becomes a thing
 * to read rather than a thing to press.
 *
 * Plan features are honoured here rather than at the far end. A tile is a
 * promise that pressing it does something, and a menu of upgrade walls is
 * worse than a shorter menu: it teaches people that half the tiles lie. What
 * the plan does not include is not shown at all.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { useEntitlements } from "./FeatureGate";
import { useWorkforce } from "@/lib/store";
import type { FeatureSet } from "@/lib/saas-types";

export interface QuickAction {
  href: string;
  /** One or two words. These sit under an icon in a third of a phone. */
  label: string;
  icon: ReactNode;
  /** Omitted for anything every plan includes. */
  feature?: keyof FeatureSet;
}

export function QuickActions({ actions }: { actions: readonly QuickAction[] }) {
  const ent = useEntitlements();
  const { currentUser } = useWorkforce();
  // The same exemption useFeature makes: somebody inspecting a tenant from the
  // platform console sees the screens, not that tenant's bill.
  const unrestricted = currentUser?.role === "superadmin";

  const shown = actions.filter(
    (a) => !a.feature || unrestricted || ent.features[a.feature],
  );
  // On the smallest plan this can empty out completely, and an empty grid
  // still costs a gap above and below it.
  if (shown.length === 0) return null;

  return (
    <nav aria-label="Shortcuts" className="grid grid-cols-3 gap-2.5 md:grid-cols-6">
      {shown.map((a) => (
        <Link
          key={a.href}
          href={a.href}
          className="wf-card flex flex-col items-center gap-2 px-2 py-3.5 text-center transition hover:border-[var(--wf-line-strong)]"
        >
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--wf-fill-2)] text-[var(--wf-fg)]">
            {a.icon}
          </span>
          {/* Wrapping is allowed and truncation is not: a clipped "Payrol" on
              a narrow phone is worse than two short lines. */}
          <span className="text-[0.74rem] font-semibold leading-tight [overflow-wrap:anywhere]">
            {a.label}
          </span>
        </Link>
      ))}
    </nav>
  );
}
