"use client";

/**
 * Half-finished work asks before it is thrown away — on every exit, not one.
 *
 * A screen with unsaved changes has three ways off it and they are unrelated to
 * each other: the header's back arrow, the Android hardware back button, and the
 * browser closing the tab. Seven screens wrote the same two effects to cover the
 * last two; three more wired `confirmBack` on the header and nothing else, so on
 * those the arrow asked politely while the hardware button threw the work away
 * without a word. That asymmetry is invisible in a browser, which is where this
 * gets tested, and obvious on a phone, which is where it is used.
 *
 * So the hook covers all three and hands the header's prop back as its return
 * value. Wiring the arrow means calling this, and calling this covers the other
 * two — the correct thing is the only convenient thing:
 *
 *     const confirmBack = useUnsavedGuard({ dirty, message: DISCARD_CREW,
 *                                           onLeave: () => router.replace(backTo) });
 *     <ScreenHeader title="…" confirmBack={confirmBack} />
 *
 * `beforeunload` gets no custom text on purpose. Browsers have refused to show
 * one for years and display their own wording; passing a message only makes the
 * call look like it does something it does not.
 */

import { useEffect, useRef } from "react";
import { confirmDestructive } from "./confirm";

export function useUnsavedGuard({
  dirty,
  message,
  onLeave,
}: {
  /** Whether there is anything worth asking about. */
  dirty: boolean;
  /** One of the DISCARD_* strings in ./confirm. */
  message: string;
  /** Where the hardware back button goes once the person confirms. */
  onLeave: () => void;
}): string | undefined {
  // Callers pass an inline arrow, so onLeave is a new function every render.
  // Keeping it in a ref means the listener is registered once per dirty spell
  // rather than once per keystroke — registering and tearing down a native
  // listener on every character typed is how a form starts dropping the button
  // press that comes in between.
  const leave = useRef(onLeave);
  useEffect(() => {
    leave.current = onLeave;
  }, [onLeave]);

  // The tab closing, or a reload. The browser writes the wording.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Android's hardware back. Only exists inside the app; the import throws on
  // the web, which is the cheapest way to ask "are we on a device".
  useEffect(() => {
    if (!dirty) return;
    let off: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const handle = await App.addListener("backButton", () => {
          confirmDestructive(message, () => leave.current());
        });
        if (cancelled) void handle.remove();
        else off = () => void handle.remove();
      } catch {
        /* not a device */
      }
    })();
    return () => {
      cancelled = true;
      off?.();
    };
  }, [dirty, message]);

  // For ScreenHeader / FloatingActions confirmBack.
  return dirty ? message : undefined;
}
