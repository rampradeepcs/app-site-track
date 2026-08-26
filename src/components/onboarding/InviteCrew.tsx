"use client";

/**
 * Invite the crew — from the phone's own contacts where the device offers a
 * picker, by hand everywhere else.
 *
 * Which picker, and whether it returns one person or several, is decided in
 * `lib/contacts`. This component only asks what tapping the button will do,
 * so the label can promise the truth: the Android shell opens the system
 * picker one contact at a time, Chrome opens its multi-select sheet, and
 * everywhere else there is no button at all.
 *
 * Nothing leaves the device here. Picked contacts become rows in a draft;
 * they are only ever written to the company being created.
 */

import { useState, useSyncExternalStore } from "react";
import { Avatar } from "../ui";
import { IPhone, IPlus, ITrash, IUsers } from "../WfIcons";
import {
  contactSource,
  isMultiSelect,
  pickContacts,
  type ContactSource,
} from "@/lib/contacts";
import type { CrewInvite } from "@/lib/store";

/** Digits only, so "+91 90000 00001" and "9000000001" are the same person. */
export function phoneKey(raw: string): string {
  const d = raw.replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}

export function isUsablePhone(raw: string): boolean {
  return phoneKey(raw).length >= 7;
}

/**
 * The picker a device has does not change while the page is open — the
 * Capacitor bridge and the Contact Picker API are both present or absent for
 * the lifetime of the document — so there is nothing to subscribe to.
 */
const subscribeNever = () => () => {};
const serverNone = (): ContactSource => "none";

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

  /*
   * What the device can do is an external fact, not state this component
   * owns: the Capacitor bridge injects its global into the page, so there is
   * nothing to detect on the server or in the hydration render. The server
   * snapshot is "none" so the markup matches, and React swaps in the real
   * answer immediately after — without the extra render that mirroring it
   * into state from an effect would cost.
   */
  const source = useSyncExternalStore(subscribeNever, contactSource, serverNone);

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
    setNote(null);
    setPicking(true);
    const { contacts, error } = await pickContacts();
    setPicking(false);

    if (error) {
      setNote(error);
      return;
    }
    // Nothing back and no error means the picker was dismissed. Saying
    // "added 0" to someone who deliberately backed out is noise.
    if (contacts.length === 0) return;

    const usable = contacts.filter((c) => c.name && isUsablePhone(c.phone));
    const added = merge(usable);
    const skipped = contacts.length - added;

    setNote(
      added === 0
        ? "Already on the list, or no usable number."
        : `Added ${added}${skipped > 0 ? ` — skipped ${skipped} without a usable number` : ""}.`,
    );
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
      {source !== "none" ? (
        <button
          className="wf-btn wf-btn-ghost"
          onClick={pickFromContacts}
          disabled={picking}
        >
          <IUsers size={16} />
          {picking
            ? "Choosing…"
            : isMultiSelect(source) || invites.length === 0
              ? "Pick from contacts"
              : "Pick another contact"}
        </button>
      ) : (
        <p className="wf-card2 p-3 text-[0.78rem] leading-relaxed text-[var(--wf-muted)]">
          This device can&apos;t open the contact list. Add people by name and
          number below — the Android app picks them straight from contacts.
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
