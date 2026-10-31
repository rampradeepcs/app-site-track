"use client";

/**
 * Back means back.
 *
 * Every back control in the app steps back through the history the person
 * actually walked, not to a parent the screen happens to name: Shifts opens
 * from the manager's More and from the admin's, a worker opens from the
 * dashboard and from the workforce list, and pushing a fixed parent sent
 * people somewhere they had not come from — and stacked a new history entry
 * every time, so the phone's own back gesture walked them round in circles.
 *
 * Stepping back is only safe when the previous entry is this app. The
 * browser will happily go back to the search page someone arrived from, or
 * do nothing at all on a link opened cold, and history.length cannot tell
 * those apart (it counts other sites' pages too). So each history entry is
 * stamped with its depth inside the app: a client-side navigation pushes one
 * deeper, a redirect keeps the depth it replaces, and the first page of a
 * visit is zero. Back steps through history only from a depth above zero,
 * and otherwise goes to the screen's named parent instead.
 *
 * The stamp rides along in history.state beside the router's own keys, so
 * it survives reloads and is read back on every back and forward.
 */

import type { useRouter } from "next/navigation";

const KEY = "__wfDepth";

function depthOf(state: unknown): number {
  if (state && typeof state === "object") {
    const d = (state as Record<string, unknown>)[KEY];
    if (typeof d === "number" && d >= 0) return d;
  }
  return 0;
}

function stamped(state: unknown, depth: number): unknown {
  // The router only ever stores objects; anything else is not ours to touch.
  if (state === null || state === undefined) return { [KEY]: depth };
  if (typeof state !== "object") return state;
  return { ...(state as Record<string, unknown>), [KEY]: depth };
}

let installed = false;

/** Wrap history so every entry carries its depth. Safe to call repeatedly. */
export function installHistoryDepth(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const h = window.history;
  const push = h.pushState.bind(h);
  const replace = h.replaceState.bind(h);
  h.pushState = (state: unknown, unused: string, url?: string | URL | null) =>
    push(stamped(state, depthOf(h.state) + 1), unused, url);
  h.replaceState = (state: unknown, unused: string, url?: string | URL | null) =>
    replace(stamped(state, depthOf(h.state)), unused, url);
}

/** Whether the previous history entry is a screen of this app. */
export function canGoBack(): boolean {
  if (typeof window === "undefined") return false;
  return depthOf(window.history.state) > 0;
}

/**
 * Step back to wherever the person came from; with nothing behind them in
 * this app — a link opened cold — go to `fallback` instead, replacing the
 * current entry so back from there does not return here.
 */
export function goBack(router: ReturnType<typeof useRouter>, fallback: string): void {
  if (canGoBack()) router.back();
  else router.replace(fallback);
}
