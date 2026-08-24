# SiteTrack — Construction Workforce Attendance & Live Site Tracking

A production-shaped workforce management app for construction sites, with three
roles:

- **Employee** (mobile-first): geofenced check-in with selfie capture, live GPS
  tracking during the shift (polyline route, working clock, distance), mid-shift
  and end-of-day work updates, attendance calendar with per-day details
  (selfies, timestamps, route), route history with playback, permissions &
  privacy controls, and offline-first capture with auto-sync.
- **Manager**: KPI dashboard, live workforce map with per-employee live
  tracking, project management with an interactive geofence editor (circle +
  custom polygon), employee management/assignment, attendance module with
  filters and CSV/PDF export, historical movement replay with a playback
  scrubber + dwell timeline, transparent performance scoring, and reports.
- **Product Owner / Super Admin**: organisation-wide overview (portfolio
  health per manager, role mix, org attendance trend, operational alerts),
  team & role administration (promote/demote between employee and manager,
  activate/deactivate, add people), and a governance surface (org tracking
  policy, access model, audit trail with export, full JSON data export). The
  super admin can also open any manager surface while keeping the admin
  navigation.

Everything runs client-side — a localStorage-persisted store with a
deterministic 14-day seeded demo dataset and a simulated **or** real
(`navigator.geolocation`) GPS engine — so every flow is demoable immediately
with no backend.

## Run

```bash
npm install
npm run dev     # → http://localhost:3000
npm run build   # production build
npm start       # serve the production build
```

All routes prerender statically; `STATIC_EXPORT=true npm run build` emits a
static `out/` directory for any static host.

## Demo walkthrough

1. Open the app → pick **Employee** → choose a worker → enter any 4-digit OTP.
2. Use the **Demo GPS** switcher on Home ("Walk to gate" / "Jump on site") to
   move inside the geofence — the Check In button unlocks only inside the
   boundary.
3. Check in (selfie or placeholder) and watch live tracking draw your route;
   add work updates; check out and file the daily summary.
4. Sign out → **Manager** (any 4-digit OTP) for the dashboard, live map,
   geofence editor, movement history playback, attendance and reports.
5. Sign out → **Product Owner / Super Admin** for the org overview, role
   management and governance/audit surfaces.
6. Profile → Settings switches between simulated and real device GPS, and can
   simulate offline mode to exercise the outbox/sync flow.

## Structure

- `src/lib/` — domain layer: types, geospatial math (haversine, ray-cast
  point-in-polygon, Web-Mercator), seeded dataset, client store (persistence,
  tracking engine, geofence watcher, offline outbox), derived analytics and
  CSV/print report builders.
- `src/components/` — dependency-free SVG map engine (`SiteMap`: pan/zoom,
  procedural plan/satellite ground, geofences, polylines, markers, playback),
  geofence editor, route review, selfie capture, charts and the `.wf`-scoped
  UI kit.
- `src/app/` — routes: `/` (role gate + sign-in), `/employee/*`, `/manager/*`,
  `/admin/*` (super admin).

Maps render real **OpenStreetMap** raster tiles (© OpenStreetMap contributors,
[openstreetmap.org/copyright](https://www.openstreetmap.org/copyright)) on the
app's own SVG Web-Mercator engine — dark-filtered to match the theme, with a
light-cartography toggle in settings, and a procedural fallback ground so the
map stays usable offline while tiles can't load.

Stack: Next.js 16 (App Router) · React 19 · Tailwind CSS v4.
