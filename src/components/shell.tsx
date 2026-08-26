"use client";

/**
 * App shells: role guard, phone-frame wrapper, bottom tab bars and the
 * shared status strip (offline banner, outbox count, tracking indicator).
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { usePlatform } from "@/lib/platform-store";
import { useWorkforce } from "@/lib/store";
import type { Role } from "@/lib/types";
import { roleLabel } from "@/lib/format";
import { canEnter, rememberDestination } from "@/lib/routes";
import { isLiveBackend } from "@/lib/supabase/client";
import { Avatar, BottomSheet, Chip } from "./ui";
import { SyncBanner } from "./SyncBanner";
import {
  IBell,
  ICalendar,
  IClipboard,
  IGrid,
  IHardHat,
  IHistory,
  IHome,
  ILogout,
  IMap,
  IShield,
  IUser,
  IUsers,
} from "./WfIcons";

/**
 * Redirects to the gate when the required role isn't signed in.
 * The super admin (product owner) may also browse manager surfaces.
 */
export function RoleGuard({
  role,
  children,
}: {
  role: Role;
  children: React.ReactNode;
}) {
  const { state } = useWorkforce();
  const router = useRouter();
  const pathname = usePathname();
  const ok = canEnter(state.session?.role, role);
  useEffect(() => {
    if (ok) return;
    // Park where they were going before sending them to sign in, so the gate
    // can finish the journey instead of dropping them on a dashboard.
    rememberDestination(pathname);
    router.replace("/");
  }, [ok, pathname, router]);
  if (!ok) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <p className="text-sm text-[var(--wf-muted)]">Redirecting to sign in…</p>
      </div>
    );
  }
  // Every authenticated surface passes through here, which makes it the one
  // place a failed write has to be announced from.
  return (
    <>
      <SyncBanner />
      {children}
    </>
  );
}

/* ------------------------------------------------------------ tab bars */

const EMPLOYEE_TABS = [
  { href: "/employee", label: "Home", icon: IHome },
  { href: "/employee/attendance", label: "Attendance", icon: ICalendar },
  { href: "/employee/updates", label: "Updates", icon: IClipboard },
  { href: "/employee/history", label: "History", icon: IHistory },
  { href: "/employee/profile", label: "Profile", icon: IUser },
];

const MANAGER_TABS = [
  { href: "/manager", label: "Dashboard", icon: IGrid },
  { href: "/manager/projects", label: "Projects", icon: IHardHat },
  { href: "/manager/workforce", label: "Workforce", icon: IUsers },
  { href: "/manager/attendance", label: "Attendance", icon: ICalendar },
  { href: "/manager/more", label: "More", icon: IMap },
];

const ADMIN_TABS = [
  { href: "/admin", label: "Overview", icon: IGrid },
  { href: "/manager/projects", label: "Projects", icon: IHardHat },
  { href: "/admin/team", label: "Team & Roles", icon: IUsers },
  { href: "/manager/attendance", label: "Attendance", icon: ICalendar },
  { href: "/admin/governance", label: "Governance", icon: IShield },
];

export function TabBar({ role }: { role: Role }) {
  const pathname = usePathname();
  const { state } = useWorkforce();
  // A signed-in super admin keeps the admin nav even on manager surfaces,
  // so browsing projects/attendance never strands them in the manager shell.
  const effective =
    state.session?.role === "admin" || state.session?.role === "superadmin"
      ? "admin"
      : role;
  const tabs =
    effective === "employee"
      ? EMPLOYEE_TABS
      : effective === "admin"
        ? ADMIN_TABS
        : MANAGER_TABS;
  const base =
    effective === "employee" ? "/employee" : effective === "admin" ? "/admin" : "/manager";
  return (
    <nav
      aria-label="Primary"
      className="wf-tabbar wf-safe-bottom sticky bottom-0 z-40"
    >
      {tabs.map((t) => {
        const active =
          t.href === base
            ? pathname === base || pathname === `${base}/`
            : pathname.startsWith(t.href);
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            className="wf-tab"
            data-active={active}
            aria-current={active ? "page" : undefined}
          >
            <Icon size={21} />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/* -------------------------------------------------------- status strip */

export function StatusStrip() {
  const { online, state, openShift } = useWorkforce();
  const queued = state.outbox.length;
  if (online && !openShift) return null;
  return (
    <div className="pointer-events-none sticky top-0 z-40 flex flex-col gap-1 px-3 pt-2">
      {!online && (
        <div className="pointer-events-auto flex items-center justify-between rounded-xl border border-[var(--wf-amber-edge)] bg-[color-mix(in_srgb,var(--wf-amber)_18%,var(--wf-surface))] px-3 py-2 text-[0.78rem] font-semibold text-[var(--wf-amber-hi)] shadow-lg backdrop-blur">
          <span>Offline mode</span>
          <span className="tabular-nums">
            {queued > 0 ? `${queued} record${queued === 1 ? "" : "s"} waiting to sync` : "capturing locally"}
          </span>
        </div>
      )}
      {openShift && (
        <div className="pointer-events-auto flex items-center justify-center gap-2 rounded-xl border border-[var(--wf-green-edge)] bg-[color-mix(in_srgb,var(--wf-green)_18%,var(--wf-surface))] px-3 py-1.5 text-[0.72rem] font-bold text-[var(--wf-green)] shadow-lg backdrop-blur">
          <span
            className="wf-pulse-dot"
            style={{ background: "var(--wf-red)", width: 8, height: 8 }}
          />
          LIVE LOCATION TRACKING ACTIVE
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- header */

/**
 * Shown at the top of every client surface while a Super Admin is viewing a
 * tenant's workspace, so it is never ambiguous whose data is on screen.
 */
export function ImpersonationBanner() {
  const { platform, stopImpersonation } = usePlatform();
  const router = useRouter();
  const imp = platform.impersonating;
  if (!imp) return null;
  const org = platform.organizations.find((o) => o.id === imp.orgId);
  return (
    <div className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-2 bg-[var(--wf-violet)] px-4 py-2 text-center text-[0.76rem] font-bold text-[var(--wf-on-violet)]">
      Super Admin view — {org?.name ?? "client"} · audited
      <button
        className="cursor-pointer rounded-md bg-black/20 px-2 py-0.5 text-[0.7rem] hover:bg-black/30"
        onClick={() => {
          stopImpersonation();
          router.push("/platform/clients");
        }}
      >
        Return to platform
      </button>
    </div>
  );
}

export function ScreenHeader({
  title,
  sub,
  back,
  action,
  account = true,
}: {
  title: string;
  sub?: string;
  back?: string;
  action?: React.ReactNode;
  /** Set false on screens that supply their own account affordance. */
  account?: boolean;
}) {
  const router = useRouter();
  return (
    <header className="flex items-center gap-3 px-4 pb-3 pt-4">
      {back ? (
        <button
          aria-label="Go back"
          onClick={() => router.push(back)}
          className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-xl border border-[var(--wf-line)] bg-[var(--wf-surface)] text-[var(--wf-muted)] transition hover:text-[var(--wf-fg)]"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 5-7 7 7 7" />
          </svg>
        </button>
      ) : null}
      <div className="min-w-0 flex-1">
        <h1 className="wf-display truncate text-[1.28rem] font-bold leading-tight">
          {title}
        </h1>
        {sub ? (
          <p className="truncate text-[0.78rem] text-[var(--wf-muted)]">{sub}</p>
        ) : null}
      </div>
      {action}
      {account ? <AccountMenu /> : null}
    </header>
  );
}

/**
 * Signed-in identity + sign out, reachable from the header of every screen
 * so leaving a session never means hunting through settings tabs.
 */
export function AccountMenu() {
  const { state, currentUser, logout } = useWorkforce();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (!currentUser) return null;

  const role = state.session?.role ?? currentUser.role;
  const label = roleLabel(role);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={`Account — ${currentUser.name}. Open menu to sign out`}
        title="Account"
        className="shrink-0 cursor-pointer rounded-full ring-2 ring-transparent transition hover:ring-[var(--wf-line-strong)]"
      >
        <Avatar name={currentUser.name} hue={currentUser.avatarHue} size={38} />
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} title="Account">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Avatar name={currentUser.name} hue={currentUser.avatarHue} size={52} />
            <div className="min-w-0 flex-1">
              <p className="wf-display truncate text-lg font-bold">{currentUser.name}</p>
              <p className="truncate text-[0.78rem] text-[var(--wf-muted)]">
                {currentUser.designation} · {currentUser.employeeCode}
              </p>
            </div>
            <Chip
              tone={
                role === "superadmin" || role === "admin"
                  ? "violet"
                  : role === "manager"
                    ? "amber"
                    : "blue"
              }
            >
              {label}
            </Chip>
          </div>
          <button
            className="wf-btn wf-btn-ghost"
            onClick={() => {
              setOpen(false);
              logout();
              router.replace("/");
            }}
          >
            <ILogout size={17} /> Sign out
          </button>
          <p className="text-center text-[0.7rem] text-[var(--wf-faint)]">
            Signing out stops any location tracking and returns to the sign-in
            screen. Your records stay on this device.
          </p>
          <BackendModeNote />
        </div>
      </BottomSheet>
    </>
  );
}

/**
 * Which backend this build is talking to.
 *
 * Worth showing rather than inferring: the demo and live builds are visually
 * identical, so without this the only way to tell a deployment that reached
 * Postgres from one quietly serving seed data is to open the console.
 */
function BackendModeNote() {
  return (
    <p className="flex items-center justify-center gap-1.5 border-t border-[var(--wf-line)] pt-3 text-[0.68rem] text-[var(--wf-faint)]">
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{
          background: isLiveBackend ? "var(--wf-green)" : "var(--wf-faint)",
        }}
      />
      {isLiveBackend ? "Connected to Supabase" : "Demo mode — seeded sample data"}
    </p>
  );
}

export function NotificationBell({ role }: { role: Role; }) {
  const { state } = useWorkforce();
  const unread = state.notifications.filter(
    (n) =>
      n.audience === role &&
      !n.read &&
      (!n.userId || n.userId === state.session?.userId),
  ).length;
  const href =
    role === "employee"
      ? "/employee/profile?tab=alerts"
      : "/manager/more?tab=alerts";
  return (
    <Link
      href={href}
      aria-label={`Notifications${unread ? ` — ${unread} unread` : ""}`}
      className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[var(--wf-line)] bg-[var(--wf-surface)] text-[var(--wf-muted)] transition hover:text-[var(--wf-fg)]"
    >
      <IBell size={19} />
      {unread > 0 && (
        <span className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--wf-red)] px-1 text-[0.6rem] font-bold text-white">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
