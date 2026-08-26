# Workfence — Construction Workforce Attendance & Live Site Tracking

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

## Signing up

`/start` is the way in for a company that does not exist yet: four highlight
screens, then name and mobile with a one-time code, the company name, a first
site placed on a map with its boundary and tracking policy, an optional office,
and a crew invited from the phone's own contacts, or by hand.

**Adding the crew** uses whichever picker the device has, and they are not
the same. The Android app registers a small `ContactPicker` plugin that
launches the *system* picker — one contact per tap, and no permission
declared or requested, because Android hands back a read grant for the single
row the user chose. A browser gets Chrome's Contact Picker API, which is
multi-select and equally permissionless but exists on almost nothing else.
Everywhere else, name and number are typed in — the path that always works.

Taking the system picker over `@capacitor-community/contacts` was deliberate:
that plugin gates every call, `pickContact` included, behind an alias grouping
`READ_CONTACTS` **and** `WRITE_CONTACTS`, and Capacitor grants an alias only
when every permission in it is granted. Inviting a crew would have meant
declaring write access to the address book, and asking a worker to hand over
their whole contact list, to read one name and one number.

It collects what makes attendance work on day one and nothing more. Billing,
tax details and branding are asked for later, by the screens that need them —
a construction company signing up from a site has no patience for a form that
does not lead to a worker checking in.

The last step provisions the tenant in one write, and the empty dashboard it
lands on says what is missing rather than showing zeroes with no explanation.
That panel clears itself on the first check-in.

Both backends do the same thing by different routes. With no credentials
`provisionCompany` (workforce store) and `onboardClient` (platform store)
create the operational and commercial halves; against Supabase a single
`provision_company()` RPC does both in one transaction, because until it runs
the caller belongs to no organisation and no row-level-security policy could
admit their writes. See [`supabase/README.md`](supabase/README.md).

### Tracking policy

A project chooses, at creation or any time after, whether on-site movement is
recorded:

|                            | Track inside the boundary **on**      | **off**                                                                   |
| -------------------------- | ------------------------------------- | ------------------------------------------------------------------------- |
| What is recorded           | the whole shift, check-in to checkout | only trips outside the boundary                                           |
| On-site movement           | part of the record                    | never recorded                                                            |
| Where checkout is accepted | anywhere                              | only inside a premise the worker is assigned to — any site, or the office |

The second mode is for crews whose on-site movement is nobody's business but
whose trips away from it are: material runs, client visits, site-to-site
transfers. Its checkout rule is not an extra restriction bolted on — it is what
makes the mode coherent. If the shift could be closed anywhere, a worker could
leave and end the trail mid-trip, and there would be no way to tell a finished
day from an abandoned one.

Because such a trail is a series of separate excursions rather than one
journey, each one opens with a segment marker: the map draws them as separate
trips instead of a line through the site nobody was watching, and the odometer
does not count distance across the gap.

Premises are marked as a **site** or an **office**; both can start and end a
shift, which is what lets a crew sign off at the office after a delivery
instead of driving back.

Every mutation lands in a local store first — so the app is instant and keeps
working with no signal, which is what a site needs — and is then pushed to
Postgres. Anything captured offline queues in an outbox and uploads on
reconnect; a write that fails says so on screen rather than leaving a manager
looking at a project that exists only on their phone.

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

- **Local** — the localStorage store on its own. The whole product works,
  starting from an empty install: create a company, add your crew, work
  shifts. Nothing leaves the device and no code is ever sent, so any 4 digits
  pass the verify step.
- **Live** — Postgres via Supabase: real OTP sign-in, row-level security
  enforcing tenant isolation, and every mutation persisted — shifts, trails,
  work updates, people, premises, rosters and boundaries.

The account sheet on every screen says which mode the running build is in; the
two are otherwise indistinguishable by eye.

Ids are minted by the client, not the database, so a record has one identity
in both places. That is what makes the optimistic write safe: nothing has to
be rewritten when the server answers, so nothing is broken if it never does.

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

## Starting from nothing

A fresh install has no organisation, no people, no premises and no history.
That is not a limitation to work around — it is the point. There are no demo
identities to sign in as and no placeholder company to mistake for a real one,
because the product now has a front door: `/start` creates a company, and
everything after that is something a person actually did.

The first screen says so. With no company on the device it welcomes you and
offers to create one; once a company exists it asks for the mobile number you
were added with, and the code step follows. Both gates work that way now — the
role picker that used to list four invented people is gone, and with it the
implication that anyone chooses their own role.

`supabase/bootstrap.sql` starts from the same nothing, seating only the
platform owner. That row is a real person with a real number, because a
one-time code has to reach a handset that exists; it is the one record that
cannot arrive through the app, since the thing that creates everyone else is a
signed-in session that does not yet exist.

**One consequence worth knowing:** the platform portal (`/platform/*`) needs a
real backend. The platform owner is a person, not a seed row, so on a build
with no Supabase credentials there is nobody to open it as, and the route
redirects. Inventing a local owner would be exactly the placeholder data this
removed.

## Walkthrough

1. Open the app → **Create your company** → four highlight screens.
2. Your name and mobile, a one-time code, the company name.
3. Place your first site on the map, size its boundary, choose whether on-site
   movement is recorded, optionally add an office.
4. Invite your crew — from the phone's contacts on Android, by hand elsewhere.
5. You land on the admin dashboard, which is honestly empty and says what to
   do next. That panel clears on the first check-in.
6. Sign out, sign back in with a crew member's number, and check in on the
   site you just drew.

Profile → Settings switches between real device GPS and a simulator, for
trying the product away from a real boundary, and can force offline mode to
exercise the outbox.

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

**Not** declared: anything for contacts. The signup wizard reads a contact
through `ACTION_PICK`, which returns a one-shot read grant for the row the
user picked — so the app never holds address-book access, and there is
nothing to justify to Play Store review.

`ACCESS_BACKGROUND_LOCATION` requires a Play Store justification: tracking runs
only between check-in and checkout, is disclosed in-app before it starts, and
is visible throughout via the foreground-service notification.
