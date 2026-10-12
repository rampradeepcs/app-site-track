"use client";

/**
 * Companies asking you to join them.
 *
 * Each is decided on its own: accepting one says nothing about the others,
 * and declining is a real answer rather than a way of postponing. Nothing
 * here grants access — accepting creates the membership, and the database
 * makes it from the invitation, not from anything this screen sends.
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ScreenHeader } from "@/components/shell";
import { Avatar, Chip } from "@/components/ui";
import {
  acceptInvitationRemote,
  declineInvitationRemote,
  fetchMyInvitations,
  type CompanyInvitation,
} from "@/lib/supabase/repository";
import {
  ROUTE_FOR,
  refreshMyCompanies,
  resolveSignInDestination,
  snoozeInvitations,
  useMyCompanies,
} from "@/lib/companies";
import { useWorkforce } from "@/lib/store";
import { describeError } from "@/lib/errors";
import { fmtDateLong, roleTone } from "@/lib/format";
import { homeFor, landingFor } from "@/lib/routes";
import { showToast } from "@/lib/toast";
import { IArrowR, IBell } from "@/components/WfIcons";

const ROLE_WORD: Record<string, string> = {
  admin: "Owner",
  manager: "Manager",
  employee: "Employee",
};

export default function InvitationsPage() {
  const { state, enterCompany } = useWorkforce();
  const router = useRouter();
  const [list, setList] = useState<CompanyInvitation[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /* Somebody already in a company was brought here at sign-in to be asked
     about another one. They have somewhere to go, and "not now" is an
     answer they are owed — without it, the only ways out were to accept,
     to decline, or to go back to a gate that would send them here again. */
  /* A live membership, not merely a session: somebody whose only company
     removed them has a session and nowhere to continue to, and offering
     them "continue to your company" sent them round in a circle. */
  const { companies } = useMyCompanies();
  const member = !!state.session && (companies ?? []).some((c) => c.status !== "revoked");

  const notNow = async () => {
    snoozeInvitations((list ?? []).map((i) => i.id));
    const role = state.session?.role;
    if (!role) {
      router.replace("/companies");
      return;
    }
    try {
      // As if nothing were waiting: the answer must not be this screen.
      const to = await resolveSignInDestination({ skipInvitations: true });
      router.replace(
        to.kind === "enter"
          ? landingFor(role)
          : to.kind === "invitations"
            ? "/companies"
            : ROUTE_FOR[to.kind],
      );
    } catch {
      router.replace(landingFor(role));
    }
  };

  const load = useCallback(() => {
    void fetchMyInvitations()
      .then(setList)
      .catch((e) => {
        setList([]);
        showToast(describeError(e), "danger");
      });
  }, []);
  useEffect(load, [load]);

  const accept = async (inv: CompanyInvitation) => {
    setBusy(inv.id);
    try {
      await acceptInvitationRemote(inv.id);
      await refreshMyCompanies();
      showToast(`You have joined ${inv.company}`, "success");
      const me = await enterCompany(inv.orgId);
      router.replace(homeFor(me.role));
    } catch (e) {
      showToast(describeError(e), "danger");
      setBusy(null);
      load();
    }
  };

  const decline = async (inv: CompanyInvitation) => {
    setBusy(inv.id);
    try {
      await declineInvitationRemote(inv.id);
      showToast(`Declined ${inv.company}`);
      setList((l) => (l ?? []).filter((i) => i.id !== inv.id));
    } catch (e) {
      showToast(describeError(e), "danger");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <ScreenHeader
        back
        /* For a member, back is "not now": the gate behind this screen
           would only bring them straight here again. */
        onBack={member ? () => void notNow() : undefined}
        title="Invitations"
        sub="Companies asking you to join"
      />
      <div className="flex flex-col gap-3 px-4 pb-8">
        {list === null ? (
          <p className="py-10 text-center text-sm text-[var(--wf-muted)]">Loading…</p>
        ) : list.length === 0 ? (
          <div className="wf-card flex flex-col items-center gap-3 p-6 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[var(--wf-fill-3)] text-[var(--wf-muted)]">
              <IBell size={24} />
            </span>
            <p className="wf-display text-lg">No invitations</p>
            <p className="text-[0.84rem] leading-relaxed text-[var(--wf-muted)]">
              When a company invites you, it will appear here.
            </p>
            <Link href="/companies" className="wf-btn wf-btn-ghost w-full">
              Your companies <IArrowR size={15} />
            </Link>
            <Link
              href={member ? "/start?another=1" : "/start"}
              className="wf-btn wf-btn-ghost w-full"
            >
              Set up your own company
            </Link>
          </div>
        ) : (
          list.map((inv) => (
            <div key={inv.id} className="wf-card flex flex-col gap-3 p-4">
              <div className="flex items-center gap-3">
                <Avatar name={inv.company} hue={(inv.company.length * 47) % 360} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.95rem] font-bold">{inv.company}</p>
                  <p className="truncate text-[0.76rem] text-[var(--wf-muted)]">
                    as {inv.designation || ROLE_WORD[inv.role] || inv.role}
                    {inv.project ? ` · ${inv.project}` : ""}
                  </p>
                </div>
                <Chip tone={roleTone(inv.role)}>
                  {ROLE_WORD[inv.role] ?? inv.role}
                </Chip>
              </div>
              <p className="text-[0.78rem] leading-relaxed text-[var(--wf-muted)]">
                You&apos;ve been invited to join {inv.company}
                {inv.invitedBy ? ` by ${inv.invitedBy}` : ""}.
              </p>
              <p className="text-[0.7rem] text-[var(--wf-faint)]">
                Invited {fmtDateLong(inv.createdAt.slice(0, 10))} · expires{" "}
                {fmtDateLong(inv.expiresAt.slice(0, 10))}
              </p>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  className="wf-btn wf-btn-ghost"
                  disabled={busy !== null}
                  onClick={() => void decline(inv)}
                >
                  Decline
                </button>
                <button
                  type="button"
                  className="wf-btn wf-btn-primary"
                  disabled={busy !== null}
                  onClick={() => void accept(inv)}
                >
                  {busy === inv.id ? "Joining…" : "Accept"}
                </button>
              </div>
            </div>
          ))
        )}

        {/*
          Secondary on purpose, and only once there is something to be
          secondary to. Somebody holding an invitation almost always means to
          accept it; the small number who were invited and are also setting up
          their own firm should not have to decline first to find the door.
        */}
        {list && list.length > 0 && member ? (
          <button type="button" className="wf-btn wf-btn-ghost" onClick={() => void notNow()}>
            Not now — continue to your company
          </button>
        ) : null}
        {list && list.length > 0 ? (
          <Link
            href={member ? "/start?another=1" : "/start"}
            className="mt-1 text-center text-[0.78rem] text-[var(--wf-muted)] underline underline-offset-4"
          >
            Or set up your own company instead
          </Link>
        ) : null}
      </div>
    </div>
  );
}
