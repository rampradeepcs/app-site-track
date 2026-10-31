"use client";

/**
 * Installs the history-depth stamp (lib/nav-history.ts) as soon as the client
 * bundle loads — at module scope, so it is in place before the router writes
 * its first history entry, not after the first render.
 */

import { installHistoryDepth } from "@/lib/nav-history";

installHistoryDepth();

export function HistoryDepth() {
  return null;
}
