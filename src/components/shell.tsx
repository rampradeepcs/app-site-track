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
import { Avatar, Chip } from "./ui";
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
  IUsers,
  ILayers,
  IHomeFill,
  ICalendarFill,
  IClipboardFill,
  IHistoryFill,
  ILayersFill,
  IGridFill,
  IHardHatFill,
  IUsersFill,
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
      <div className="grid min-h-[calc(100dvh-var(--wf-safe-top))] place-items-center">
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
  { href: "/employee", label: "Home", icon: IHome, iconActive: IHomeFill },
  {
    href: "/employee/attendance",
    label: "Attendance",
    icon: ICalendar,
    iconActive: ICalendarFill,
  },
  {
    href: "/employee/updates",
    label: "Updates",
    icon: IClipboard,
    iconActive: IClipboardFill,
  },
  {
    href: "/employee/history",
    label: "History",
    icon: IHistory,
    iconActive: IHistoryFill,
  },
  {
    href: "/employee/more",
    label: "More",
    icon: ILayers,
    iconActive: ILayersFill,
    alsoActive: ["/employee/profile", "/employee/travel"],
  },
];

const MANAGER_TABS = [
  { href: "/manager", label: "Dashboard", icon: IGrid, iconActive: IGridFill },
  {
    href: "/manager/projects",
    label: "Projects",
    icon: IHardHat,
    iconActive: IHardHatFill,
  },
  {
    href: "/manager/workforce",
    label: "Workforce",
    icon: IUsers,
    iconActive: IUsersFill,
  },
  {
    href: "/manager/attendance",
    label: "Attendance",
    icon: ICalendar,
    iconActive: ICalendarFill,
  },
  {
    href: "/manager/more",
    label: "More",
    icon: ILayers,
    iconActive: ILayersFill,
    alsoActive: [
      "/manager/shifts",
      "/manager/payroll",
      "/manager/live",
      "/manager/travel",
    ],
  },
];

const ADMIN_TABS = [
  { href: "/admin", label: "Overview", icon: IGrid, iconActive: IGridFill },
  {
    href: "/manager/projects",
    label: "Projects",
    icon: IHardHat,
    iconActive: IHardHatFill,
  },
  {
    href: "/admin/team",
    label: "Team & Roles",
    icon: IUsers,
    iconActive: IUsersFill,
  },
  {
    href: "/manager/attendance",
    label: "Attendance",
    icon: ICalendar,
    iconActive: ICalendarFill,
  },
  {
    href: "/admin/more",
    label: "More",
    icon: ILayers,
    iconActive: ILayersFill,
    alsoActive: [
      "/manager/shifts",
      "/manager/payroll",
      "/manager/live",
      "/manager/travel",
      "/manager/more",
      "/admin/governance",
    ],
  },
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

  /*
   * The bar belongs to the tab roots only.
   *
   * A detail screen — a project, a person, the shift editor — is somewhere
   * you went *into*, and on a phone the way out of it is the back button,
   * not a second navigation surface competing with it. Every page this
   * hides the bar on has a back affordance; the three that did not have one
   * now do.
   */
  const here = pathname.replace(/\/$/, "") || "/";
  const isTabRoot = tabs.some((t) => here === t.href.replace(/\/$/, ""));

  /*
   * Scrolling down compacts the bar to its icons; scrolling back up brings
   * the labels down again. Reading a long list is when the content matters
   * most and the labels least, and the height it gives back is real estate
   * on a phone. The 6px threshold keeps a jittery finger from flickering
   * it, and being near the top always shows the full bar — there is
   * nothing to reclaim up there.
   */
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const dy = y - last;
      if (Math.abs(dy) < 6) return;
      last = y;
      setCompact(y > 64 && dy > 0);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* Anything floating above the bar measures from its live height. */
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--wf-tabbar-h",
      compact ? "44px" : "56px",
    );
  }, [compact]);

  // Reset the offset when the bar is not on screen at all, so a floating
  // chip on a detail page does not hover where a tab bar used to be.
  useEffect(() => {
    if (!isTabRoot) {
      document.documentElement.style.setProperty("--wf-tabbar-h", "0px");
    }
    return () => {
      document.documentElement.style.setProperty("--wf-tabbar-h", "56px");
    };
  }, [isTabRoot]);

  if (!isTabRoot) return null;

  return (
    <nav
      aria-label="Primary"
      data-compact={compact}
      className="wf-tabbar wf-safe-bottom sticky bottom-0 z-40"
    >
      {tabs.map((t) => {
        const owned = (t as { alsoActive?: string[] }).alsoActive ?? [];
        const active =
          t.href === base
            ? pathname === base || pathname === `${base}/`
            : pathname.startsWith(t.href) ||
              owned.some((p) => pathname.startsWith(p));
        const Icon =
          (active && (t as { iconActive?: typeof t.icon }).iconActive) || t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            className="wf-tab"
            data-active={active}
            aria-current={active ? "page" : undefined}
          >
            <Icon size={21} />
            <span className="wf-tab-label">{t.label}</span>
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
    <div className="pointer-events-none sticky top-[var(--wf-safe-top)] z-40 flex flex-col gap-1 px-3 pt-2">
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
    <div className="sticky top-[var(--wf-safe-top)] z-50 flex flex-wrap items-center justify-center gap-2 bg-[var(--wf-violet)] px-4 py-2 text-center text-[0.76rem] font-bold text-[var(--wf-on-violet)]">
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
}: {
  title: string;
  sub?: string;
  /**
   * Where the back button goes. A path pushes it; `true` steps back through
   * history instead — which is what a page reachable from more than one
   * place needs, since Shifts opens from the manager's More menu and the
   * admin's, and hard-coding either one strands the other.
   */
  back?: string | true;
  action?: React.ReactNode;
}) {
  const router = useRouter();

  /*
   * The iOS scroll edge effect: the header is transparent over the top of
   * the page and becomes a material only once content has passed under it.
   * That is what replaced the permanent 1px rule — a divider that is always
   * there separates the header from content it is not yet overlapping.
   *
   * A passive scroll listener rather than IntersectionObserver: the state
   * is a single boolean read from a value the browser already has, and it
   * only ever flips once per direction.
   */
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className="wf-navbar flex items-center gap-3 px-4 pb-3 pt-4"
      data-scrolled={scrolled}
    >
      {back ? (
        <button
          aria-label="Go back"
          onClick={() => (back === true ? router.back() : router.push(back))}
          className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-xl border border-[var(--wf-line)] bg-[var(--wf-surface)] text-[var(--wf-muted)] transition hover:text-[var(--wf-fg)]"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 5-7 7 7 7" />
          </svg>
        </button>
      ) : null}
      <div className="min-w-0 flex-1">
        <h1 className="wf-display truncate text-[1.35rem] leading-tight">
          {title}
        </h1>
        {sub ? (
          /* Both stay on one line. A two-line subtitle pushed the content
             down by a different amount on every screen, so the header sat
             at a different height depending on how long the sub happened
             to be — and the full text is never load-bearing here. */
          <p className="mt-0.5 truncate text-[0.76rem] leading-snug text-[var(--wf-muted)]">
            {sub}
          </p>
        ) : null}
      </div>
      {action}
    </header>
  );
}

/**
 * Signed-in identity + sign out, reachable from the header of every screen
 * so leaving a session never means hunting through settings tabs.
 */
/** In demo mode the account panel names the persona, not just the person. */
function DemoPersonaNote() {
  const { isDemo } = useWorkforce();
  if (!isDemo) return null;
  return (
    <p className="rounded-xl bg-[var(--wf-fill-3)] px-3 py-2 text-center text-[0.72rem] leading-relaxed text-[var(--wf-muted)]">
      Demonstration persona. Tap <span className="font-semibold">DEMO</span> above
      the tab bar to switch persona, reset or leave.
    </p>
  );
}

export function AccountPanel({
  /** Hide the identity row on screens that already show who this is. */
  identity = true,
}: {
  identity?: boolean;
} = {}) {
  const { state, currentUser, logout } = useWorkforce();
  const router = useRouter();
  if (!currentUser) return null;

  const role = state.session?.role ?? currentUser.role;

  return (
    <div className="wf-card flex flex-col gap-3.5 p-4">
      {identity ? (
      <div className="flex items-center gap-3">
        <Avatar name={currentUser.name} hue={currentUser.avatarHue} size={44} />
        <div className="min-w-0 flex-1">
          <p className="wf-display truncate font-bold">{currentUser.name}</p>
          <p className="truncate text-[0.74rem] text-[var(--wf-muted)]">
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
          {roleLabel(role)}
        </Chip>
      </div>
      ) : null}
      <button
        className="wf-btn wf-btn-ghost"
        onClick={() => {
          logout();
          router.replace("/");
        }}
      >
        <ILogout size={17} /> Sign out
      </button>
      <DemoPersonaNote />
      <p className="text-center text-[0.7rem] leading-relaxed text-[var(--wf-faint)]">
        Signing out stops any location tracking and returns to the sign-in
        screen. Your records stay on this device.
      </p>
      <BackendModeNote />
    </div>
  );
}

/**
 * Which backend this build is talking to.
 *
 * Worth showing rather than inferring: the local and live builds are visually
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
      {isLiveBackend
        ? "Connected to Supabase"
        : "Local only — this device holds the only copy"}
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
