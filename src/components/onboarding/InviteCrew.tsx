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
import {
  ICheckCircle,
  IPhone,
  IPlus,
  IRefresh,
  ISearch,
  ITrash,
  IUsers,
} from "../WfIcons";
import {
  canListContacts,
  contactSource,
  isMultiSelect,
  listDeviceContacts,
  pickContacts,
  type ContactSource,
} from "@/lib/contacts";
import type { CrewInvite } from "@/lib/store";
import { emailProblem, isUsableEmail } from "@/lib/email";

/** Digits only, so "+91 90000 00001" and "9000000001" are the same person. */
export function phoneKey(raw: string | undefined): string {
  const d = (raw ?? "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}

/**
 * The key one contact is tracked by.
 *
 * Email first, because email is the identity now — two entries for the same
 * address are one person however many numbers they have. A contact with no
 * address still needs a stable key though, and their number is the only
 * other thing that distinguishes them, so it stands in.
 */
export function contactKey(c: { email?: string; phone?: string }): string {
  const mail = c.email?.trim().toLowerCase();
  return mail || phoneKey(c.phone);
}

export function isUsablePhone(raw: string | undefined): boolean {
  return phoneKey(raw).length >= 7;
}

/** A person with two numbers is one row in the sheet, not two. */
function dedupeByContact(contacts: CrewInvite[]): CrewInvite[] {
  const seen = new Set<string>();
  return contacts.filter((c) => {
    const k = contactKey(c);
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
  onRefresh,
}: {
  contacts: CrewInvite[];
  /** contactKeys already on the invite list — shown ticked and untappable. */
  alreadyIn: Set<string>;
  onAdd: (chosen: CrewInvite[]) => void;
  onCancel: () => void;
  /** Read the device again, for somebody who just edited a contact. */
  onRefresh: () => Promise<void>;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  /*
   * Addresses typed for contacts saved without one.
   *
   * Most numbers in a site manager's phone are numbers and nothing else, so
   * a picker that only offered contacts already carrying an address showed
   * an empty list and said the device had no contacts — on a phone holding
   * eighteen hundred of them. Everybody is offered; the address is asked for
   * where it is missing, which is one field rather than a whole row retyped.
   */
  const [typed, setTyped] = useState<Record<string, string>>({});

  const addressFor = (c: CrewInvite) => {
    const k = contactKey(c);
    return isUsableEmail(c.email) ? (c.email as string) : (typed[k] ?? "");
  };

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return contacts;
    const digits = q.replace(/\D/g, "");
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (digits.length > 0 && (c.phone ?? "").replace(/\D/g, "").includes(digits)),
    );
  }, [contacts, filter]);

  const toggle = (k: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const picked = contacts.filter((c) => chosen.has(contactKey(c)));
  const ready = picked.filter((c) => isUsableEmail(addressFor(c)));
  const missing = picked.length - ready.length;

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
          <span className="flex items-center gap-3">
            {/* The list is read fresh on every open; this is for the person
                who leaves mid-pick to add an address and comes back. */}
            <button
              className="flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-[var(--wf-muted)] hover:text-[var(--wf-fg)] disabled:opacity-50"
              disabled={refreshing}
              onClick={() => {
                setRefreshing(true);
                void onRefresh().finally(() => setRefreshing(false));
              }}
            >
              <IRefresh size={14} />
              {refreshing ? "Syncing…" : "Sync"}
            </button>
            <button
              className="cursor-pointer text-sm font-semibold text-[var(--wf-muted)] hover:text-[var(--wf-fg)]"
              onClick={onCancel}
            >
              Cancel
            </button>
          </span>
        </div>

        <div className="relative">
          <ISearch
            size={15}
            className="absolute top-1/2 left-3 -translate-y-1/2 text-[var(--wf-faint)]"
          />
          <input
            className="wf-input wf-input-search"
            type="search"
            placeholder="Search name or email"
            aria-label="Search contacts"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto">
          {shown.map((c, i) => {
            const k = contactKey(c);
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
                      {added
                        ? "Already on the list"
                        : c.email ||
                          (c.phone ? `${c.phone} · no email saved` : "No email saved")}
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
                {/* Asked for only once somebody has been chosen, so the list
                    stays a list until a decision is made. */}
                {!added && chosen.has(k) && !isUsableEmail(c.email) ? (
                  <div className="mb-1.5 pl-[3.1rem]">
                    <input
                      className="wf-input"
                      type="email"
                      inputMode="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder={`Work email for ${c.name.split(" ")[0]}`}
                      aria-label={`Work email for ${c.name}`}
                      value={typed[k] ?? ""}
                      onChange={(e) =>
                        setTyped((prev) => ({ ...prev, [k]: e.target.value }))
                      }
                    />
                  </div>
                ) : null}
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
          disabled={ready.length === 0}
          onClick={() =>
            onAdd(
              ready.map((c) => ({ ...c, email: addressFor(c).trim().toLowerCase() })),
            )
          }
        >
          <IUsers size={16} />
          {picked.length === 0
            ? "Select people to add"
            : missing > 0
              ? `${missing} still need${missing === 1 ? "s" : ""} an email`
              : `Add ${ready.length} ${ready.length === 1 ? "person" : "people"}`}
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
  const [email, setEmail] = useState("");
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
    /* Keyed on contactKey, which prefers the address — the same person
       reached twice, once from contacts and once typed in, is one invite. */
    const seen = new Set(invites.map((i) => contactKey(i)));
    const fresh = incoming.filter((i) => {
      const k = contactKey(i);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (fresh.length) onChange([...invites, ...fresh]);
    return fresh.length;
  };

  const addPicked = (contacts: CrewInvite[]) => {
    const usable = contacts.filter((c) => c.name && isUsableEmail(c.email));
    const added = merge(usable);
    const skipped = contacts.length - added;

    setNote(
      added === 0
        ? "Already on the list, or no email address on the contact."
        : `Added ${added}${skipped > 0 ? ` — skipped ${skipped} already on the list` : ""}.`,
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

    /*
     * One contact, no address on it. Dropping them silently is the worst
     * answer: the person picked somebody deliberately. Carry the name and
     * number into the form so all that is left to type is the address —
     * which is most of what the picker was saving them anyway.
     */
    const only = contacts[0];
    if (contacts.length === 1 && only.name && !isUsableEmail(only.email)) {
      setName(only.name);
      setPhone(only.phone ?? "");
      setEmail("");
      setNote(`${only.name} has no email address saved. Add one to invite them.`);
      return;
    }
    addPicked(contacts);
  };

  /**
   * Read the device's contacts again while the sheet is open.
   *
   * Nothing is cached — every open already asks the phone — but somebody who
   * steps out to add a colleague's address and comes back should not have to
   * close and reopen to see it.
   */
  const refreshSheet = async () => {
    const { denied, contacts, error } = await listDeviceContacts();
    if (denied || error) {
      setNote(error ?? "Contacts permission declined.");
      return;
    }
    const named = contacts.filter((c) => c.name.trim());
    setSheet(dedupeByContact(named));
    setNote(`Synced — ${named.length} ${named.length === 1 ? "contact" : "contacts"}.`);
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
      /*
       * Everybody with a name, not only those already carrying an address.
       * The sheet asks for the address where it is missing, which is what
       * makes the picker useful on a phone whose contacts are mostly
       * numbers — and what stops it claiming a full address book is empty.
       */
      const named = contacts.filter((c) => c.name.trim());
      if (named.length === 0) {
        setNote("No contacts on this device.");
        return;
      }
      setSheet(dedupeByContact(named));
      return;
    }

    await pickSingles();
  };

  const addManual = () => {
    if (!name.trim() || !isUsableEmail(email)) return;
    merge([
      {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim() || undefined,
      },
    ]);
    setName("");
    setEmail("");
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
          email below — the Android app picks them straight from contacts.
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
            placeholder="Work email"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            aria-label="Crew member work email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addManual()}
          />
        </div>
        <input
          className="wf-input"
          placeholder="Mobile (optional)"
          inputMode="tel"
          aria-label="Crew member mobile number, optional"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addManual()}
        />
        {emailProblem(email) ? (
          <p className="text-[0.76rem] text-[var(--wf-red)]">{emailProblem(email)}</p>
        ) : null}
        <button
          className="wf-btn wf-btn-ghost wf-btn-sm w-fit"
          onClick={addManual}
          disabled={!name.trim() || !isUsableEmail(email)}
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
              key={`${contactKey(c)}_${i}`}
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
          onRefresh={refreshSheet}
          contacts={sheet}
          alreadyIn={new Set(invites.map((i) => contactKey(i)))}
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
