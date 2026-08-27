"use client";

/**
 * Reading a contact off the device, by whichever route this build has.
 *
 * Three of them, and they are not equivalent:
 *
 *  - **native** — the Android app registers a `ContactPicker` plugin that
 *    launches the system picker. One contact per invocation, no permission
 *    declared or requested; Android hands back a read grant for the single
 *    row the user chose.
 *  - **web** — Chrome's Contact Picker API, which is multi-select and also
 *    permissionless, but exists on essentially nothing except Android Chrome
 *    over HTTPS.
 *  - **none** — everywhere else. Typing a name and a number is the fallback,
 *    and it is the path that must always work.
 *
 * Callers get one function and a capability describing what tapping it will
 * do, so the button can say "Pick from contacts" or "Pick another" honestly
 * instead of promising a picker that will not open.
 */

import type { CrewInvite } from "./store";

export type ContactSource = "native" | "web" | "none";

export interface PickOutcome {
  /** Empty when the user cancelled — which is not an error. */
  contacts: CrewInvite[];
  /** Set only when something actually went wrong. */
  error?: string;
}

/* -------------------------------------------------------- web capability */

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

function webPicker(): ContactsManager | null {
  if (typeof navigator === "undefined" || typeof window === "undefined") return null;
  const nav = navigator as Navigator & { contacts?: ContactsManager };
  return nav.contacts && "ContactsManager" in window ? nav.contacts : null;
}

/* ----------------------------------------------------- native capability */

interface NativePick {
  cancelled: boolean;
  name?: string;
  phone?: string;
}

interface NativeList {
  denied: boolean;
  contacts?: Array<{ name?: string; phone?: string }>;
}

interface NativeContactPicker {
  pick?: () => Promise<NativePick>;
  /** Absent on app binaries built before the multi-select sheet existed. */
  list?: () => Promise<NativeList>;
}

interface CapacitorGlobal {
  Plugins?: { ContactPicker?: NativeContactPicker };
}

/**
 * The bridge's own plugin object, or null off-device.
 *
 * Read straight off `Capacitor.Plugins` rather than through `registerPlugin`,
 * for a reason worth writing down: the Android bridge generates a callable
 * `window.Capacitor.Plugins.ContactPicker` for every registered plugin before
 * the app bundle runs (see JSExport.getPluginJS), so this needs no import and
 * no registration on the JS side at all.
 *
 * `Capacitor.isPluginAvailable()` would have been the obvious check and is a
 * trap here: the injected bridge defines it against `Capacitor.Plugins`, while
 * `@capacitor/core` redefines it against `Capacitor.PluginHeaders` when that
 * package happens to be loaded. Which answer you get depends on whether
 * something else in the bundle imported the runtime. Asking for the function
 * we are about to call has no such ambiguity.
 */
function nativePicker(): NativeContactPicker | null {
  if (typeof window === "undefined") return null;
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  const plugin = cap?.Plugins?.ContactPicker;
  return typeof plugin?.pick === "function" ? plugin : null;
}

/* -------------------------------------------------------------- exports */

export function contactSource(): ContactSource {
  if (nativePicker()) return "native";
  if (webPicker()) return "web";
  return "none";
}

/** Whether a source returns several people at once, or one per tap. */
export function isMultiSelect(source: ContactSource): boolean {
  return source === "web" || (source === "native" && canListContacts());
}

/**
 * Whether the native shell can hand over the whole contact list for the
 * in-app multi-select sheet. False on web (Chrome's picker is its own
 * multi-select) and on app binaries older than the `list` method.
 */
export function canListContacts(): boolean {
  return typeof nativePicker()?.list === "function";
}

export interface ListOutcome {
  /** The person declined READ_CONTACTS — fall back to the single picker. */
  denied: boolean;
  contacts: CrewInvite[];
  error?: string;
}

/** Every contact with a phone number, for the multi-select sheet. */
export async function listDeviceContacts(): Promise<ListOutcome> {
  const plugin = nativePicker();
  if (typeof plugin?.list !== "function") {
    return { denied: false, contacts: [], error: "This build can't list contacts." };
  }
  try {
    const out = await plugin.list();
    if (out.denied) return { denied: true, contacts: [] };
    return {
      denied: false,
      contacts: (out.contacts ?? []).map((c) => ({
        name: (c.name ?? "").trim(),
        phone: (c.phone ?? "").trim(),
      })),
    };
  } catch (e) {
    return {
      denied: false,
      contacts: [],
      error: e instanceof Error ? e.message : "Couldn't read the contact list.",
    };
  }
}

export async function pickContacts(): Promise<PickOutcome> {
  const source = contactSource();

  if (source === "native") {
    try {
      const picked = await nativePicker()!.pick!();
      // Cancelled, or a contact with no name to show on a crew list.
      if (picked.cancelled || !picked.name?.trim()) return { contacts: [] };
      return {
        contacts: [
          { name: picked.name.trim(), phone: (picked.phone ?? "").trim() },
        ],
      };
    } catch (e) {
      // The plugin rejects only when it genuinely could not read the contact
      // the user chose; cancelling resolves. So this is worth showing.
      return {
        contacts: [],
        error: e instanceof Error ? e.message : "Couldn't open contacts.",
      };
    }
  }

  if (source === "web") {
    try {
      const picked = await webPicker()!.select(["name", "tel"], {
        multiple: true,
      });
      return {
        contacts: picked.map((c) => ({
          name: (c.name?.[0] ?? "").trim(),
          phone: (c.tel?.[0] ?? "").trim(),
        })),
      };
    } catch {
      // A cancelled picker throws exactly like a denied one, and neither is
      // worth alarming anybody about — the manual rows are right there.
      return { contacts: [] };
    }
  }

  return { contacts: [] };
}
