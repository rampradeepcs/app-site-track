/*
 * The app's one service worker: the map tile cache, and notifications.
 *
 * Notifications (at the end of this file) arrive two ways — posted by the
 * open page through registration.showNotification, and pushed by the server
 * when the site is closed — and both are tagged with the notification's id,
 * so they are always one notification, never two.
 *
 * Map tile cache.
 *
 * The app already works with no signal — GPS, geofencing, check-in and the
 * outbox are all local. The one thing that went blank was the map, because
 * its tiles are fetched from openstreetmap.org on every view. A crew
 * returns to the same gate every day, so the tiles for a site are almost
 * always ones this device has already displayed.
 *
 * Deliberately narrow: of the network, this worker touches nothing but tile
 * requests. It does not cache the app shell, which would mean shipping a
 * second, subtly stale copy of the product and a cache-busting problem to go
 * with it.
 *
 * Cache-first with a background refresh. A map tile of a road junction does
 * not change between one shift and the next, so serving the stored copy
 * immediately is both faster and correct; the network copy replaces it
 * quietly for next time. Offline, the stored copy is the whole point.
 *
 * OpenStreetMap's tile policy asks that clients cache what they fetch and
 * forbids bulk downloading. This does the first and not the second: nothing
 * is requested that the app was not already about to display.
 */

const CACHE = "wf-tiles-v1";
const TILE_HOST = "tile.openstreetmap.org";

/* Roughly a few sites' worth at the zooms this app uses. Tiles are ~15KB,
   so this is on the order of 20MB — large enough to be useful across a
   week, small enough not to be a surprise on a shared device. */
const MAX_TILES = 1200;

self.addEventListener("install", (event) => {
  // Take over as soon as this version is ready; there is no shell to
  // coordinate with, so there is nothing to break by activating early.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith("wf-tiles-") && n !== CACHE).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Keep the cache bounded, oldest first — keys() returns insertion order. */
async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_TILES) return;
  const excess = keys.length - MAX_TILES;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.hostname !== TILE_HOST) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(event.request);

      const fromNetwork = fetch(event.request)
        .then(async (res) => {
          // Opaque responses (no CORS) still serve fine from cache, and a
          // tile server error must not evict a good stored tile.
          if (res && (res.ok || res.type === "opaque")) {
            await cache.put(event.request, res.clone());
            await trim(cache);
          }
          return res;
        })
        .catch(() => null);

      if (hit) {
        // Refresh in the background; the shift does not wait for a tile.
        event.waitUntil(fromNetwork);
        return hit;
      }

      const res = await fromNetwork;
      if (res) return res;

      // Offline with nothing stored for this tile. A transparent square
      // rather than a broken-image icon: the geofence, the markers and the
      // trail are drawn over the top and are what actually matter here.
      return new Response(
        '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"></svg>',
        { headers: { "Content-Type": "image/svg+xml" }, status: 200 },
      );
    })(),
  );
});

/* ------------------------------------------------------- notifications -- */

/**
 * A path inside the app, resolved against where this worker is served.
 * Exactly one leading slash: "//elsewhere" and "/\\elsewhere" are other
 * sites to a URL parser, and a tapped notification must never be a redirect.
 * Anything that does not land inside this app opens its home instead.
 */
function appUrl(link) {
  // As isAppLink in lib/notify.ts: one leading slash, and no whitespace,
  // control character or backslash, which parsers drop or reinterpret.
  const ok = typeof link === "string" && /^\/(?![\/\\])[^\x00-\x20\x7f\\]*$/.test(link);
  const path = ok ? link.slice(1) : "";
  const url = new URL(path, self.registration.scope);
  return url.href.startsWith(self.registration.scope) ? url.href : self.registration.scope;
}

/*
 * A push from the server: the site may be closed, in the background, or open.
 * Always shown, even with the site in front: Safari takes away the push
 * subscription of a site whose pushes show nothing, three strikes and out.
 * Shown under the notification's id, the same tag the open page posts its
 * own copy with, so the two are one notification rather than two.
 */
self.addEventListener("push", (event) => {
  let n = {};
  try {
    n = event.data ? event.data.json() : {};
  } catch {
    n = { title: "Workfence", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(n.title || "Workfence", {
        body: n.body || "",
        tag: n.id || undefined,
        icon: appUrl("/icon.svg"),
        data: { link: n.link || null },
      });
    })(),
  );
});

/* Tapping one opens what it is about: in the window already open, if any. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = appUrl(event.notification.data && event.notification.data.link);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const mine = windows.find((w) => w.url.startsWith(self.registration.scope));
      if (mine) {
        await mine.focus();
        if ("navigate" in mine) await mine.navigate(target).catch(() => {});
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
