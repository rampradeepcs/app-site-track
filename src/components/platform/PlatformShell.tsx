"use client";

/**
 * Super Admin portal chrome.
 *
 * Two shapes for one console. On a desk it is the sidebar it always was —
 * every surface one click away, the owner's name at the foot. On a phone
 * it is the same shell as everyone else's: the page, and a bar along the
 * bottom with the four surfaces that get opened every day and More for
 * the rest. The platform owner runs it from both, so neither gives way.
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { usePlatform } from "@/lib/platform-store";
import { useWorkforce } from "@/lib/store";
import { Avatar } from "@/components/ui";
import { TabBar } from "@/components/shell";
import {
  IAlert,
  IBell,
  IChart,
  ICheckCircle,
  IFile,
  IGrid,
  IHardHat,
  ILogout,
  IShield,
  IUsers,
} from "@/components/WfIcons";

const NAV = [
  { href: "/platform", label: "Dashboard", icon: IGrid },
  { href: "/platform/clients", label: "Clients", icon: IHardHat },
  { href: "/platform/subscriptions", label: "Subscriptions", icon: ICheckCircle },
  { href: "/platform/billing", label: "Billing", icon: IFile },
  { href: "/platform/usage", label: "Usage & Analytics", icon: IChart },
  { href: "/platform/features", label: "Feature Management", icon: IShield },
  { href: "/platform/support", label: "Support", icon: IBell },
  { href: "/platform/audit", label: "Audit Logs", icon: IAlert },
  { href: "/platform/settings", label: "Settings", icon: IUsers },
];

/** Only the platform Super Admin may enter; everyone else goes to the gate. */
export function PlatformGuard({ children }: { children: React.ReactNode }) {
  const { state } = useWorkforce();
  const router = useRouter();
  const ok = state.session?.role === "superadmin";
  useEffect(() => {
    if (!ok) router.replace("/");
  }, [ok, router]);
  if (!ok) {
    return (
      <div className="grid min-h-[calc(100dvh-var(--wf-safe-top))] place-items-center">
        <p className="text-sm text-[var(--wf-muted)]">Redirecting to sign in…</p>
      </div>
    );
  }
  return <>{children}</>;
}

export function PlatformShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { currentUser, logout } = useWorkforce();
  const { platform, stopImpersonation } = usePlatform();
  const router = useRouter();

  const openTickets = platform.tickets.filter((t) => t.status !== "resolved").length;

  return (
    <div className="min-h-[calc(100dvh-var(--wf-safe-top))] md:flex">
      {/* impersonation is a privileged action — never let it be invisible */}
      {platform.impersonating && (
        <div className="fixed inset-x-0 top-[var(--wf-safe-top)] z-50 flex items-center justify-center gap-3 bg-[var(--wf-violet)] px-4 py-2 text-[0.8rem] font-bold text-[var(--wf-on-violet)]">
          Viewing{" "}
          {platform.organizations.find((o) => o.id === platform.impersonating!.orgId)?.name}
          {" "}as their admin — all actions are audited
          <button
            className="cursor-pointer rounded-md bg-black/20 px-2 py-0.5 text-[0.72rem] hover:bg-black/30"
            onClick={() => {
              stopImpersonation();
              router.push("/platform/clients");
            }}
          >
            Exit
          </button>
        </div>
      )}

      {/* sidebar — the desk's navigation; the phone has the bar below */}
      <aside className="hidden border-[var(--wf-line)] bg-[var(--wf-surface)] md:sticky md:top-[var(--wf-safe-top)] md:block md:h-[calc(100dvh-var(--wf-safe-top))] md:w-60 md:shrink-0 md:border-r">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--wf-violet)] text-[0.8rem] font-bold text-[var(--wf-on-violet)]">
            SA
          </span>
          <span>
            <span className="wf-display block text-[0.95rem] leading-tight">Workfence</span>
            <span className="block text-[0.66rem] uppercase tracking-wider text-[var(--wf-violet)]">
              Platform console
            </span>
          </span>
        </div>
        <nav aria-label="Platform" className="flex flex-col gap-0.5 px-3">
          {NAV.map((n) => {
            const active =
              n.href === "/platform"
                ? pathname === "/platform"
                : pathname.startsWith(n.href);
            const Icon = n.icon;
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[0.86rem] font-semibold transition ${
                  active
                    ? "bg-[var(--wf-violet-soft)] text-[var(--wf-violet)]"
                    : "text-[var(--wf-muted)] hover:bg-[var(--wf-surface2)] hover:text-[var(--wf-fg)]"
                }`}
              >
                <Icon size={17} />
                <span className="flex-1">{n.label}</span>
                {n.label === "Support" && openTickets > 0 && (
                  <span className="rounded-full bg-[var(--wf-red)] px-1.5 py-0.5 text-[0.6rem] font-bold text-white">
                    {openTickets}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto flex items-center gap-2.5 border-t border-[var(--wf-line)] p-4">
          <Avatar name={currentUser?.name ?? "?"} hue={currentUser?.avatarHue ?? 265} photo={currentUser?.photo} size={34} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.8rem] font-semibold">{currentUser?.name}</span>
            <span className="block text-[0.66rem] text-[var(--wf-muted)]">Product Owner</span>
          </span>
          <button
            aria-label="Sign out"
            title="Sign out"
            className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg text-[var(--wf-muted)] transition hover:bg-[var(--wf-surface2)] hover:text-[var(--wf-fg)]"
            onClick={() => {
              logout();
              router.replace("/");
            }}
          >
            <ILogout size={16} />
          </button>
        </div>
      </aside>

      {/* On a phone the page and the bar share a column, so the bar sits at
          the foot of a short page and sticks under a long one — the same
          arrangement the admin, manager and employee shells use. */}
      <div className="flex min-h-[calc(100dvh-var(--wf-safe-top))] min-w-0 flex-1 flex-col md:min-h-0">
        <main className={`min-h-0 min-w-0 flex-1 pb-4 ${platform.impersonating ? "pt-9" : ""}`}>
          {children}
        </main>
        {/* `contents`, not a box: a sticky bar can only travel within its
            parent, and a wrapper the height of the bar would pin it to the
            end of the page instead of the foot of the screen. */}
        <div className="contents md:hidden">
          <TabBar role="superadmin" />
        </div>
      </div>
    </div>
  );
}

/** Page heading used across the portal. */
export function PageHead({
  title,
  sub,
  action,
  back,
}: {
  title: string;
  sub?: string;
  action?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 px-5 pb-4 pt-6">
      <div className="min-w-0">
        {back && (
          <Link
            href={back.href}
            className="mb-1 inline-flex items-center gap-1 text-[0.74rem] font-semibold text-[var(--wf-muted)] hover:text-[var(--wf-fg)]"
          >
            ← {back.label}
          </Link>
        )}
        <h1 className="wf-display truncate text-[1.5rem] leading-tight">{title}</h1>
        {sub ? <p className="text-[0.82rem] text-[var(--wf-muted)]">{sub}</p> : null}
      </div>
      {action}
    </header>
  );
}
