"use client";

/**
 * App shells: role guard, phone-frame wrapper, bottom tab bars and the
 * shared status strip (offline banner, outbox count, tracking indicator).
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useWorkforce } from "@/lib/store";
import type { Role } from "@/lib/types";
import { Avatar, BottomSheet, Chip } from "./ui";
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
  const sessionRole = state.session?.role;
  const ok =
    sessionRole === role || (sessionRole === "admin" && role === "manager");
  useEffect(() => {
    if (!ok) router.replace("/");
  }, [ok, router]);
  if (!ok) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <p className="text-sm text-[var(--wf-muted)]">Redirecting to sign in…</p>
      </div>
    );
  }
  return <>{children}</>;
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
  const effective = state.session?.role === "admin" ? "admin" : role;
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
        <div className="pointer-events-auto flex items-center justify-between rounded-xl border border-[rgba(246,167,35,0.4)] bg-[rgba(60,42,8,0.94)] px-3 py-2 text-[0.78rem] font-semibold text-[var(--wf-amber-hi)] shadow-lg backdrop-blur">
          <span>Offline mode</span>
          <span className="tabular-nums">
            {queued > 0 ? `${queued} record${queued === 1 ? "" : "s"} waiting to sync` : "capturing locally"}
          </span>
        </div>
      )}
      {openShift && (
        <div className="pointer-events-auto flex items-center justify-center gap-2 rounded-xl border border-[rgba(47,211,118,0.35)] bg-[rgba(7,38,20,0.92)] px-3 py-1.5 text-[0.72rem] font-bold text-[var(--wf-green)] shadow-lg backdrop-blur">
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
  const roleLabel =
    role === "admin" ? "Product Owner" : role === "manager" ? "Manager" : "Employee";

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
            <Chip tone={role === "admin" ? "violet" : role === "manager" ? "amber" : "blue"}>
              {roleLabel}
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
        </div>
      </BottomSheet>
    </>
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
