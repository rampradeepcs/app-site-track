"use client";

/**
 * The app needs a company, and a worker needs a site.
 *
 * Signed in is not the same as having somewhere to be. Somebody can hold a
 * valid account and belong to no company at all, and a worker can belong to
 * a company that has not put them on a site yet — which is what happens when
 * an invitation is sent without one. Until now both walked in and met a
 * dashboard of zeroes, or an empty state with a working tab bar above four
 * more empty screens, and had to work out for themselves that nothing was
 * broken and nothing was theirs to fix.
 *
 * Like PlanExpired, this is returned *instead of* the app rather than
 * floated over it: there is no overlay to dismiss and nothing rendered
 * behind it to reach. Unlike PlanExpired it is not a punishment, and the
 * words matter more because of that — the person reading this has done
 * nothing wrong and usually cannot fix it themselves.
 *
 * ── what it deliberately does NOT take away ──────────────────────────────
 *
 * A worker rolled off a finished site keeps their own records. Their
 * attendance, their history and their privacy controls are theirs, they are
 * the evidence in a pay dispute, and none of it needs a current project to
 * make sense. The guard lets those routes through and this screen links to
 * them. Taking somebody's own timesheet away because a manager has not
 * re-rostered them would be a worse bug than the one this fixes.
 */

import Link from "next/link";
import { useState } from "react";
import { useWorkforce } from "@/lib/store";
import { IBuilding, IHardHat, IArrowR } from "./WfIcons";

export type EntryBlock =
  /** Signed in, belongs to no company. */
  | { kind: "no-company" }
  /** In a company, but on no site — only ever raised for an employee. */
  | { kind: "no-project"; orgName: string };

export function EntryRequired({ block }: { block: EntryBlock }) {
  const { logout } = useWorkforce();
  // The sign-out is a network call before the local token goes, so the press
  // is answered immediately rather than looking ignored on a site phone.
  const [leaving, setLeaving] = useState(false);

  const noCompany = block.kind === "no-company";

  return (
    <div
      role="alertdialog"
      aria-labelledby="entry-required-title"
      className="grid min-h-[calc(100dvh-var(--wf-safe-top))] place-items-center px-5 py-10"
    >
      <div className="flex w-full max-w-md flex-col items-center gap-5 text-center">
        <span className="grid h-16 w-16 place-items-center rounded-2xl bg-[var(--wf-fill-2)] text-[var(--wf-muted)]">
          {noCompany ? <IBuilding size={28} /> : <IHardHat size={28} />}
        </span>

        <div className="flex flex-col gap-2">
          <h1 id="entry-required-title" className="wf-display text-[1.5rem] leading-tight">
            {noCompany ? "You are not in a company yet" : "You are not on a site yet"}
          </h1>
          {!noCompany && block.orgName ? (
            <p className="text-[0.92rem] font-semibold text-[var(--wf-muted)]">
              {block.orgName}
            </p>
          ) : null}
        </div>

        <p className="text-[0.88rem] leading-relaxed text-[var(--wf-muted)]">
          {noCompany
            ? "Workfence runs one company at a time, and your account is not in one. If you were sent an invitation it will be waiting below; otherwise the person who asked you to sign up can add you."
            : "Attendance is recorded at a site boundary, so there is nothing to open until somebody puts you on one. Your manager can do it in a moment — nothing else is needed from you."}
        </p>

        <div className="flex w-full flex-col gap-2 pt-1">
          {noCompany ? (
            <Link className="wf-btn wf-btn-primary" href="/invitations">
              View invitations <IArrowR size={14} />
            </Link>
          ) : (
            /* Their own record, which this screen does not take away. */
            <Link className="wf-btn wf-btn-ghost" href="/employee/history">
              Your shift history
            </Link>
          )}
          {/* Outside the guard either way, so it is reachable from here — and
              somebody who belongs to two companies may only be stranded by
              one of them. */}
          <Link className="wf-btn wf-btn-ghost" href="/companies">
            {noCompany ? "Companies" : "Switch company"}
          </Link>
          <button
            className="wf-btn wf-btn-ghost"
            disabled={leaving}
            onClick={() => {
              setLeaving(true);
              void logout();
            }}
          >
            {leaving ? "Signing out…" : "Sign out"}
          </button>
        </div>

        <p className="text-[0.76rem] leading-relaxed text-[var(--wf-faint)]">
          {noCompany
            ? "Nothing is missing from your account — it simply has no company attached."
            : "This clears itself the moment you are added, without signing in again."}
        </p>
      </div>
    </div>
  );
}
