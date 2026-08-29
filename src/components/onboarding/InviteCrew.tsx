"use client";

/**
 * Invite the crew — from the phone's own contacts where the device offers a
 * picker, by hand everywhere else.
 *
 * Which picker, and whether it returns one person or several, is decided in
 * `lib/contacts`. The Android shell hands over the contact list (with the
 * person's permission) and this component draws a multi-select sheet over
 * it; if that permission is declined, or the installed app predates the
 * sheet, the permissionless one-at-a-time system picker still works. Chrome
 * opens its own multi-select sheet, and everywhere else there is no button
 * at all.
 *
 * Nothing leaves the device here. Picked contacts become rows in a draft;
 * they are only ever written to the company being created.
 */

import { useMemo, useState, useSyncExternalStore } from "react";
import { Avatar } from "../ui";
import { ICheckCircle, IPhone, IPlus, ISearch, ITrash, IUsers } from "../WfIcons";
import {
  canListContacts,
  contactSource,
  isMultiSelect,
  listDeviceContacts,
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

/** A person with two numbers is one row in the sheet, not two. */
function dedupeByPhone(contacts: CrewInvite[]): CrewInvite[] {
  const seen = new Set<string>();
  return contacts.filter((c) => {
    const k = phoneKey(c.phone);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * The in-app multi-select sheet over the device's contact list. Only the
 * native shell opens this — Chrome's Contact Picker draws its own — so it can
 * assume a phone: a bottom sheet, tap to toggle, one confirm at the end.
 */
function ContactSheet({
  contacts,
  alreadyIn,
  onAdd,
  onCancel,
}: {
  contacts: CrewInvite[];
  /** phoneKeys already on the invite list — shown ticked and untappable. */
  alreadyIn: Set<string>;
  onAdd: (chosen: CrewInvite[]) => void;
  onCancel: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return contacts;
    const digits = q.replace(/\D/g, "");
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (digits.length > 0 && c.phone.replace(/\D/g, "").includes(digits)),
    );
  }, [contacts, filter]);

  const toggle = (k: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/55"
      role="dialog"
      aria-modal="true"
      aria-label="Pick crew from contacts"
    >
      <button className="min-h-16 flex-1" aria-label="Close" onClick={onCancel} />
      <div className="flex max-h-[calc(80dvh-var(--wf-safe-top))] flex-col gap-3 rounded-t-3xl border-t border-[var(--wf-line)] bg-[var(--wf-surface)] px-4 pt-4 pb-[max(1.25rem,var(--wf-safe-bottom))]">
        <div className="flex items-center justify-between">
          <h2 className="wf-display text-lg">Pick from contacts</h2>
          <button
            className="cursor-pointer text-sm font-semibold text-[var(--wf-muted)] hover:text-[var(--wf-fg)]"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>

        <div className="relative">
          <ISearch
            size={15}
            className="absolute top-1/2 left-3 -translate-y-1/2 text-[var(--wf-faint)]"
          />
          <input
            className="wf-input wf-input-search"
            type="search"
            placeholder="Search name or number"
            aria-label="Search contacts"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto">
          {shown.map((c, i) => {
            const k = phoneKey(c.phone);
            const added = alreadyIn.has(k);
            const on = added || chosen.has(k);
            return (
              <li key={k}>
                <button
                  className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-1.5 py-2 text-left hover:bg-[var(--wf-fill-3)] disabled:cursor-default disabled:opacity-55"
                  aria-pressed={on}
                  disabled={added}
                  onClick={() => toggle(k)}
                >
                  <Avatar name={c.name} hue={(i * 47) % 360} size={34} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.86rem] font-semibold">
                      {c.name}
                    </span>
                    <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
                      {added ? "Already on the list" : c.phone}
                    </span>
                  </span>
                  <span
                    className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${
                      on
                        ? "text-[var(--wf-green)]"
                        : "border-[1.5px] border-[var(--wf-line-strong)]"
                    }`}
                  >
                    {on ? <ICheckCircle size={22} /> : null}
                  </span>
                </button>
              </li>
            );
          })}
          {shown.length === 0 ? (
            <li className="px-1.5 py-6 text-center text-[0.82rem] text-[var(--wf-muted)]">
              No contacts match.
            </li>
          ) : null}
        </ul>

        <button
          className="wf-btn wf-btn-primary wf-btn-lg"
          disabled={chosen.size === 0}
          onClick={() =>
            onAdd(contacts.filter((c) => chosen.has(phoneKey(c.phone))))
          }
        >
          <IUsers size={16} />
          {chosen.size === 0
            ? "Select people to add"
            : `Add ${chosen.size} ${chosen.size === 1 ? "person" : "people"}`}
        </button>
      </div>
    </div>
  );
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
  /** Device contacts loaded for the multi-select sheet; null = sheet closed. */
  const [sheet, setSheet] = useState<CrewInvite[] | null>(null);

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

  const addPicked = (contacts: CrewInvite[]) => {
    const usable = contacts.filter((c) => c.name && isUsablePhone(c.phone));
    const added = merge(usable);
    const skipped = contacts.length - added;

    setNote(
      added === 0
        ? "Already on the list, or no usable number."
        : `Added ${added}${skipped > 0 ? ` — skipped ${skipped} without a usable number` : ""}.`,
    );
  };

  const pickSingles = async () => {
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
    addPicked(contacts);
  };

  const pickFromContacts = async () => {
    setNote(null);

    // The native shell can hand over the list: draw the multi-select sheet.
    if (source === "native" && canListContacts()) {
      setPicking(true);
      const { denied, contacts, error } = await listDeviceContacts();
      setPicking(false);

      if (denied) {
        // No permission, no sheet — the one-at-a-time picker needs neither.
        setNote("Contacts permission declined — picking one at a time instead.");
        await pickSingles();
        return;
      }
      if (error) {
        setNote(error);
        return;
      }
      const usable = contacts.filter((c) => c.name && isUsablePhone(c.phone));
      if (usable.length === 0) {
        setNote("No contacts with a phone number on this device.");
        return;
      }
      setSheet(dedupeByPhone(usable));
      return;
    }

    await pickSingles();
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

      {sheet ? (
        <ContactSheet
          contacts={sheet}
          alreadyIn={new Set(invites.map((i) => phoneKey(i.phone)))}
          onCancel={() => setSheet(null)}
          onAdd={(picked) => {
            setSheet(null);
            addPicked(picked);
          }}
        />
      ) : null}
    </div>
  );
}
