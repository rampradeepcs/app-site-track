"use client";

/**
 * Adding or editing a person, on a screen.
 *
 * It was a sheet, shared by the workforce directory and the employee
 * profile. Nine fields and a project roster is not a sheet — it is a screen
 * that dismissed itself on a downward flick while somebody was still typing
 * into it, and the flick starts under the same thumb.
 *
 * The form takes the person and where to return to, and nothing else: it
 * reads the store and saves to it itself, because the routes that render it
 * have no parent to pass callbacks down.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkforce } from "@/lib/store";
import { usePlatform } from "@/lib/platform-store";
import type { User } from "@/lib/types";
import { ScreenHeader } from "./shell";
import { Field, FormError, Segmented, Toggle } from "./ui";
import { DISCARD_EDITS, DISCARD_PERSON } from "@/lib/confirm";
import { phoneKey } from "./onboarding/InviteCrew";
import { useUnsavedGuard } from "@/lib/unsaved";

const DEPARTMENTS = ["Civil", "MEP", "EHS", "Plant", "Quality"];

/** Where the invite points. One place to change when the listing moves. */
const APP_DOWNLOAD_URL = "https://app-site-track.vercel.app";

export function EmployeeForm({
  base,
  backTo,
}: {
  /** The person being edited, or null when this is a new one. */
  base: User | null;
  /** Where back and a finished save both land. */
  backTo: string;
}) {
  const router = useRouter();
  const { saveEmployee } = useWorkforce();
  const { state } = useWorkforce();
  const { platform } = usePlatform();
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
  const [email, setEmail] = useState(base?.email ?? "");
  const [projectIds, setProjectIds] = useState<string[]>(base?.projectIds ?? []);
  const [status, setStatus] = useState<User["status"]>(base?.status ?? "active");
  const [appAccess, setAppAccess] = useState(base?.appAccess ?? true);
  const [error, setError] = useState("");

  /*
   * One component, two jobs, so two meanings of dirty.
   *
   * Editing somebody opens on their saved values, and a change is a
   * difference from those. Adding somebody opens on defaults the sheet
   * chose — Worker, Civil, active, app access on — and only what was typed
   * counts, or the sheet would ask on its way out of an untouched form.
   */
  const dirty = base
    ? name !== base.name ||
      code !== base.employeeCode ||
      designation !== base.designation ||
      department !== base.department ||
      phone !== (base.phone ?? "") ||
      email !== (base.email ?? "") ||
      status !== base.status ||
      appAccess !== (base.appAccess ?? true) ||
      projectIds.length !== base.projectIds.length ||
      projectIds.some((id) => !base.projectIds.includes(id))
    : name.trim() !== "" ||
      code.trim() !== "" ||
      phone.trim() !== "" ||
      email.trim() !== "" ||
      projectIds.length > 0 ||
      designation !== "Worker" ||
      department !== "Civil";

  const leaving = base ? DISCARD_EDITS : DISCARD_PERSON;

  const confirmBack = useUnsavedGuard({
    dirty: dirty,
    message: leaving,
    onLeave: () => router.replace(backTo),
  });

  const save = () => {
          if (name.trim().length < 3) {
            setError("Enter the employee's full name.");
            return;
          }
          const key = email.trim().toLowerCase();
          if (!/.+@.+\..+/.test(key)) {
            setError("Enter a work email — it is how they sign in.");
            return;
          }
          // Sign-in resolves a person *by* this address, so two people
          // sharing one is not a duplicate row, it is an ambiguous login.
          const clash = people.find(
            (u) => u.id !== base?.id && u.email.toLowerCase() === key,
          );
          if (clash) {
            setError(`${clash.name} already uses that address.`);
            return;
          }
          saveEmployee(
            {
              name: name.trim(),
              employeeCode: code.trim() || undefined,
              designation,
              department,
              email: key,
              phone: phoneKey(phone) || undefined,
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
                `Sign in with this address (${key}) — it is your ID. ` +
                `You can use Google or Outlook if it is that kind of account.`,
            );
            /*
             * WhatsApp when there is a number to send to, the mail client
             * otherwise. The identity is the address either way; the
             * channel is only how the invitation travels.
             */
            const number = phoneKey(phone);
            window.open(
              number
                ? `https://wa.me/91${number}?text=${text}`
                : `mailto:${key}?subject=${encodeURIComponent(
                    `${employer || "Your employer"} invited you to Workfence`,
                  )}&body=${text}`,
              "_blank",
              "noopener",
            );
          }
    router.replace(backTo);
  };

  return (
    <div>
      <ScreenHeader
        back={backTo}
        confirmBack={confirmBack}
        title={base ? `Edit — ${base.name}` : "Add employee"}
        sub={base ? base.employeeCode : "They appear on the roster straight away"}
        action={
          <button className="wf-btn wf-btn-primary" onClick={save}>
            {base ? "Save changes" : "Add employee"}
          </button>
        }
      />
      <div className="flex flex-col gap-3.5 px-4 pb-8">
      <Field label="Full name" required>
        <input className="wf-input" value={name} onChange={(e) => { setName(e.target.value); setError(""); }} />
      </Field>
      {error ? <FormError tight>{error}</FormError> : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Employee ID">
          <input className="wf-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="auto" />
        </Field>
        <Field label="Phone" hint="Contact only — not how they sign in.">
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

      {/* Required: the address is the sign-in identity. Someone added
          without one exists in the roster and can never open the app,
          which is a worse outcome than refusing to save. */}
      <Field label="Work email" required>
        <input
          className="wf-input"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="name@company.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError("");
          }}
        />
      </Field>
      {/* App access. The address above is the identity they sign in with,
          so it doubles as the unique id across the org. */}
      <div className="wf-card2 flex items-center justify-between gap-3 px-3.5 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Access to the mobile app</p>
          <p className="mt-0.5 text-[0.72rem] leading-relaxed text-[var(--wf-muted)]">
            {appAccess
              ? "They sign in with their work email — it is their unique ID."
              : "They stay on the roster and are still paid, but cannot sign in."}
          </p>
        </div>
        <Toggle
          checked={appAccess}
          onChange={setAppAccess}
          label="Access to the mobile app"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
      </div>
    </div>
  );
}
