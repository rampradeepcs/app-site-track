"use client";

/**
 * Invite the crew — from the phone's own contacts where the browser allows
 * it, by hand everywhere else.
 *
 * The Contact Picker API is the right primitive and the wrong thing to depend
 * on: it exists on Android Chrome over HTTPS and essentially nowhere else, and
 * it deliberately gives no way to ask whether permission would be granted.
 * So it is offered when present and never assumed — the manual rows are the
 * real path, and the picker is a shortcut that fills them in.
 *
 * Nothing leaves the device here. The picked contacts become rows in a draft;
 * they are only ever written to the company being created.
 */

import { useState } from "react";
import { Avatar } from "../ui";
import { IPhone, IPlus, ITrash, IUsers } from "../WfIcons";
import type { CrewInvite } from "@/lib/store";

/**
 * Minimal shape of the Contact Picker API. Not in lib.dom, and declaring the
 * two calls used is honester than casting to `any` at each site.
 */
interface PickedContact {
  name?: string[];
  tel?: string[];
}
interface ContactsManager {
  select(
    props: string[],
    options?: { multiple?: boolean },
  ): Promise<PickedContact[]>;
}

function contactsApi(): ContactsManager | null {
  if (typeof navigator === "undefined" || typeof window === "undefined") return null;
  const nav = navigator as Navigator & { contacts?: ContactsManager };
  return nav.contacts && "ContactsManager" in window ? nav.contacts : null;
}

/** Digits only, so "+91 90000 00001" and "9000000001" are the same person. */
export function phoneKey(raw: string): string {
  const d = raw.replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}

export function isUsablePhone(raw: string): boolean {
  return phoneKey(raw).length >= 7;
}

export function InviteCrew({
  invites,
  onChange,
}: {
  invites: CrewInvite[];
  onChange: (next: CrewInvite[]) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const picker = contactsApi();

  const merge = (incoming: CrewInvite[]) => {
    const seen = new Set(invites.map((i) => phoneKey(i.phone)));
    const fresh = incoming.filter((i) => {
      const k = phoneKey(i.phone);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (fresh.length) onChange([...invites, ...fresh]);
    return fresh.length;
  };

  const pickFromContacts = async () => {
    if (!picker) return;
    setNote(null);
    setPicking(true);
    try {
      const picked = await picker.select(["name", "tel"], { multiple: true });
      const usable = picked
        .map((c) => ({
          name: (c.name?.[0] ?? "").trim(),
          phone: (c.tel?.[0] ?? "").trim(),
        }))
        .filter((c) => c.name && isUsablePhone(c.phone));
      const added = merge(usable);
      const skipped = picked.length - added;
      setNote(
        added === 0
          ? picked.length === 0
            ? null
            : "Those contacts were already on the list, or had no usable number."
          : `Added ${added}${skipped > 0 ? ` — skipped ${skipped} without a usable number` : ""}.`,
      );
    } catch {
      // A cancelled picker throws exactly like a denied one. Neither is an
      // error worth alarming anybody about; the manual rows are right there.
      setNote(null);
    } finally {
      setPicking(false);
    }
  };

  const addManual = () => {
    if (!name.trim() || !isUsablePhone(phone)) return;
    merge([{ name: name.trim(), phone: phone.trim() }]);
    setName("");
    setPhone("");
    setNote(null);
  };

  const remove = (i: number) => onChange(invites.filter((_, j) => j !== i));

  return (
    <div className="flex flex-col gap-4">
      {picker ? (
        <button
          className="wf-btn wf-btn-ghost"
          onClick={pickFromContacts}
          disabled={picking}
        >
          <IUsers size={16} />
          {picking ? "Choosing…" : "Pick from contacts"}
        </button>
      ) : (
        <p className="wf-card2 p-3 text-[0.78rem] leading-relaxed text-[var(--wf-muted)]">
          Your browser can&apos;t open the contact list. Add people by name and
          number below — the Android app can pick them straight from contacts.
        </p>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            className="wf-input min-w-0 flex-1"
            placeholder="Name"
            value={name}
            aria-label="Crew member name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addManual()}
          />
          <input
            className="wf-input min-w-0 flex-1"
            placeholder="Mobile"
            inputMode="tel"
            aria-label="Crew member mobile number"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addManual()}
          />
        </div>
        <button
          className="wf-btn wf-btn-ghost wf-btn-sm w-fit"
          onClick={addManual}
          disabled={!name.trim() || !isUsablePhone(phone)}
        >
          <IPlus size={14} /> Add
        </button>
      </div>

      {note ? (
        <p className="text-[0.78rem] text-[var(--wf-muted)]">{note}</p>
      ) : null}

      {invites.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {invites.map((c, i) => (
            <li
              key={`${phoneKey(c.phone)}_${i}`}
              className="wf-card2 flex items-center gap-3 p-2.5"
            >
              <Avatar name={c.name} hue={(i * 47) % 360} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.86rem] font-semibold">
                  {c.name}
                </span>
                <span className="flex items-center gap-1 truncate text-[0.72rem] text-[var(--wf-muted)]">
                  <IPhone size={11} /> {c.phone}
                </span>
              </span>
              <button
                className="cursor-pointer p-2 text-[var(--wf-faint)] hover:text-[var(--wf-red)]"
                aria-label={`Remove ${c.name}`}
                onClick={() => remove(i)}
              >
                <ITrash size={15} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
