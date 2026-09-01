"use client";

/**
 * What happened on the way back from a single sign-on.
 *
 * A device sign-on leaves the app entirely, so its outcome arrives while
 * nothing is watching for it: the deep link fires into a root listener, the
 * sign-in screen is a different component, and a toast shown at that moment
 * is gone before the user has finished switching back from the browser. A
 * sign-in that failed for a nameable reason looked exactly like one that had
 * silently done nothing.
 *
 * So the reason is written down, and the sign-in screen reads it as an
 * external store. In localStorage rather than a module variable or
 * sessionStorage: the WebView can be torn down and rebuilt while the system
 * browser is in front of it, which is precisely when a long sign-in goes
 * wrong, and both of those die with the page session. It is cleared on read
 * and when a fresh attempt starts, so nothing stale survives.
 */

const KEY = "workfence.sso.failure";

const listeners = new Set<() => void>();

/* Cached so the snapshot is referentially stable between renders, which
   useSyncExternalStore requires — reading storage on every call returns a
   fresh string and spins. */
let cache: string | null | undefined;

function announce() {
  for (const fn of listeners) fn();
}

export function subscribeSsoFailure(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function readSsoFailure(): string | null {
  if (cache === undefined) {
    try {
      cache = localStorage.getItem(KEY);
    } catch {
      cache = null;
    }
  }
  return cache;
}

/** Nothing to report before the app has run — there has been no sign-on. */
export function serverSsoFailure(): string | null {
  return null;
}

/** The deep link came back carrying a reason it could not be used. */
export function recordSsoFailure(reason: string) {
  cache = reason;
  try {
    localStorage.setItem(KEY, reason);
  } catch {
    /* private mode or storage disabled — the toast still fires */
  }
  announce();
}

/** Called when the message has been seen, or a fresh attempt begins. */
export function clearSsoFailure() {
  if (cache === null) return;
  cache = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
  announce();
}
