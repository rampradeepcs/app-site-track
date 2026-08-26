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
  if (typeof window === "undefined") return;
  if (window.confirm(message)) run();
}

export const ERASE_DEVICE =
  "Erase everything on this device?\n\n" +
  "People, premises, attendance and routes all go, and there is no undo.";
