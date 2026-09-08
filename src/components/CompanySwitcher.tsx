"use client";

/**
 * Which company you are in, and how to leave it.
 *
 * Always visible, because the cost of not knowing is a shift booked against
 * the wrong employer — a mistake nobody notices until payroll. The current
 * company is a label first and a control second: most people belong to one
 * and should see its name, not a menu they never open.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BottomSheet } from "./ui";
import { useMyCompanies } from "@/lib/companies";
import { useWorkforce } from "@/lib/store";
import { isLiveBackend } from "@/lib/supabase/client";
import { demoActive } from "@/lib/demo/mode";
import { describeError } from "@/lib/errors";
import { homeFor } from "@/lib/routes";
import { showToast } from "@/lib/toast";
import { ICheck, IChevronD, IPlus } from "./WfIcons";

const ROLE_WORD: Record<string, string> = {
  admin: "Owner",
  manager: "Manager",
  employee: "Employee",
  superadmin: "Platform",
};

export function CompanySwitcher({ compact = false }: { compact?: boolean }) {
  const { companies, active } = useMyCompanies();
  const { switchCompany } = useWorkforce();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Demo personas are not memberships, and the local build has no companies
  // to move between. Showing a switcher there would be a control that lies.
  if (!isLiveBackend || demoActive()) return null;
  const live = (companies ?? []).filter((c) => c.status !== "revoked");
  if (live.length === 0) return null;

  const name = active?.name ?? live[0]?.name ?? "";
  const only = live.length === 1;

  const go = async (orgId: string, label: string) => {
    if (orgId === active?.orgId) {
      setOpen(false);
      return;
    }
    setBusy(orgId);
    try {
      const me = await switchCompany(orgId, label);
      setOpen(false);
      // Their role may differ here, so the home screen may too.
      router.replace(homeFor(me.role));
    } catch (e) {
      showToast(describeError(e), "danger");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <button
        type="button"
        className={`flex max-w-full items-center gap-1.5 rounded-full border border-[var(--wf-line)] bg-[var(--wf-fill-2)] px-2.5 py-1 text-left ${
          only ? "cursor-default" : "cursor-pointer hover:bg-[var(--wf-fill-3)]"
        }`}
        aria-label={only ? `Company: ${name}` : "Switch company"}
        onClick={() => {
          if (!only) setOpen(true);
        }}
      >
        <span
          className={`truncate font-bold ${compact ? "text-[0.72rem]" : "text-[0.78rem]"}`}
        >
          {name}
        </span>
        {only ? null : <IChevronD size={13} className="shrink-0 text-[var(--wf-muted)]" />}
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} title="Your companies">
        <div className="flex flex-col gap-2 pb-2">
          {live.map((c) => {
            const current = c.orgId === active?.orgId;
            return (
              <button
                key={c.orgId}
                type="button"
                disabled={busy !== null}
                className="wf-card2 flex items-center gap-3 px-3.5 py-3 text-left disabled:opacity-60"
                onClick={() => void go(c.orgId, c.name)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.9rem] font-bold">{c.name}</span>
                  <span className="block truncate text-[0.74rem] text-[var(--wf-muted)]">
                    {ROLE_WORD[c.role] ?? c.role}
                    {c.activeProjects > 0
                      ? ` · ${c.activeProjects} active ${c.activeProjects === 1 ? "project" : "projects"}`
                      : ""}
                  </span>
                </span>
                {busy === c.orgId ? (
                  <span className="text-[0.72rem] font-semibold text-[var(--wf-muted)]">
                    Switching…
                  </span>
                ) : current ? (
                  <ICheck size={18} className="shrink-0 text-[var(--wf-green)]" />
                ) : null}
              </button>
            );
          })}
          <button
            type="button"
            className="wf-btn wf-btn-ghost mt-1"
            onClick={() => {
              setOpen(false);
              router.push("/start?another=1");
            }}
          >
            <IPlus size={15} /> Create company
          </button>
        </div>
      </BottomSheet>
    </>
  );
}
