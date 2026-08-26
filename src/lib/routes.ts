import type { Role } from "./types";

/**
 * Where a role lands after signing in.
 *
 * Kept in one place because the destination is decided in several — the demo
 * gate from the picked role, the live gate from the role on the database
 * record, the role guard when it turns someone away — and those must not
 * drift apart.
 */
export function homeFor(role: Role): string {
  switch (role) {
    case "superadmin":
      return "/platform";
    case "admin":
      return "/admin";
    case "manager":
      return "/manager";
    default:
      return "/employee";
  }
}

/** Which role's section a path belongs to, or null for anything else. */
export function sectionOf(path: string): Role | null {
  if (path.startsWith("/platform")) return "superadmin";
  if (path.startsWith("/admin")) return "admin";
  if (path.startsWith("/manager")) return "manager";
  if (path.startsWith("/employee")) return "employee";
  return null;
}

/**
 * Whether someone signed in as `session` may enter `section`.
 *
 * A super admin may open client surfaces — they arrive there by impersonation
 * — and a client admin may use the manager surfaces inside their own org.
 * Neither may take an employee's screens: those are one worker's own record.
 */
export function canEnter(session: Role | undefined, section: Role): boolean {
  if (!session) return false;
  return (
    session === section ||
    (session === "superadmin" && section !== "employee") ||
    (session === "admin" && section === "manager")
  );
}

/* ------------------------------------------------ interrupted navigation */

const PENDING_KEY = "workfence.pendingPath";

/**
 * Park where someone was heading when they were sent to sign in.
 *
 * Opening a link to a specific screen and being dropped on the dashboard
 * instead is a small failure with an annoying shape: the app knew where you
 * wanted to go, made you authenticate, and then forgot. Session storage is
 * the right lifetime — the intent belongs to this visit, in this tab, and
 * should not outlive it.
 */
export function rememberDestination(path: string): void {
  // A bare role home is not worth replaying; it is where they would land
  // anyway, and storing it only risks a stale redirect later.
  if (!path || sectionOf(path) === null || path === homeFor(sectionOf(path)!)) {
    return;
  }
  try {
    sessionStorage.setItem(PENDING_KEY, path);
  } catch {
    /* private mode or storage disabled — the fallback home is fine */
  }
}

/**
 * Consume a parked destination, or null if there is none the signed-in role
 * may actually open.
 *
 * Two rules, both about not trusting what comes back out: the value must be
 * a plain in-app path — never protocol-relative, which would leave the site
 * — and the role that just signed in must be allowed there. Otherwise a
 * worker who followed a manager's link would authenticate and be handed a
 * screen the guard is about to throw them out of.
 */
export function takeDestination(role: Role): string | null {
  let path: string | null = null;
  try {
    path = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    return null;
  }
  if (!path || !path.startsWith("/") || path.startsWith("//")) return null;
  const section = sectionOf(path);
  return section && canEnter(role, section) ? path : null;
}

/** Where to send someone who has just signed in as `role`. */
export function landingFor(role: Role): string {
  return takeDestination(role) ?? homeFor(role);
}
