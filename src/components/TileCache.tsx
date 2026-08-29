"use client";

/**
 * Registers the map tile cache.
 *
 * Mounted once at the root. It registers and then gets out of the way —
 * the worker serves tiles transparently, so nothing in SiteMap changes and
 * nothing here has to be threaded through the app.
 *
 * A service worker only controls pages loaded *after* it activates, so the
 * first launch fetches tiles normally and the cache fills as they display.
 * That suits what this is for: the benefit is the return visit to a site,
 * which is the case that matters on a job that runs for months.
 */

import { useEffect } from "react";

export function TileCache() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // A worker needs a secure context. That covers the Capacitor shell,
    // which serves the app from https://localhost, and any real
    // deployment; a plain-http dev host simply goes without.
    if (!window.isSecureContext) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* No cache, and the map falls back to fetching every tile — which is
         exactly how it behaved before. Nothing to report to the user. */
    });
  }, []);
  return null;
}
