"use client";

/**
 * Push local mutations to Postgres.
 *
 * The store stays optimistic: every mutation lands in local state first, so
 * the app is instant and keeps working with no signal — which is the whole
 * point on a site. This module is the second half of that bargain, and it was
 * missing. Live mode read from the database and wrote to nothing: a worker
 * checked in, the shift lived in their browser, and the next hydration
 * replaced it with what the server had, which was nothing.
 *
 * Two rules make optimistic writes safe rather than a lie:
 *
 *  - **Ids are minted here, not by the database.** Every persistable record
 *    is a client-generated UUID, so the row has one identity in both places
 *    and anything already pointing at it stays valid. Nothing has to be
 *    rewritten when the server answers, which means nothing is broken if it
 *    never does.
 *  - **A failed write is reported, never swallowed.** Silence would show a
 *    manager a project that exists only on their phone. Subscribers are told,
 *    and the shell says so.
 */

import { demoActive } from "../demo/mode";
import { describeErrorSentence } from "../errors";
import { isLiveBackend } from "./client";

export interface SyncFailure {
  /** What the user was doing, in their words: "save the project". */
  action: string;
  message: string;
  at: number;
}

type Listener = (f: SyncFailure | null) => void;

const listeners = new Set<Listener>();
let last: SyncFailure | null = null;

export function subscribeToSync(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function lastSyncFailure(): SyncFailure | null {
  return last;
}

export function clearSyncFailure(): void {
  last = null;
  for (const l of listeners) l(null);
}

function report(f: SyncFailure | null) {
  last = f;
  for (const l of listeners) l(f);
}

/**
 * Run a write if there is a backend to run it against.
 *
 * Deliberately not awaited by callers: the local mutation has already
 * happened and the UI has already moved on. What matters is that a failure
 * surfaces, and it does — through `report`, not a rejected promise nobody is
 * holding.
 */
export function persist(action: string, write: () => Promise<unknown>): void {
  if (!isLiveBackend) return;
  /*
   * The demonstration does not touch the server.
   *
   * isLiveBackend only says credentials exist, not that the data in front of
   * you is real. With a backend configured, every demo mutation was being
   * posted to Postgres carrying demo identifiers — which are not UUIDs, so
   * each one came back "invalid input syntax for type uuid:
   * \"demo-user-employee\"" and raised the red banner above the screen. A
   * presenter walking through check-in, a work update and a voice note
   * collected an alert at every step, all of them saying a save had failed
   * that was never supposed to happen. It is also what the demo promises in
   * as many words: nothing here reaches a real company's records.
   */
  if (demoActive()) return;
  void write().then(
    () => {
      // Only clear a failure that this same action raised; another pending
      // write's failure is still true and must stay on screen.
      if (last?.action === action) clearSyncFailure();
    },
    (e: unknown) => {
      const raw = describeErrorSentence(e);
      report({
        action,
        message: /failed to fetch|networkerror|load failed/i.test(raw)
          ? "No connection to the server."
          : raw,
        at: Date.now(),
      });
    },
  );
}

/**
 * A client-minted UUID.
 *
 * `crypto.randomUUID` needs a secure context, which the app always has in
 * practice — https, localhost, or the Capacitor WebView. The fallback exists
 * so a plain-http test server does not produce ids Postgres will reject.
 */
export function uid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  (c?.getRandomValues
    ? c.getRandomValues.bind(c)
    : (a: Uint8Array) => {
        for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
        return a;
      })(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
