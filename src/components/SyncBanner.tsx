"use client";

/**
 * "This did not save."
 *
 * The store is optimistic: a mutation lands locally and the screen moves on
 * immediately, which is what makes the app usable on a site with no signal.
 * The cost of that bargain is that a write failing on the way to the server
 * looks exactly like one succeeding — the project is on screen either way.
 *
 * So a failure is never silent. It sits above everything until it clears,
 * says which action failed in the words the person used, and does not offer
 * a retry button it cannot honour: the reconnection handler retries the
 * queued work by itself, and a button implying otherwise would be a second
 * lie on top of the first.
 */

import { useSyncExternalStore } from "react";
import { IAlert } from "./WfIcons";
import {
  clearSyncFailure,
  lastSyncFailure,
  subscribeToSync,
  type SyncFailure,
} from "@/lib/supabase/sync";

const serverNone = (): SyncFailure | null => null;

export function SyncBanner() {
  const failure = useSyncExternalStore(
    subscribeToSync,
    lastSyncFailure,
    serverNone,
  );
  if (!failure) return null;

  return (
    <div
      role="alert"
      className="sticky top-0 z-50 flex items-start gap-2 border-b border-[var(--wf-red-edge)] bg-[var(--wf-red-soft)] px-4 py-2.5 text-[0.78rem] text-[var(--wf-red)]"
    >
      <IAlert size={15} className="mt-0.5 shrink-0" />
      <span className="min-w-0 flex-1">
        Couldn&apos;t {failure.action} on the server. {failure.message} It is
        saved on this device and will be sent when the connection returns.
      </span>
      <button
        className="shrink-0 cursor-pointer font-bold underline underline-offset-2"
        onClick={clearSyncFailure}
      >
        Dismiss
      </button>
    </div>
  );
}
