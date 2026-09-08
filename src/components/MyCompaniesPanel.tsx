"use client";

/**
 * Every company this person belongs to, and any asking them to join.
 *
 * The global view, distinct from the company's own employee list: this is
 * "my companies", not "my colleagues". It sits on the More screen where the
 * account already lives, because that is the one part of the app that is
 * about the person rather than about the company they are working in.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Chip, SectionTitle } from "./ui";
import { useMyCompanies } from "@/lib/companies";
import { useWorkforce } from "@/lib/store";
import { isLiveBackend } from "@/lib/supabase/client";
import { demoActive } from "@/lib/demo/mode";
import { fetchMyInvitations } from "@/lib/supabase/repository";
import { describeError } from "@/lib/errors";
import { homeFor } from "@/lib/routes";
import { showToast } from "@/lib/toast";
import { IArrowR, ICheck, IPlus } from "./WfIcons";

const ROLE_WORD: Record<string, string> = {
  admin: "Owner",
  manager: "Manager",
  employee: "Employee",
  superadmin: "Platform",
};

export function MyCompaniesPanel() {
  const { companies, active } = useMyCompanies();
  const { switchCompany } = useWorkforce();
  const router = useRouter();
  const [invites, setInvites] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!isLiveBackend || demoActive()) return;
    void fetchMyInvitations()
      .then((i) => setInvites(i.length))
      .catch(() => {});
  }, []);

  if (!isLiveBackend || demoActive()) return null;
  const live = (companies ?? []).filter((c) => c.status !== "revoked");
  if (live.length === 0 && invites === 0) return null;

  const go = async (orgId: string, name: string) => {
    if (orgId === active?.orgId) return;
    setBusy(orgId);
    try {
      const me = await switchCompany(orgId, name);
      router.replace(homeFor(me.role));
    } catch (e) {
      showToast(describeError(e), "danger");
      setBusy(null);
    }
  };

  return (
    <div className="wf-card flex flex-col gap-2 p-4">
      <SectionTitle>My companies</SectionTitle>
      {live.map((c) => (
        <button
          key={c.orgId}
          type="button"
          disabled={busy !== null}
          className="wf-card2 flex items-center gap-3 px-3.5 py-2.5 text-left disabled:opacity-60"
          onClick={() => void go(c.orgId, c.name)}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.86rem] font-bold">{c.name}</span>
            <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
              {ROLE_WORD[c.role] ?? c.role}
              {c.designation ? ` · ${c.designation}` : ""}
            </span>
          </span>
          {busy === c.orgId ? (
            <span className="text-[0.7rem] font-semibold text-[var(--wf-muted)]">Switching…</span>
          ) : c.orgId === active?.orgId ? (
            <Chip tone="green">
              <ICheck size={12} /> Current
            </Chip>
          ) : (
            <IArrowR size={15} className="shrink-0 text-[var(--wf-muted)]" />
          )}
        </button>
      ))}
      {invites > 0 ? (
        <Link href="/invitations" className="wf-card2 flex items-center gap-2 px-3.5 py-2.5">
          <span className="min-w-0 flex-1 text-[0.82rem] font-semibold">
            {invites} pending {invites === 1 ? "invitation" : "invitations"}
          </span>
          <IArrowR size={15} className="text-[var(--wf-muted)]" />
        </Link>
      ) : null}
      <Link href="/start?another=1" className="wf-btn wf-btn-ghost wf-btn-sm mt-1">
        <IPlus size={14} /> Create company
      </Link>
    </div>
  );
}
