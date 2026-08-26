"use client";

/**
 * What to do next, on a company that has just been created.
 *
 * A fresh tenant is the one state where the whole app is honestly empty:
 * no attendance, no routes, no reports, every chart a flat line. Left alone
 * that reads as a broken product rather than a new one, and the admin has no
 * way to tell which of the two it is.
 *
 * So the empty dashboard says what is missing and what closes it. It clears
 * itself the moment the first shift is recorded — the point at which the real
 * screens have something to show — rather than waiting to be dismissed, which
 * is a decision nobody should have to make about their own onboarding.
 */

import Link from "next/link";
import { useState } from "react";
import { ICheck, ICheckCircle, IArrowR, IShare, IUsers } from "../WfIcons";
import type { Project, User } from "@/lib/types";

interface Item {
  done: boolean;
  label: string;
  hint: string;
  href?: string;
  cta?: string;
}

/** Absolute URL of the app root, honouring the sub-path a Pages build uses. */
function appUrl(): string {
  if (typeof window === "undefined") return "";
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return `${window.location.origin}${base}/`;
}

export function FirstRun({
  orgName,
  projects,
  employees,
  managers,
}: {
  orgName: string;
  projects: Project[];
  employees: User[];
  managers: User[];
}) {
  const [shared, setShared] = useState<string | null>(null);

  const items: Item[] = [
    {
      done: true,
      label: `${orgName} created`,
      hint: "You're the administrator.",
    },
    {
      done: projects.length > 0,
      label:
        projects.length > 0
          ? `${projects.length} premise${projects.length === 1 ? "" : "s"} with a boundary`
          : "Add a site with a boundary",
      hint: "Nobody can check in until a boundary exists.",
      href: "/manager/projects",
      cta: "Projects",
    },
    {
      done: employees.length > 0,
      label:
        employees.length > 0
          ? `${employees.length} ${employees.length === 1 ? "person" : "people"} on the crew`
          : "Add your crew",
      hint: "They sign in with the mobile number you add.",
      href: "/admin/team",
      cta: "Team",
    },
    {
      done: managers.length > 0,
      label: managers.length > 0 ? "A manager is running the site" : "Promote a manager",
      hint: "Optional — you can run the site yourself until you'd rather not.",
      href: "/admin/team",
      cta: "Team",
    },
  ];

  const share = async () => {
    const url = appUrl();
    const text = `${orgName} is using Workfence for site attendance. Open ${url} and sign in with your mobile number.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Workfence", text, url });
        setShared("Shared.");
        return;
      }
      await navigator.clipboard.writeText(text);
      setShared("Invite message copied — paste it into WhatsApp or SMS.");
    } catch {
      // Cancelled, or neither API is permitted here. The link is on screen
      // anyway, so there is nothing to apologise for.
      setShared(null);
    }
  };

  return (
    <section className="wf-card flex flex-col gap-4 p-4">
      <header className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--wf-amber-soft)] text-[var(--wf-amber)]">
          <ICheckCircle size={20} />
        </span>
        <div className="min-w-0">
          <h2 className="wf-display text-[1.05rem] font-bold">
            Getting {orgName} running
          </h2>
          <p className="text-[0.8rem] leading-relaxed text-[var(--wf-muted)]">
            No shifts have been recorded yet — that&apos;s why every number
            below is zero. This panel goes away on the first check-in.
          </p>
        </div>
      </header>

      <ol className="flex flex-col gap-2">
        {items.map((it) => (
          <li
            key={it.label}
            className="flex items-center gap-3 rounded-xl bg-[var(--wf-surface2)] px-3 py-2.5"
          >
            <span
              aria-hidden
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${
                it.done
                  ? "border-transparent bg-[var(--wf-green)] text-[var(--wf-on-green)]"
                  : "border-[var(--wf-line-strong)] text-transparent"
              }`}
            >
              <ICheck size={13} />
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={`block text-[0.85rem] font-semibold ${
                  it.done ? "text-[var(--wf-muted)] line-through" : ""
                }`}
              >
                {it.label}
              </span>
              <span className="block text-[0.74rem] text-[var(--wf-faint)]">
                {it.hint}
              </span>
            </span>
            {!it.done && it.href ? (
              <Link
                href={it.href}
                className="wf-btn wf-btn-ghost wf-btn-sm shrink-0"
              >
                {it.cta} <IArrowR size={13} />
              </Link>
            ) : null}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        <button className="wf-btn wf-btn-primary wf-btn-sm" onClick={share}>
          <IShare size={14} /> Send the app to your crew
        </button>
        <Link href="/admin/team" className="wf-btn wf-btn-ghost wf-btn-sm">
          <IUsers size={14} /> Manage team
        </Link>
      </div>
      {shared ? (
        <p className="text-[0.76rem] text-[var(--wf-muted)]">{shared}</p>
      ) : null}
    </section>
  );
}
