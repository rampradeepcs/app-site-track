"use client";

/**
 * Admin "More" — the modules that don't earn a permanent tab: shifts,
 * payroll, live map, reports, governance. Each row is shown only when the
 * plan includes the feature and the signed-in role may use it, so this menu
 * is also the honest map of what this organisation actually has.
 */

import Link from "next/link";
import { useEntitlements } from "@/components/FeatureGate";
import { AccountPanel, ScreenHeader } from "@/components/shell";
import { PersonaMenuEntry } from "@/components/demo/PersonaMenuEntry";
import { Chip } from "@/components/ui";
import { useWorkforce } from "@/lib/store";
import type { FeatureSet } from "@/lib/saas-types";
import {
  IBell,
  IChart,
  IChevronR,
  IClipboard,
  IClock,
  IFile,
  ILayers,
  IMapPin,
  INav,
  IShield,
  IWallet,
} from "@/components/WfIcons";

interface Item {
  href: string;
  icon: React.ReactNode;
  label: string;
  sub: string;
  /** Plan feature that unlocks the row; undefined = always on. */
  feature?: keyof FeatureSet;
  /** Roles that may see the row. */
  roles: Array<"admin" | "manager" | "superadmin">;
}

const ITEMS: Item[] = [
  {
    href: "/manager/shifts",
    icon: <IClock size={18} />,
    label: "Shifts & breaks",
    sub: "Shift definitions, break rules, overtime, assignment",
    feature: "shifts",
    roles: ["admin", "manager", "superadmin"],
  },
  {
    href: "/manager/payroll",
    icon: <IWallet size={18} />,
    label: "Payroll",
    sub: "Monthly runs, OT approvals, exports",
    feature: "payroll",
    roles: ["admin", "manager", "superadmin"],
  },
  {
    href: "/manager/travel",
    icon: <INav size={18} />,
    label: "Travel & allowance",
    sub: "Work travel, petrol and food rules, approvals",
    feature: "petrolAllowance",
    roles: ["admin", "manager", "superadmin"],
  },
  {
    href: "/manager/live",
    icon: <IMapPin size={18} />,
    label: "Live map",
    sub: "Everyone on shift, right now",
    feature: "liveTracking",
    roles: ["admin", "manager", "superadmin"],
  },
  /* Two destinations, not one stop on the way to them. This pointed at
     /manager/more, so reaching a report meant landing on another More
     page and finding the row again. */
  {
    href: "/manager/reports",
    icon: <IFile size={18} />,
    label: "Reports",
    sub: "Attendance, workforce and payroll exports",
    roles: ["admin", "manager", "superadmin"],
  },
  {
    href: "/manager/performance",
    icon: <IChart size={18} />,
    label: "Performance",
    sub: "Last 14 days, ranked, and who needs attention",
    roles: ["admin", "manager", "superadmin"],
  },
  {
    href: "/manager/updates",
    icon: <IClipboard size={18} />,
    label: "Work updates",
    sub: "What the site reported today",
    roles: ["admin", "manager", "superadmin"],
  },
  {
    href: "/manager/alerts",
    icon: <IBell size={18} />,
    label: "Alerts",
    sub: "Geofence exits, missing checkouts, sync",
    roles: ["admin", "manager", "superadmin"],
  },
  {
    href: "/admin/governance",
    icon: <IShield size={18} />,
    label: "Governance",
    sub: "Tracking policy, privacy, audit trail, data export",
    roles: ["admin", "superadmin"],
  },
];

export default function AdminMore() {
  const { currentUser } = useWorkforce();
  const ent = useEntitlements();
  const role = currentUser?.role;
  if (role !== "admin" && role !== "manager" && role !== "superadmin") return null;

  const visible = ITEMS.filter(
    (it) =>
      it.roles.includes(role) &&
      (role === "superadmin" || !it.feature || ent.features[it.feature]),
  );

  return (
    <div>
      <ScreenHeader title="More" sub={`Modules on ${ent.planName}`} />
      <div className="flex flex-col gap-4 px-4">
        <div className="wf-card wf-list overflow-hidden">
          {visible.map((it) => (
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
        {visible.length < ITEMS.length ? (
          <p className="flex items-center gap-2 text-[0.72rem] text-[var(--wf-faint)]">
            <Chip tone="neutral">{ent.planName}</Chip>
            Some modules aren&apos;t part of this plan.
          </p>
        ) : null}

        <PersonaMenuEntry />
        <AccountPanel />
      </div>
    </div>
  );
}
