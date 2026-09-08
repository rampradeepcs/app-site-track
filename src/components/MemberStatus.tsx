"use client";

/**
 * Where somebody has actually got to.
 *
 * The team list showed everyone as Active, which was true of the record and
 * not of the person: a membership row exists the moment an administrator
 * types a name, long before anyone signs in. An admin looking for who still
 * needs chasing could not tell a colleague who works here every day from an
 * address somebody typed last week.
 *
 * Four states, in the order they happen:
 *
 *   Invited        an invitation is out and unanswered
 *   Not activated  a record exists, nobody has signed in against it
 *   Active         they have signed in and are working
 *   Deactivated    switched off by an administrator, reversibly
 */

import { Chip } from "./ui";
import type { MemberState } from "@/lib/supabase/repository";
import type { User } from "@/lib/types";

export type MemberStage = "invited" | "not-activated" | "active" | "deactivated" | "removed";

export function memberStage(user: User, live?: MemberState): MemberStage {
  if (user.status === "revoked") return "removed";
  if (user.status === "inactive") return "deactivated";
  // Without a backend there is nothing to activate against, so a record is
  // simply a member — the local build must not label everyone "Not activated".
  if (!live) return "active";
  if (live.activated) return "active";
  return live.invited ? "invited" : "not-activated";
}

const LABEL: Record<MemberStage, string> = {
  invited: "Invited",
  "not-activated": "Not activated",
  active: "Active",
  deactivated: "Deactivated",
  removed: "Removed",
};

const TONE: Record<MemberStage, "green" | "amber" | "neutral" | "red" | "blue"> = {
  invited: "blue",
  "not-activated": "amber",
  active: "green",
  deactivated: "neutral",
  removed: "red",
};

export function MemberStatusChip({
  user,
  live,
}: {
  user: User;
  live?: MemberState;
}) {
  const stage = memberStage(user, live);
  return (
    <Chip tone={TONE[stage]}>
      {LABEL[stage]}
    </Chip>
  );
}

export { LABEL as MEMBER_STAGE_LABEL };
