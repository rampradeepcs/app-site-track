"use client";

/**
 * Gate an irreversible action behind an explicit yes.
 *
 * These buttons used to reset a seeded demo, where the worst case was losing
 * placeholder data you could regenerate. There is no seed any more: against a
 * local store, this device holds the company's only copy — the people, the
 * premises, every shift anyone worked — and one mis-tap would take all of it
 * with no undo.
 *
 * `window.confirm` rather than a styled sheet on purpose. It is modal, it is
 * keyboard- and screen-reader-accessible without any work, and it cannot be
 * dismissed by a stray tap on the backdrop — which is exactly the behaviour a
 * destructive action wants, and exactly what a prettier custom dialog would
 * have to reimplement to be as safe.
 */
export function confirmDestructive(message: string, run: () => void): void {
  if (askDestructive(message)) run();
}

/**
 * The same question, answered rather than acted on.
 *
 * Some callers cannot be handed a callback: a sheet being thrown off the
 * screen has to know, before it starts animating, whether it is going —
 * because a sheet that slides away and springs back reads as a bug rather
 * than a question. `window.confirm` blocks, so the answer is available in
 * the same tick the gesture ends.
 */
export function askDestructive(message: string): boolean {
  if (typeof window === "undefined") return false;
  return window.confirm(message);
}

export const ERASE_DEVICE =
  "Erase everything on this device?\n\n" +
  "People, premises, attendance and routes all go, and there is no undo.";

export const DISCARD_PROJECT =
  "Discard this project?\n\n" +
  "Everything filled in so far goes, and the project is not created.";

export const DISCARD_PEOPLE =
  "Discard these invitations?\n\n" +
  "Nobody on the list has been invited yet, and the list goes with the screen.";

export const DISCARD_EDITS =
  "Leave without saving?\n\n" +
  "The changes made here go back to what they were.";

export const DISCARD_PERSON =
  "Discard this person?\n\n" +
  "What has been filled in goes, and nobody is added.";

export const DISCARD_INVITE =
  "Discard this invitation?\n\n" +
  "It has not been sent, and what was filled in goes with the sheet.";

export const DISCARD_CLIENT =
  "Discard this client?\n\n" +
  "Nothing has been created yet — the company, the administrator, the plan " +
  "and the branding all go.";
