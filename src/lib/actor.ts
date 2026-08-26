/**
 * Who is acting, for audit attribution.
 *
 * The platform audit trail records a person, but the two stores that write to
 * it sit on opposite sides of the provider tree: `PlatformProvider` wraps
 * `WorkforceProvider`, so the store that owns the session cannot be read from
 * the store that owns the audit. This module is the seam between them — a
 * single mutable identity, written when the session changes and read when an
 * entry is appended.
 *
 * It is deliberately not React state. Nothing renders from it; it is only ever
 * read inside an event handler, at the moment an entry is written.
 */

export interface Actor {
  id: string;
  name: string;
}

/**
 * Used when nobody is signed in — a self-serve signup writes its first audit
 * entry before the account it is creating exists. Better an honest "System"
 * than a person who did not do it.
 */
const SYSTEM: Actor = { id: "system", name: "System" };

let acting: Actor = SYSTEM;

export function setActor(a: Actor | null): void {
  acting = a ?? SYSTEM;
}

export function currentActor(): Actor {
  return acting;
}
