"use client";

/**
 * A company's own way in: /t/magnolia.
 *
 * The same gate as the front door, reached at an address that names one
 * company, so the sign-in screen can carry their name before anyone has
 * signed in. Everything that makes that happen already exists — the slug is
 * read from the path by lib/tenant, and the gate asks the database what to
 * call itself — so this route only has to be a route.
 *
 * One page serves every company: Vercel rewrites /t/<anything> here, and the
 * slug is read on the client. A statically exported app cannot pre-render a
 * page per tenant, because tenants are created long after the build.
 */

import WorkforceGate from "../page";

export default function TenantGate() {
  return <WorkforceGate />;
}
