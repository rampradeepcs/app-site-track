"use client";

/**
 * Ending somebody's membership of this company.
 *
 * Says what it costs before it happens, because "remove" reads like tidying
 * a list and is not: access to the site, the register, the routes and the
 * payroll all stop on the next request. It is not a deletion — their
 * attendance and payroll stay, because those are the company's records — and
 * it reaches no further than this company. Whatever else they belong to is
 * untouched, which is the whole point of the model.
 */

import { useState } from "react";
import { BottomSheet, Field } from "./ui";
import { removeMemberRemote } from "@/lib/supabase/repository";
import { describeError } from "@/lib/errors";
import { showToast } from "@/lib/toast";
import type { User } from "@/lib/types";
import { IAlert } from "./WfIcons";

export function RemoveMemberDialog({
  member,
  companyName,
  onClose,
  onRemoved,
}: {
  member: User | null;
  companyName: string;
  onClose: () => void;
  onRemoved?: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    if (!member) return;
    setBusy(true);
    try {
      await removeMemberRemote(member.id, reason.trim() || undefined);
      showToast(`${member.name} removed from ${companyName}`, "success");
      setReason("");
      onRemoved?.();
      onClose();
    } catch (e) {
      showToast(describeError(e), "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      open={!!member}
      onClose={onClose}
      title={member ? `Remove ${member.name}?` : "Remove"}
    >
      <div className="flex flex-col gap-3.5 pb-2">
        <div className="flex items-start gap-2.5 rounded-xl bg-[var(--wf-red-soft)] p-3.5">
          <IAlert size={17} className="mt-0.5 shrink-0 text-[var(--wf-red)]" />
          <p className="text-[0.82rem] leading-relaxed">
            This immediately revokes their access to {companyName} — projects,
            attendance, live tracking, routes, work updates, shifts, salary and
            company notes.
          </p>
        </div>
        <p className="text-[0.8rem] leading-relaxed text-[var(--wf-muted)]">
          Their attendance and payroll here are kept: they are this company&apos;s
          records. If they belong to other companies, those are unaffected.
        </p>
        <Field label="Reason" hint="Recorded in the audit trail.">
          <input
            className="wf-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Contract ended, left the site…"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2.5">
          <button type="button" className="wf-btn wf-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="wf-btn wf-btn-danger"
            disabled={busy}
            onClick={() => void remove()}
          >
            {busy ? "Removing…" : "Remove employee"}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
