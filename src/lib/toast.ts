"use client";

/**
 * Confirmation that something happened.
 *
 * Most actions in this app are quiet: you assign eight people to a shift,
 * the sheet closes, and the only evidence is a number that changed further
 * down the page. That is fine until you are not sure whether the tap
 * registered — and then the honest response is to do it again, which is how
 * people end up assigning twice.
 *
 * A plain event bus rather than a React context, for one reason: the store
 * raises these from inside its mutations, so every module gets feedback
 * from one place instead of each call site remembering to announce itself.
 * A store that had to consume a hook to say "saved" would be a store that
 * depends on the tree that renders it.
 */

export type ToastTone = "success" | "info" | "danger";

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

type Listener = (t: Toast) => void;

const listeners = new Set<Listener>();
let seq = 0;

/**
 * Announce a completed action.
 *
 * Phrase these in the past tense and name what changed — "Shift assigned to
 * 8 people", not "Success". The point is to confirm the specific thing, so
 * that seeing it is enough to move on.
 */
export function showToast(message: string, tone: ToastTone = "success"): void {
  if (typeof window === "undefined") return;
  const toast: Toast = { id: ++seq, message, tone };
  for (const l of listeners) l(toast);
}

export function subscribeToast(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
