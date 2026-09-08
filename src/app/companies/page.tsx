"use client";

/**
 * Which company would you like to work with?
 *
 * Shown when somebody belongs to more than one and this device does not
 * remember which — and as the empty state for somebody who belongs to none.
 * Deliberately a decision, not a default: entering the wrong company is how
 * a shift gets booked against the wrong employer, and nobody notices until
 * payroll.
 */

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ScreenHeader } from "@/components/shell";
import { Avatar } from "@/components/ui";
import { loadMyCompanies } from "@/lib/companies";
import { fetchMyInvitations, type CompanyInvitation, type CompanyMembership } from "@/lib/supabase/repository";
import { useWorkforce } from "@/lib/store";
import { describeError } from "@/lib/errors";
import { homeFor } from "@/lib/routes";
import { showToast } from "@/lib/toast";
import { IArrowR, IBuilding, IPlus } from "@/components/WfIcons";
import Link from "next/link";

const ROLE_WORD: Record<string, string> = {
  admin: "Owner",
  manager: "Manager",
  employee: "Employee",
  superadmin: "Platform",
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function CompaniesPage() {
  const { state, currentUser, enterCompany } = useWorkforce();
  const router = useRouter();
  const [companies, setCompanies] = useState<CompanyMembership[] | null>(null);
  const [invitations, setInvitations] = useState<CompanyInvitation[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    void loadMyCompanies(true)
      .then((list) => {
        if (!off) setCompanies(list.filter((c) => c.status !== "revoked"));
      })
      .catch((e) => {
        if (!off) {
          setCompanies([]);
          showToast(describeError(e), "danger");
        }
      });
    void fetchMyInvitations()
      .then((inv) => {
        if (!off) setInvitations(inv);
      })
      .catch(() => {});
    return () => {
      off = true;
    };
  }, []);

  const enter = async (c: CompanyMembership) => {
    setBusy(c.orgId);
    try {
      const me = await enterCompany(c.orgId);
      router.replace(homeFor(me.role));
    } catch (e) {
      showToast(describeError(e), "danger");
      setBusy(null);
    }
  };

  const name = currentUser?.name ?? state.session ? currentUser?.name : null;

  return (
    <div>
      <ScreenHeader title="Choose company" sub={name ? `${greeting()}, ${name.split(" ")[0]}` : undefined} />
      <div className="flex flex-col gap-4 px-4 pb-8">
        {companies === null ? (
          <p className="py-10 text-center text-sm text-[var(--wf-muted)]">Loading your companies…</p>
        ) : companies.length === 0 ? (
          <div className="wf-card flex flex-col items-center gap-3 p-6 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[var(--wf-fill-3)] text-[var(--wf-muted)]">
              <IBuilding size={26} />
            </span>
            <p className="wf-display text-lg">No active companies</p>
            <p className="text-[0.84rem] leading-relaxed text-[var(--wf-muted)]">
              Your Workfence account is not part of any company right now. When
              one invites you it will appear here.
            </p>
            {invitations.length > 0 ? (
              <Link href="/invitations" className="wf-btn wf-btn-primary w-full">
                {invitations.length} pending{" "}
                {invitations.length === 1 ? "invitation" : "invitations"} <IArrowR size={16} />
              </Link>
            ) : null}
            <Link href="/start?another=1" className="wf-btn wf-btn-ghost w-full">
              <IPlus size={15} /> Create a company
            </Link>
          </div>
        ) : (
          <>
            <p className="text-[0.84rem] text-[var(--wf-muted)]">
              Which company would you like to work with?
            </p>
            {companies.map((c) => (
              <button
                key={c.orgId}
                type="button"
                disabled={busy !== null}
                className="wf-card flex items-center gap-3 p-4 text-left disabled:opacity-60"
                onClick={() => void enter(c)}
              >
                <Avatar name={c.name} hue={(c.name.length * 47) % 360} size={42} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.95rem] font-bold">{c.name}</span>
                  <span className="block truncate text-[0.78rem] text-[var(--wf-muted)]">
                    {ROLE_WORD[c.role] ?? c.role}
                    {c.designation ? ` · ${c.designation}` : ""}
                  </span>
                  <span className="mt-0.5 block text-[0.72rem] text-[var(--wf-faint)]">
                    {c.activeProjects} active {c.activeProjects === 1 ? "project" : "projects"}
                  </span>
                </span>
                <span className="shrink-0 text-[0.76rem] font-semibold text-[var(--wf-amber)]">
                  {busy === c.orgId ? "Opening…" : "Enter"}
                </span>
              </button>
            ))}
            {invitations.length > 0 ? (
              <Link href="/invitations" className="wf-card2 flex items-center gap-2 px-3.5 py-3">
                <span className="min-w-0 flex-1 text-[0.84rem] font-semibold">
                  {invitations.length} pending{" "}
                  {invitations.length === 1 ? "invitation" : "invitations"}
                </span>
                <IArrowR size={15} className="text-[var(--wf-muted)]" />
              </Link>
            ) : null}
            <Link href="/start?another=1" className="wf-btn wf-btn-ghost">
              <IPlus size={15} /> Create company
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
