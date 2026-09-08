"use client";

/**
 * Asking somebody to join this company.
 *
 * Not the same as adding an employee row, which is what this screen used to
 * do and still does for a crew that will never sign in. An invitation goes
 * to a person: if they already have a Workfence account it becomes a second
 * membership on the identity they already have, and if they do not, one is
 * made when they accept. Either way nobody is added to a company without
 * agreeing to it.
 */

import { useState } from "react";
import { BottomSheet, Field } from "./ui";
import { useWorkforce } from "@/lib/store";
import { inviteMemberRemote } from "@/lib/supabase/repository";
import { describeError } from "@/lib/errors";
import { showToast } from "@/lib/toast";
import type { Role } from "@/lib/types";
import { ICheck } from "./WfIcons";

export function InviteMemberSheet({
  open,
  onClose,
  onInvited,
}: {
  open: boolean;
  onClose: () => void;
  onInvited?: () => void;
}) {
  const { state, currentUser } = useWorkforce();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<Role>("employee");
  const [designation, setDesignation] = useState("");
  const [department, setDepartment] = useState("Site");
  const [projectId, setProjectId] = useState("");
  const [shiftId, setShiftId] = useState("");
  const [employmentType, setEmploymentType] = useState("full-time");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // A manager may bring in workers; only an owner may bring in another
  // manager or owner. The database enforces this too — this only spares
  // somebody filling in a form that will be refused.
  const isOwner = currentUser?.role === "admin";

  const reset = () => {
    setEmail("");
    setName("");
    setPhone("");
    setRole("employee");
    setDesignation("");
    setDepartment("Site");
    setProjectId("");
    setShiftId("");
    setEmploymentType("full-time");
    setError("");
  };

  const send = async () => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    try {
      const out = await inviteMemberRemote({
        email: email.trim(),
        name: name.trim(),
        phone: phone.trim(),
        role,
        designation: designation.trim(),
        department: department.trim(),
        projectId: projectId || null,
        shiftId: shiftId || null,
        employmentType,
      });
      showToast(
        out.existingUser
          ? `${out.email} already has a Workfence account — invited to join this company`
          : `Invitation sent to ${out.email}`,
        "success",
      );
      reset();
      onInvited?.();
      onClose();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="Invite to this company" tall>
      <div className="flex flex-col gap-3.5 pb-2">
        <Field label="Email address" required hint="Where the invitation goes, and how they sign in.">
          <input
            className="wf-input"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError("");
            }}
            placeholder="name@company.com"
          />
        </Field>
        {error ? (
          <p className="-mt-2 text-[0.78rem] font-semibold text-[var(--wf-red)]">{error}</p>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <input className="wf-input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Phone">
            <input
              className="wf-input"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Role">
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
          <Field label="Employment">
            <select
              className="wf-input"
              value={employmentType}
              onChange={(e) => setEmploymentType(e.target.value)}
            >
              <option value="full-time">Full time</option>
              <option value="contract">Contract</option>
              <option value="daily-wage">Daily wage</option>
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Designation">
            <input
              className="wf-input"
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
              placeholder="Mason, Site Engineer…"
            />
          </Field>
          <Field label="Department">
            <input
              className="wf-input"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Project" hint="They join it as soon as they accept.">
          <select
            className="wf-input"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">No project yet</option>
            {state.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>

        {state.shifts.length > 0 ? (
          <Field label="Shift">
            <select
              className="wf-input"
              value={shiftId}
              onChange={(e) => setShiftId(e.target.value)}
            >
              <option value="">Company default</option>
              {state.shifts.map((sh) => (
                <option key={sh.id} value={sh.id}>
                  {sh.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <div className="mt-1 grid grid-cols-2 gap-2.5">
          <button type="button" className="wf-btn wf-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="wf-btn wf-btn-primary"
            disabled={busy}
            onClick={() => void send()}
          >
            <ICheck size={16} /> {busy ? "Sending…" : "Send invitation"}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
