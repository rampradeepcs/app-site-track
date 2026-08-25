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

## Backend

The app runs in one of two modes, decided at build time by whether
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set:

- **Demo** — the seeded localStorage store. Every flow is explorable with no
  backend at all, which is what makes the product demoable from a cold clone.
- **Live** — Postgres via Supabase, with real OTP sign-in and row-level
  security enforcing tenant isolation.

The account sheet on every screen says which mode the running build is in; the
two are otherwise indistinguishable by eye.

To go live, copy `.env.example` to `.env.local`, fill in the anon key, and
apply the migrations — see [`supabase/README.md`](supabase/README.md) for the
schema, the RLS model and the one-time bootstrap that creates the platform
owner.

## Deployment

`.github/workflows/pages.yml` builds the static export and publishes it to the
`gh-pages` branch on every push to `main`.

It needs two repository secrets (**Settings → Secrets and variables →
Actions**):

| Secret              | Value                                            |
| ------------------- | ------------------------------------------------ |
| `SUPABASE_URL`      | the project URL, e.g. `https://xxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Project Settings → API → anon public key         |

The anon key is a public credential by design — it identifies the project, it
does not authorise anything, and every browser that loads the site receives it.
RLS is what protects the data. It lives in a secret so it is easy to rotate,
not because exposure would matter.

The workflow **fails** rather than building without them, and then greps the
built bundle to confirm the URL was actually inlined. Both guards exist for the
same reason: a static export has no server, so a missing or misnamed secret
produces a perfectly healthy-looking site quietly serving seed data — which
nobody notices until someone tries to save a shift.

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

- `src/lib/saas-types.ts`, `saas-seed.ts`, `saas-metrics.ts`, `entitlements.ts`,
  `platform-store.tsx` — the multi-tenant layer: organisations, plans,
  subscriptions, invoices, usage, health scoring and the append-only platform
  audit trail.
- `src/lib/` — workforce domain layer: types, geospatial math (haversine, ray-cast
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

## Android

The employee app ships as a native Android wrapper via Capacitor. The Next.js
app is exported statically and served from the device, so the shell works with
no signal — a worker on a site without coverage can still check in, and the
outbox syncs when connectivity returns.

```bash
STATIC_EXPORT=true npm run build   # produce out/
npx cap sync android               # copy into the Android project
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

Needs JDK 21 and the Android SDK (via Android Studio, or
`sdkmanager "platforms;android-35" "build-tools;35.0.0"`).

**No local Android setup?** Push to `main` and the
`.github/workflows/android.yml` workflow builds the APK and uploads it as a
run artifact. Add `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` as repository secrets and it
also produces a signed release APK.

### Permissions

Declared in `android/app/src/main/AndroidManifest.xml`, each tied to a feature:

| Permission                                          | Why                                                                                                                                                                              |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION`   | Geofence validation and route recording. Coarse is declared too because Android 12+ allows approximate-only grants; the app degrades to a distance estimate rather than failing. |
| `ACCESS_BACKGROUND_LOCATION`                        | Keeps the route recording while the phone is pocketed. Requested separately, only after check-in, and never held outside an active shift.                                        |
| `FOREGROUND_SERVICE_LOCATION`, `POST_NOTIFICATIONS` | The persistent "tracking active" notification, which is what makes the tracking visible to the worker.                                                                           |
| `CAMERA`                                            | Check-in / checkout selfies and work-update photos.                                                                                                                              |

`ACCESS_BACKGROUND_LOCATION` requires a Play Store justification: tracking runs
only between check-in and checkout, is disclosed in-app before it starts, and
is visible throughout via the foreground-service notification.
