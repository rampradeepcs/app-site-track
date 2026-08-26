"use client";

/**
 * The way in for a company that does not exist yet.
 *
 * On both gates, because the two are one door: whichever backend a build is
 * talking to, somebody arriving with no account needs a way forward that is
 * not "ask whoever invited you". It sits under the sign-in button rather than
 * beside it — the overwhelming majority of arrivals are a worker signing in,
 * and signup should not compete with that.
 */

import Link from "next/link";
import { IArrowR } from "../WfIcons";

export function NewCompanyLink() {
  return (
    <Link
      href="/start"
      className="flex items-center justify-center gap-1.5 text-center text-[0.82rem] font-semibold text-[var(--wf-muted)] transition hover:text-[var(--wf-fg)]"
    >
      New here? Create your company <IArrowR size={14} />
    </Link>
  );
}
