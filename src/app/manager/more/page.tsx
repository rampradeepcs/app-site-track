"use client";

/**
 * More — the way to everything that does not earn a permanent tab.
 *
 * This was once a multi-tab screen carrying reports, performance, the update
 * feed, alerts and settings. Each of those became its own route and the tabs
 * went, but the machinery stayed behind: a Tab type, a ?tab= reader, a setTab
 * that marked notifications read, and the memos that fed two report builders
 * nothing called. Removed here, along with the three links elsewhere that were
 * still pointing at tabs that no longer render — one of which was the manager's
 * notification bell.
 *
 * What is left is a list of links, and the plan and role decide which appear.
 */

import Link from "next/link";

import { useFeature } from "@/components/FeatureGate";
import { ScreenHeader } from "@/components/shell";

import { MyCompaniesPanel } from "@/components/MyCompaniesPanel";

import { useWorkforce } from "@/lib/store";
import { isForMe } from "@/lib/notify";

import { IBell, ICamera, IChart, IChevronR, IClipboard, IClock, IFile, IMapPin, INav, ISettings, IUsers, IWallet } from "@/components/WfIcons";

export default function MorePage() {
  const { state } = useWorkforce();

  const alerts = state.notifications.filter((n) =>
    isForMe(n, state.session?.role, state.session?.userId),
  );
  const unread = alerts.filter((n) => !n.read).length;
  const shiftsOn = useFeature("shifts");
  const payrollOn = useFeature("payroll");
  const petrolOn = useFeature("petrolAllowance");

  return (
    <div>
      <ScreenHeader title="More" sub="Modules · work updates · alerts · settings" />
      <div className="flex flex-col gap-4 px-4">
        {/* modules that don't earn a permanent tab, per plan and role */}
        <div className="wf-card wf-list overflow-hidden">
          {shiftsOn && (
            <Link href="/manager/shifts" className="wf-row">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--wf-fill-2)]">
                <IClock size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[0.92rem] font-semibold">Shifts & breaks</span>
                <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
                  Definitions, break rules, overtime, assignment
                </span>
              </span>
              <IChevronR size={16} className="shrink-0 text-[var(--wf-faint)]" />
            </Link>
          )}
          {payrollOn && (
            <Link href="/manager/payroll" className="wf-row">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--wf-fill-2)]">
                <IWallet size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[0.92rem] font-semibold">Payroll</span>
                <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
                  Monthly runs, OT approvals, exports
                </span>
              </span>
              <IChevronR size={16} className="shrink-0 text-[var(--wf-faint)]" />
            </Link>
          )}
          {petrolOn && (
            <Link href="/manager/travel" className="wf-row">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--wf-fill-2)]">
                <INav size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[0.92rem] font-semibold">Travel & allowance</span>
                <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
                  Work travel, petrol and food rules, approvals
                </span>
              </span>
              <IChevronR size={16} className="shrink-0 text-[var(--wf-faint)]" />
            </Link>
          )}
          <Link href="/manager/teams" className="wf-row">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--wf-fill-2)]">
              <IUsers size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.92rem] font-semibold">Labour teams</span>
              <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
                Gangs by trade, and who is on them
              </span>
            </span>
            <IChevronR size={16} className="shrink-0 text-[var(--wf-faint)]" />
          </Link>
          <Link href="/manager/group-attendance" className="wf-row">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--wf-fill-2)]">
              <ICamera size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.92rem] font-semibold">Group attendance</span>
              <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
                Mark a whole gang from one photo
              </span>
            </span>
            <IChevronR size={16} className="shrink-0 text-[var(--wf-faint)]" />
          </Link>
          <Link href="/manager/notes" className="wf-row">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--wf-fill-2)]">
              <IClipboard size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.92rem] font-semibold">Project notes</span>
              <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
                Instructions, hints and reminders
              </span>
            </span>
            <IChevronR size={16} className="shrink-0 text-[var(--wf-faint)]" />
          </Link>
          <Link href="/manager/live" className="wf-row">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--wf-fill-2)]">
              <IMapPin size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.92rem] font-semibold">Live map</span>
              <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
                Everyone on shift, right now
              </span>
            </span>
            <IChevronR size={16} className="shrink-0 text-[var(--wf-faint)]" />
          </Link>
          <Link href="/manager/reports" className="wf-row">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--wf-fill-2)]">
              <IFile size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.92rem] font-semibold">Reports</span>
              <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
                Attendance, workforce and payroll exports
              </span>
            </span>
            <IChevronR size={16} className="shrink-0 text-[var(--wf-faint)]" />
          </Link>
          <Link href="/manager/performance" className="wf-row">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--wf-fill-2)]">
              <IChart size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.92rem] font-semibold">Performance</span>
              <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
                Last 14 days, ranked, and who needs attention
              </span>
            </span>
            <IChevronR size={16} className="shrink-0 text-[var(--wf-faint)]" />
          </Link>
          <Link href="/manager/updates" className="wf-row">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--wf-fill-2)]">
              <IClipboard size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.92rem] font-semibold">Work updates</span>
              <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
                What the site reported today
              </span>
            </span>
            <IChevronR size={16} className="shrink-0 text-[var(--wf-faint)]" />
          </Link>
          <Link href="/manager/alerts" className="wf-row">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--wf-fill-2)]">
              <IBell size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.92rem] font-semibold">
                Alerts{unread ? ` (${unread})` : ""}
              </span>
              <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
                Geofence exits, missing checkouts, sync
              </span>
            </span>
            <IChevronR size={16} className="shrink-0 text-[var(--wf-faint)]" />
          </Link>
          <Link href="/manager/settings" className="wf-row">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--wf-fill-2)]">
              <ISettings size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.92rem] font-semibold">Settings</span>
              <span className="block truncate text-[0.72rem] text-[var(--wf-muted)]">
                Tracking, appearance and this device
              </span>
            </span>
            <IChevronR size={16} className="shrink-0 text-[var(--wf-faint)]" />
          </Link>
        </div>

        <MyCompaniesPanel />
      </div>
    </div>
  );
}

