"use client";

/**
 * Platform "More" — the console surfaces that do not earn a permanent tab
 * on a phone: the plan catalogue, usage, feature switches, the audit trail,
 * settings. Same shape as the client personas' More, so the owner's thumb
 * already knows where everything is. On a desk the sidebar lists all of
 * these directly and this screen is never needed.
 */

import Link from "next/link";
import { AccountPanel, ScreenHeader } from "@/components/shell";
import { PersonaMenuEntry } from "@/components/demo/PersonaMenuEntry";
import { usePlatform } from "@/lib/platform-store";
import {
  IAlert,
  IChart,
  ICheckCircle,
  IChevronR,
  ISettings,
  IShield,
} from "@/components/WfIcons";

const ITEMS: Array<{ href: string; icon: React.ReactNode; label: string; sub: string }> = [
  {
    href: "/platform/subscriptions",
    icon: <ICheckCircle size={18} />,
    label: "Subscriptions & plans",
    sub: "The catalogue, prices, limits and who is on what",
  },
  {
    href: "/platform/usage",
    icon: <IChart size={18} />,
    label: "Usage & analytics",
    sub: "How much each client actually uses the product",
  },
  {
    href: "/platform/features",
    icon: <IShield size={18} />,
    label: "Feature management",
    sub: "Global switches and per-client overrides",
  },
  {
    href: "/platform/audit",
    icon: <IAlert size={18} />,
    label: "Audit trail",
    sub: "Every change made from this console, by whom",
  },
  {
    href: "/platform/settings",
    icon: <ISettings size={18} />,
    label: "Platform settings",
    sub: "Defaults for new companies, signups, maintenance",
  },
];

export default function PlatformMore() {
  const { platform } = usePlatform();
  const clients = platform.organizations.length;
  return (
    <div>
      <ScreenHeader
        title="More"
        sub={`Platform console · ${clients} ${clients === 1 ? "client" : "clients"}`}
      />
      <div className="flex flex-col gap-4 px-4">
        <div className="wf-card wf-list overflow-hidden">
          {ITEMS.map((it) => (
            <Link key={it.href} href={it.href} className="wf-row">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--wf-fill-2)]">
                {it.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[0.92rem] font-semibold">{it.label}</span>
                <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
                  {it.sub}
                </span>
              </span>
              <IChevronR size={16} className="shrink-0 text-[var(--wf-faint)]" />
            </Link>
          ))}
        </div>
        <PersonaMenuEntry />
        <AccountPanel />
      </div>
    </div>
  );
}
