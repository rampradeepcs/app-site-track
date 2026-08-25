import type { Role } from "./types";

/**
 * Where a role lands after signing in.
 *
 * Kept in one place because the destination is decided twice — once by the
 * demo gate from the picked role, once by the live gate from the role stored
 * on the database record — and those two must not drift apart.
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
