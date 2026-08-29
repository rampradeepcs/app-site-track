"use client";

/**
 * Add/edit employee sheet shared by the workforce directory and the
 * manager's employee profile.
 */

import { useState } from "react";
import { useWorkforce } from "@/lib/store";
import { usePlatform } from "@/lib/platform-store";
import type { User } from "@/lib/types";
import { BottomSheet, Field, Segmented, Toggle } from "./ui";
import { phoneKey } from "./onboarding/InviteCrew";

const DEPARTMENTS = ["Civil", "MEP", "EHS", "Plant", "Quality"];

/** Where the invite points. One place to change when the listing moves. */
const APP_DOWNLOAD_URL = "https://app-site-track.vercel.app";

export function EmployeeEditor({
  editing,
  onClose,
  onSave,
}: {
  editing: User | null | "new";
  onClose: () => void;
  onSave: (patch: Partial<User> & { name: string }, id?: string) => void;
}) {
  const { state } = useWorkforce();
  const { platform } = usePlatform();
  const base = editing !== "new" && editing ? editing : null;
  const people = state.users;
  /*
   * Who the invite is from.
   *
   * A message that says "Workfence invited you" is from a company the
   * worker has never heard of; one that names their employer is from
   * someone they just met at a gate. The org record is the right source,
   * with the project's client name as a fallback for a tenant that has
   * not filled one in.
   */
  const employer =
    platform.organizations.find(
      (o) => o.id === state.users.find((u) => u.id === state.session?.userId)?.orgId,
    )?.name ??
    state.projects[0]?.client ??
    "";
  const [name, setName] = useState(base?.name ?? "");
  const [code, setCode] = useState(base?.employeeCode ?? "");
  const [designation, setDesignation] = useState(base?.designation ?? "Worker");
  const [department, setDepartment] = useState(base?.department ?? "Civil");
  const [phone, setPhone] = useState(base?.phone ?? "");
  const [projectIds, setProjectIds] = useState<string[]>(base?.projectIds ?? []);
  const [status, setStatus] = useState<User["status"]>(base?.status ?? "active");
  const [appAccess, setAppAccess] = useState(base?.appAccess ?? true);
  const [error, setError] = useState("");

  return (
    <BottomSheet
      open={editing !== null}
      onClose={onClose}
      title={base ? `Edit — ${base.name}` : "Add employee"}
      tall
    >
      <div className="flex flex-col gap-3.5">
        <Field label="Full name" required>
          <input className="wf-input" value={name} onChange={(e) => { setName(e.target.value); setError(""); }} />
        </Field>
        {error ? <p className="-mt-2 text-[0.78rem] font-semibold text-[var(--wf-red)]">{error}</p> : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Employee ID">
            <input className="wf-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="auto" />
          </Field>
          {/* Required: the phone number is the sign-in identity. Someone
              added without one exists in the roster and can never open the
              app, which is a worse outcome than refusing to save. */}
          <Field label="Phone" required>
            <input
              className="wf-input"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              maxLength={10}
              placeholder="10-digit mobile"
              value={phone}
              onChange={(e) => {
                const d = e.target.value.replace(/\D/g, "").slice(-10);
                e.target.value = d;
                setPhone(d);
                setError("");
              }}
            />
          </Field>
        </div>
        {/* App access. The number above is the identity they sign in with,
            so it doubles as the unique id across the org. */}
        <div className="wf-card2 flex items-center justify-between gap-3 px-3.5 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Access to the mobile app</p>
            <p className="mt-0.5 text-[0.72rem] leading-relaxed text-[var(--wf-muted)]">
              {appAccess
                ? "They sign in with their mobile number — it is their unique ID."
                : "They stay on the roster and are still paid, but cannot sign in."}
            </p>
          </div>
          <Toggle
            checked={appAccess}
            onChange={setAppAccess}
            label="Access to the mobile app"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Designation">
            <input className="wf-input" value={designation} onChange={(e) => setDesignation(e.target.value)} />
          </Field>
          <Field label="Department">
            <select className="wf-input" value={department} onChange={(e) => setDepartment(e.target.value)}>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Status">
          <Segmented
            ariaLabel="Employee status"
            value={status}
            onChange={setStatus}
            size="sm"
            options={[
              { value: "active", label: "Active" },
              { value: "on-leave", label: "On leave" },
              { value: "inactive", label: "Inactive" },
            ]}
          />
        </Field>
        <div>
          <span className="wf-label">Assigned projects</span>
          <div className="flex flex-col gap-2">
            {state.projects.map((p) => {
              const on = projectIds.includes(p.id);
              return (
                <button
                  key={p.id}
                  className={`flex cursor-pointer items-center justify-between rounded-xl border px-3.5 py-2.5 text-left text-sm font-semibold transition ${
                    on
                      ? "border-[var(--wf-amber)] bg-[var(--wf-amber-soft)] text-[var(--wf-amber)]"
                      : "border-[var(--wf-line)] bg-[var(--wf-surface2)] text-[var(--wf-muted)]"
                  }`}
                  onClick={() =>
                    setProjectIds((ids) =>
                      on ? ids.filter((x) => x !== p.id) : [...ids, p.id],
                    )
                  }
                >
                  {/* The name takes the room it needs and truncates; the
                      hint holds its line rather than being squeezed to one
                      word per row beside a wrapping project name. */}
                  <span className="min-w-0 truncate">{p.name}</span>
                  <span className="ml-3 shrink-0 whitespace-nowrap text-[0.68rem]">
                    {on ? "Assigned" : "Tap to assign"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <button
          className="wf-btn wf-btn-primary"
          onClick={() => {
            if (name.trim().length < 3) {
              setError("Enter the employee's full name.");
              return;
            }
            const key = phoneKey(phone);
            if (key.length !== 10) {
              setError("Enter a 10-digit mobile number — it is how they sign in.");
              return;
            }
            // Sign-in resolves a person *by* this number, so two people
            // sharing one is not a duplicate row, it is an ambiguous login.
            const clash = people.find(
              (u) => u.id !== base?.id && phoneKey(u.phone) === key,
            );
            if (clash) {
              setError(`${clash.name} already uses that number.`);
              return;
            }
            onSave(
              {
                name: name.trim(),
                employeeCode: code.trim() || undefined,
                designation,
                department,
                phone: phoneKey(phone),
                appAccess,
                projectIds,
                status,
              },
              base?.id,
            );

            /*
             * Hand the invite to WhatsApp with the message written, and let
             * the admin press send there.
             *
             * Deliberately not sent for them: this is a message going out
             * under their name to a real person's phone, and composing it
             * is the part software should do. It also means no gateway,
             * no credentials and no delivery to get wrong — WhatsApp is
             * already on the phone of everyone this is aimed at.
             */
            if (appAccess && !base?.appAccess) {
              const text = encodeURIComponent(
                `Hi ${name.trim().split(" ")[0]},\n\n` +
                  `${employer || "Your employer"} has invited you to join them on Workfence — ` +
                  `the app they use for site attendance.\n\n` +
                  `Install the app: ${APP_DOWNLOAD_URL}\n\n` +
                  `Sign in with this number (${phoneKey(phone)}) — it is your ID.`,
              );
              window.open(
                `https://wa.me/91${phoneKey(phone)}?text=${text}`,
                "_blank",
                "noopener",
              );
            }
          }}
        >
          {base ? "Save changes" : "Add employee"}
        </button>
      </div>
    </BottomSheet>
  );
}
