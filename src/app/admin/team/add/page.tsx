"use client";

/**
 * Adding people to the company, after the first day.
 *
 * The same screen the founder used at signup, reached from Team & Roles —
 * type a name and address, or take them from the phone's contacts. There was
 * no reason for the two to be different screens, and every reason for them
 * not to be: the crew step is where the contact picker and the inline
 * address field already live, and a second implementation would be a second
 * place for them to drift.
 *
 * What happens on save is the part that differs. At signup the crew are
 * written into the company being created; here they are invited, because the
 * company already exists and the people may already have a Workfence
 * account — in which case they join it as themselves rather than as a
 * second identity.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { InviteCrew } from "@/components/onboarding/InviteCrew";
import { ScreenHeader } from "@/components/shell";
import { DISCARD_CREW, confirmDestructive } from "@/lib/confirm";
import { Field } from "@/components/ui";
import { useMyCompanies } from "@/lib/companies";
import { useWorkforce, type CrewInvite } from "@/lib/store";
import { isLiveBackend } from "@/lib/supabase/client";
import { demoActive } from "@/lib/demo/mode";
import { inviteCrewRemote, inviteMemberRemote } from "@/lib/supabase/repository";
import { activeCompanyId } from "@/lib/company";
import { describeError } from "@/lib/errors";
import { showToast } from "@/lib/toast";
import type { Role } from "@/lib/types";
import { IArrowR, ICheck } from "@/components/WfIcons";
import { useUnsavedGuard } from "@/lib/unsaved";

export default function AddPeoplePage() {
  const { state, currentUser, saveEmployee, reloadFromBackend } = useWorkforce();
  const { active } = useMyCompanies();
  const router = useRouter();

  const [crew, setCrew] = useState<CrewInvite[]>([]);
  const [role, setRole] = useState<Role>("employee");
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  /*
   * The list, and only the list.
   *
   * Join as and Project are the screen's own defaults and cost one tap each
   * to set again, and with nobody on the list the send button is disabled —
   * so nothing could have been created and there is nothing to lose. It
   * stays true after a partial send, where the rows that failed are left on
   * screen beside the reason: that list is then the only record of which
   * invitations did not go.
   */
  const dirty = crew.length > 0;
  const confirmBack = useUnsavedGuard({
    dirty,
    message: DISCARD_CREW,
    onLeave: () => router.replace("/admin/team"),
  });

  const live = isLiveBackend && !demoActive();
  const isOwner = currentUser?.role === "admin";
  const companyName = active?.name ?? "this company";

  const send = async () => {
    if (crew.length === 0) return;
    setBusy(true);
    setResult(null);
    try {
      if (!live) {
        /*
         * No backend to invite through: write the records straight in, which
         * is what the local build has always done. They can sign in later
         * against a real one and claim the row that carries their address.
         */
        for (const c of crew) {
          saveEmployee({
            name: c.name,
            email: c.email ?? "",
            phone: c.phone ?? "",
            designation: c.designation || "Worker",
            role,
          });
        }
        showToast(`Added ${crew.length} to ${companyName}`, "success");
        router.replace("/admin/team");
        return;
      }

      // One at a time, and each failure named: a mistyped address in the
      // fourth row must not throw away the three that were fine.
      const failed: string[] = [];
      const invitedEmails: string[] = [];
      let sent = 0;
      let existing = 0;
      for (const c of crew) {
        try {
          const out = await inviteMemberRemote({
            email: (c.email ?? "").trim(),
            name: c.name,
            phone: c.phone,
            role,
            designation: c.designation,
            projectId: projectId || null,
          });
          sent += 1;
          invitedEmails.push(out.email);
          if (out.existingUser) existing += 1;
        } catch (e) {
          failed.push(`${c.email || c.name}: ${describeError(e)}`);
        }
      }

      /*
       * The memberships exist now; this is the part the crew actually sees —
       * the web address and the Android app, in one letter each.
       *
       * Sent in a single call for everybody who made it, and never allowed to
       * fail the whole screen: recording somebody and writing to them are
       * separate acts, and a refused mail server must not undo a row that was
       * written. What could not be sent is said plainly instead.
       */
      let unmailed = 0;
      const org = activeCompanyId();
      if (org && invitedEmails.length) {
        try {
          const mail = await inviteCrewRemote(org, invitedEmails);
          unmailed = mail.failed;
        } catch (e) {
          unmailed = invitedEmails.length;
          console.warn("[workfence] invitation emails failed:", describeError(e));
        }
      }

      await reloadFromBackend();

      if (sent > 0 && failed.length === 0) {
        showToast(
          `Invited ${sent} to ${companyName}${
            existing > 0 ? ` — ${existing} already had a Workfence account` : ""
          }${unmailed > 0 ? ` · ${unmailed} could not be emailed` : ""}`,
          unmailed > 0 ? "info" : "success",
        );
        router.replace("/admin/team");
        return;
      }
      setCrew((list) => list.filter((c) => failed.some((f) => f.startsWith(`${c.email || c.name}:`))));
      setResult(
        sent > 0
          ? `Invited ${sent}. These did not go: ${failed.join(" · ")}`
          : `Nothing was invited. ${failed.join(" · ")}`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <ScreenHeader
        back="/admin/team"
        /* A list of people typed in one at a time and not yet sent. */
        confirmBack={confirmBack}
        title="Add people"
        sub={live ? "They are invited to join this company" : "Added to this company"}
        /* Just the send. The bar's back control returns to Team & Roles,
           which is all Cancel did. */
        action={
          <button
            type="button"
            className="wf-btn wf-btn-primary"
            disabled={busy || crew.length === 0}
            onClick={() => void send()}
          >
            {busy ? (
              "Sending…"
            ) : (
              <>
                <ICheck size={16} /> {live ? "Send" : "Add"}
                {crew.length > 0 ? ` ${crew.length}` : ""}
              </>
            )}
          </button>
        }
      />
      <div className="flex flex-col gap-4 px-4 pb-8">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Join as">
            <select
              className="wf-input"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              <option value="employee">Employee</option>
              {isOwner ? <option value="manager">Manager</option> : null}
              {isOwner ? <option value="admin">Owner / Admin</option> : null}
            </select>
          </Field>
          <Field label="Project" hint="Optional.">
            <select
              className="wf-input"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">None yet</option>
              {state.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {/* The crew step from onboarding, unchanged: type them in, or take
            them from the phone's contacts. */}
        <InviteCrew invites={crew} onChange={setCrew} />

        {result ? (
          <p className="text-[0.8rem] leading-relaxed font-semibold text-[var(--wf-amber)]">
            {result}
          </p>
        ) : null}

        {live ? (
          <p className="text-[0.74rem] leading-relaxed text-[var(--wf-faint)]">
            Somebody who already has a Workfence account joins {companyName} as
            themselves — one account, another company — rather than getting a
            second one. Nobody is added until they accept.
          </p>
        ) : null}

        {/*
          A button rather than a Link, because a Link leaves before anything
          can ask. It is the same journey as the back control above and has
          to ask the same question — a guard that one of two identical exits
          honours is not a guard.
        */}
        <button
          type="button"
          onClick={() => {
            const go = () => router.push("/admin/team");
            if (dirty) confirmDestructive(DISCARD_CREW, go);
            else go();
          }}
          className="flex items-center justify-center gap-1.5 text-[0.8rem] font-semibold text-[var(--wf-muted)]"
        >
          Back to Team &amp; Roles <IArrowR size={14} />
        </button>
      </div>
    </div>
  );
}
