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
import { serviceWorker } from "@/lib/device-notifications";

export function TileCache() {
  useEffect(() => {
    // The same worker shows notifications, so it is registered in one place
    // (lib/device-notifications) — under the site's base path, which the old
    // "/sw.js" missed on a build served from a sub-path. A worker needs a
    // secure context: the Capacitor shell (https://localhost), any real
    // deployment, or localhost in development. Without one there is no
    // cache, and the map fetches every tile, as it always could.
    void serviceWorker();
  }, []);
  return null;
}
