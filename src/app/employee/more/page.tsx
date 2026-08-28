"use client";

/**
 * Employee "More" — the tab bar keeps the four daily surfaces, and
 * everything else lives here: profile, privacy, notifications, settings.
 * Only things this role owns appear; an employee's menu never mentions
 * anyone else's money or anyone else's records.
 */

import Link from "next/link";
import { useMemo } from "react";
import { AccountPanel, ScreenHeader } from "@/components/shell";
import { PersonaMenuEntry } from "@/components/demo/PersonaMenuEntry";
import { Avatar, Chip } from "@/components/ui";
import { fmtShiftTime, todayISO } from "@/lib/format";
import { shiftFor } from "@/lib/payroll";
import { useWorkforce } from "@/lib/store";
import { useFeature } from "@/components/FeatureGate";
import {
  IBell,
  IChevronR,
  IClock,
  INav,
  ISettings,
  IShield,
  IUser,
} from "@/components/WfIcons";

export default function EmployeeMore() {
  const { state, currentUser } = useWorkforce();
  const petrolOn = useFeature("petrolAllowance");

  const unread = useMemo(
    () =>
      state.notifications.filter(
        (n) =>
          n.audience === "employee" &&
          !n.read &&
          (!n.userId || n.userId === currentUser?.id),
      ).length,
    [state.notifications, currentUser],
  );

  const shift = useMemo(
    () => (currentUser ? shiftFor(state, currentUser.id, todayISO()) : null),
    [state, currentUser],
  );

  if (!currentUser) return null;

  const items: Array<{
    href: string;
    icon: React.ReactNode;
    label: string;
    sub: string;
    badge?: number;
  }> = [
    {
      href: "/employee/profile",
      icon: <IUser size={18} />,
      label: "Profile",
      sub: `${currentUser.designation} · ${currentUser.employeeCode}`,
    },
    {
      href: "/employee/profile?tab=privacy",
      icon: <IShield size={18} />,
      label: "Privacy & permissions",
      sub: "What is tracked, and when",
    },
    ...(petrolOn
      ? [
          {
            href: "/employee/travel",
            icon: <INav size={18} />,
            label: "Travel",
            sub: "Your work runs, routes and allowances",
          },
        ]
      : []),
    {
      href: "/employee/profile?tab=alerts",
      icon: <IBell size={18} />,
      label: "Notifications",
      sub: unread ? `${unread} unread` : "You're all caught up",
      badge: unread || undefined,
    },
    {
      href: "/employee/profile?tab=settings",
      icon: <ISettings size={18} />,
      label: "App settings",
      sub: "GPS source, appearance, offline mode",
    },
  ];

  return (
    <div>
      <ScreenHeader title="More" sub="Your account and this device" />
      <div className="flex flex-col gap-4 px-4">
        {/* who you are, at a glance */}
        <div className="wf-card flex items-center gap-3.5 p-4">
          <Avatar name={currentUser.name} hue={currentUser.avatarHue} size={48} />
          <div className="min-w-0 flex-1">
            <p className="wf-display truncate text-[1.05rem] font-bold">
              {currentUser.name}
            </p>
            {shift ? (
              <p className="flex items-center gap-1.5 text-[0.76rem] tabular-nums text-[var(--wf-muted)]">
                <IClock size={12} className="shrink-0" />
                {shift.name} ·{" "}
                {shift.kind === "flexible"
                  ? `${Math.round(shift.requiredMinutes / 60)}h`
                  : `${fmtShiftTime(shift.startMinute)} – ${fmtShiftTime(shift.endMinute)}`}
              </p>
            ) : null}
          </div>
        </div>

        <div className="wf-card wf-list overflow-hidden">
          {items.map((it) => (
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
              {it.badge ? <Chip tone="red">{it.badge}</Chip> : null}
              <IChevronR size={16} className="shrink-0 text-[var(--wf-faint)]" />
            </Link>
          ))}
        </div>

        <PersonaMenuEntry />
        <AccountPanel identity={false} />
      </div>
    </div>
  );
}
