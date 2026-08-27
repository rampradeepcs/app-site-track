"use client";

/**
 * Employee profile — identity card, performance snapshot, permission &
 * privacy management, notification feed and location/device settings.
 */

import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ScreenHeader } from "@/components/shell";
import { ScoreBars, ProgressRing } from "@/components/charts";
import {
  Avatar,
  Chip,
  Field,
  Segmented,
  Toggle,
  useNowTick,
} from "@/components/ui";
import {
  fmtDuration,
  fmtRelative,
  fmtShiftTime,
  pct,
} from "@/lib/format";
import { performanceFor, PERFORMANCE_WEIGHTS } from "@/lib/metrics";
import { SalaryAndShiftSection } from "@/components/SalarySection";
import { useWorkforce } from "@/lib/store";
import type { Permissions } from "@/lib/types";
import { ERASE_DEVICE, confirmDestructive } from "@/lib/confirm";
import {
  IAlert,
  IBell,
  ICamera,
  ICheckCircle,
  IInfo,
  ILogout,
  IMapPin,
  IRefresh,
  IShield,
} from "@/components/WfIcons";

type Tab = "profile" | "privacy" | "alerts" | "settings";

export default function EmployeeProfilePage() {
  return (
    <Suspense fallback={<div className="px-4 pt-6 text-sm text-[var(--wf-muted)]">Loading…</div>}>
      <ProfileInner />
    </Suspense>
  );
}

function ProfileInner() {
  const wf = useWorkforce();
  const { state, currentUser, logout, setPermission, updateSettings, markNotificationsRead, eraseLocalData } = wf;
  const router = useRouter();
  const params = useSearchParams();
  const tab = (params.get("tab") as Tab) ?? "profile";
  const now = useNowTick(30);

  const perf = useMemo(
    () => (currentUser ? performanceFor(state, currentUser) : null),
    [state, currentUser],
  );

  const notifications = useMemo(
    () =>
      state.notifications.filter(
        (n) =>
          n.audience === "employee" &&
          (!n.userId || n.userId === currentUser?.id),
      ),
    [state.notifications, currentUser],
  );

  if (!currentUser || !perf) return null;

  const setTab = (t: Tab) => {
    router.replace(`/employee/profile${t === "profile" ? "" : `?tab=${t}`}`);
    if (t === "alerts") markNotificationsRead("employee");
  };

  return (
    <div>
      <ScreenHeader title="Profile" back="/employee/more" />
      <div className="flex flex-col gap-4 px-4">
        <div className="px-0">
          <Segmented<Tab>
            ariaLabel="Profile sections"
            value={tab}
            onChange={setTab}
            size="sm"
            options={[
              { value: "profile", label: "Profile" },
              { value: "privacy", label: "Permissions" },
              { value: "alerts", label: "Alerts" },
              { value: "settings", label: "Settings" },
            ]}
          />
        </div>

        {tab === "profile" && (
          <>
            <div className="wf-card flex items-center gap-4 p-4">
              <Avatar name={currentUser.name} hue={currentUser.avatarHue} size={62} />
              <div className="min-w-0 flex-1">
                <h2 className="wf-display text-lg font-bold">{currentUser.name}</h2>
                <p className="text-[0.8rem] text-[var(--wf-muted)]">
                  {currentUser.designation} · {currentUser.department}
                </p>
                <p className="mt-0.5 text-[0.72rem] tabular-nums text-[var(--wf-faint)]">
                  {currentUser.employeeCode} · {currentUser.phone}
                </p>
              </div>
            </div>

            {/* the shift this person is measured against; salary stays
                hidden here — an employee sees time, not money (spec §24) */}
            <SalaryAndShiftSection user={currentUser} />

            <div className="wf-card flex items-center gap-5 p-4">
              <ProgressRing value={perf.overall} label={`Performance score ${Math.round(perf.overall)}`} />
              <div className="min-w-0 flex-1">
                <p className="wf-display font-bold">Performance score</p>
                <p className="mt-0.5 text-[0.76rem] leading-snug text-[var(--wf-muted)]">
                  Attendance {pct(perf.attendancePct)} · {perf.updateCount} updates ·
                  avg {fmtDuration(perf.avgWorkedMinutes)}/day over {perf.scheduledDays} days
                </p>
              </div>
            </div>

            <div className="wf-card p-4">
              <p className="mb-3 text-[0.72rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
                How your score is calculated
              </p>
              <ScoreBars
                rows={[
                  { label: "Attendance", value: perf.attendance, weight: `${PERFORMANCE_WEIGHTS.attendance * 100}%`, color: "var(--wf-green)" },
                  { label: "Punctuality", value: perf.punctuality, weight: `${PERFORMANCE_WEIGHTS.punctuality * 100}%`, color: "var(--wf-amber)" },
                  { label: "Working hours", value: perf.hours, weight: `${PERFORMANCE_WEIGHTS.hours * 100}%`, color: "var(--wf-blue)" },
                  { label: "Work updates", value: perf.updates, weight: `${PERFORMANCE_WEIGHTS.updates * 100}%`, color: "var(--wf-violet)" },
                  { label: "Supervisor rating", value: perf.supervisor, weight: `${PERFORMANCE_WEIGHTS.supervisor * 100}%`, color: "var(--wf-orange)" },
                ]}
              />
              <p className="mt-3 border-t border-[var(--wf-line)] pt-2.5 text-[0.7rem] leading-snug text-[var(--wf-faint)]">
                GPS distance is never used as a productivity score — movement is
                only a site-presence signal.
              </p>
            </div>

            <div className="wf-card p-4">
              <p className="mb-2 text-[0.72rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
                Assigned projects & shift
              </p>
              {currentUser.projectIds.map((pid) => {
                const p = state.projects.find((x) => x.id === pid);
                if (!p) return null;
                return (
                  <div key={pid} className="flex items-center justify-between py-1.5">
                    <span className="text-sm font-semibold">{p.name}</span>
                    <span className="text-[0.74rem] tabular-nums text-[var(--wf-muted)]">
                      {fmtShiftTime(p.rules.shiftStart)}–{fmtShiftTime(p.rules.shiftEnd)}
                    </span>
                  </div>
                );
              })}
            </div>

            <button
              className="wf-btn wf-btn-ghost"
              onClick={() => {
                logout();
                router.replace("/");
              }}
            >
              <ILogout size={17} /> Sign out
            </button>
          </>
        )}

        {tab === "privacy" && (
          <>
            <div className="wf-inset flex items-start gap-2.5 px-3.5 py-3 text-[0.78rem] leading-relaxed text-[var(--wf-muted)]">
              <IShield size={16} className="mt-0.5 shrink-0 text-[var(--wf-green)]" />
              <span>
                <strong className="text-[var(--wf-fg)]">Your location is only tracked while you&apos;re
                checked in.</strong>{" "}
                Tracking starts at check-in, stops at checkout, and records
                position, accuracy, speed and time. Your manager and project
                admins can view it for attendance and site-safety purposes.
                Records are retained for {state.settings.retentionDays} days.
              </span>
            </div>
            <PermissionRow
              icon={<IMapPin size={18} />}
              title="Location"
              body="Needed to verify you're on site and to record your route during shifts."
              value={state.permissions.location}
              onChange={(v) => setPermission("location", v)}
            />
            <PermissionRow
              icon={<IMapPin size={18} />}
              title="Background location"
              body="Keeps tracking alive when the app is minimised mid-shift. Never used off shift."
              value={state.permissions.backgroundLocation}
              onChange={(v) => setPermission("backgroundLocation", v)}
            />
            <PermissionRow
              icon={<ICamera size={18} />}
              title="Camera"
              body="Used only for check-in / checkout selfies and work-update photos."
              value={state.permissions.camera}
              onChange={(v) => setPermission("camera", v)}
            />
            <PermissionRow
              icon={<IBell size={18} />}
              title="Notifications"
              body="Checkout reminders, sync status and tracking alerts."
              value={state.permissions.notifications}
              onChange={(v) => setPermission("notifications", v)}
            />
          </>
        )}

        {tab === "alerts" && (
          <div className="flex flex-col gap-2">
            {notifications.length === 0 && (
              <p className="py-8 text-center text-sm text-[var(--wf-muted)]">
                No notifications yet.
              </p>
            )}
            {notifications.slice(0, 30).map((n) => (
              <div key={n.id} className={`wf-card2 flex items-start gap-3 px-3.5 py-3 ${n.read ? "opacity-70" : ""}`}>
                <span
                  className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg"
                  style={{
                    background:
                      n.severity === "critical" || n.severity === "warning"
                        ? "var(--wf-amber-soft)"
                        : "var(--wf-blue-soft)",
                    color:
                      n.severity === "critical"
                        ? "var(--wf-red)"
                        : n.severity === "warning"
                          ? "var(--wf-amber)"
                          : n.severity === "success"
                            ? "var(--wf-green)"
                            : "var(--wf-blue)",
                  }}
                >
                  {n.severity === "success" ? <ICheckCircle size={16} /> : n.severity === "info" ? <IInfo size={16} /> : <IAlert size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[0.86rem] font-semibold leading-snug">{n.title}</p>
                  <p className="text-[0.76rem] leading-snug text-[var(--wf-muted)]">{n.body}</p>
                  <p className="mt-0.5 text-[0.66rem] text-[var(--wf-faint)]">{fmtRelative(n.at, now)}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "settings" && (
          <>
            <div className="wf-card flex flex-col gap-4 p-4">
              <Field label="Location source" hint="Device GPS uses your real position. Simulated walks you around your site instead, for trying the app away from it.">
                <Segmented
                  ariaLabel="Location source"
                  value={state.settings.locationSource}
                  onChange={(v) => updateSettings({ locationSource: v })}
                  options={[
                    { value: "simulated", label: "Simulated" },
                    { value: "device", label: "Device GPS" },
                  ]}
                />
              </Field>
              <Field
                label={`GPS sampling — every ${state.settings.samplingSeconds}s`}
                hint="Longer intervals save battery and data; shorter draws a finer route."
              >
                <input
                  type="range"
                  min={5}
                  max={60}
                  step={5}
                  value={state.settings.samplingSeconds}
                  onChange={(e) => updateSettings({ samplingSeconds: Number(e.target.value) })}
                  className="w-full accent-[var(--wf-amber)]"
                />
              </Field>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Simulate offline</p>
                  <p className="text-[0.72rem] text-[var(--wf-muted)]">
                    Queue captures locally and sync on reconnect
                  </p>
                </div>
                <Toggle
                  checked={state.settings.forceOffline}
                  onChange={(v) => updateSettings({ forceOffline: v })}
                  label="Simulate offline mode"
                />
              </div>
            </div>
            <button className="wf-btn wf-btn-ghost" onClick={() => confirmDestructive(ERASE_DEVICE, eraseLocalData)}>
              <IRefresh size={16} /> Erase this device
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function PermissionRow({
  icon,
  title,
  body,
  value,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  value: Permissions[keyof Permissions];
  onChange: (v: "granted" | "denied") => void;
}) {
  const granted = value === "granted";
  return (
    <div className="wf-card flex items-start gap-3 p-4">
      <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--wf-surface2)] text-[var(--wf-amber)]">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <p className="font-semibold">{title}</p>
          <Chip tone={granted ? "green" : value === "denied" ? "red" : "neutral"}>
            {granted ? "Granted" : value === "denied" ? "Denied" : "Not asked"}
          </Chip>
        </div>
        <p className="mt-0.5 text-[0.76rem] leading-snug text-[var(--wf-muted)]">{body}</p>
        <div className="mt-2">
          <Toggle
            checked={granted}
            onChange={(v) => onChange(v ? "granted" : "denied")}
            label={`${title} permission`}
          />
        </div>
      </div>
    </div>
  );
}
