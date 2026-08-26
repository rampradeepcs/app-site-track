"use client";

/** Platform settings — defaults, templates and the maintenance switch. */

import { PageHead } from "@/components/platform/PlatformShell";
import { Field, SectionTitle, Toggle } from "@/components/ui";
import { usePlatform } from "@/lib/platform-store";
import { useWorkforce } from "@/lib/store";
import { IAlert, IRefresh, IShield } from "@/components/WfIcons";
import { ERASE_DEVICE, confirmDestructive } from "@/lib/confirm";

export default function PlatformSettingsPage() {
  const { platform, updatePlatformSettings, resetPlatform } = usePlatform();
  const { eraseLocalData } = useWorkforce();
  const s = platform.platformSettings;

  return (
    <div className="pb-10">
      <PageHead title="Platform Settings" sub="Defaults applied to new clients, and platform-wide controls" />
      <div className="grid gap-4 px-5 lg:grid-cols-2">
        <div className="wf-card p-4">
          <SectionTitle>Subscription defaults</SectionTitle>
          <div className="flex flex-col gap-3.5">
            <Field label="Default plan for new clients">
              <select
                className="wf-input"
                value={s.defaultPlanId}
                onChange={(e) => updatePlatformSettings({ defaultPlanId: e.target.value })}
              >
                {platform.plans.filter((p) => !p.archived).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </Field>
            <Field label={`Default trial — ${s.defaultTrialDays} days`}>
              <input type="range" min={0} max={45} value={s.defaultTrialDays} onChange={(e) => updatePlatformSettings({ defaultTrialDays: Number(e.target.value) })} className="w-full accent-[var(--wf-violet)]" />
            </Field>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Self-serve signups</p>
                <p className="text-[0.72rem] text-[var(--wf-muted)]">Allow new tenants without manual onboarding</p>
              </div>
              <Toggle checked={s.signupsEnabled} onChange={(v) => updatePlatformSettings({ signupsEnabled: v })} label="Self-serve signups" />
            </div>
          </div>
        </div>

        <div className="wf-card p-4">
          <SectionTitle>Default client rules</SectionTitle>
          <p className="mb-3 text-[0.74rem] text-[var(--wf-muted)]">
            Applied when a client is created. Changing them never rewrites a
            client&apos;s own configuration.
          </p>
          <div className="flex flex-col gap-3.5">
            <Field label={`GPS sampling — every ${s.defaultSamplingSeconds}s`}>
              <input type="range" min={5} max={60} step={5} value={s.defaultSamplingSeconds} onChange={(e) => updatePlatformSettings({ defaultSamplingSeconds: Number(e.target.value) })} className="w-full accent-[var(--wf-violet)]" />
            </Field>
            <Field label={`Location retention — ${s.defaultRetentionDays} days`}>
              <input type="range" min={30} max={730} step={30} value={s.defaultRetentionDays} onChange={(e) => updatePlatformSettings({ defaultRetentionDays: Number(e.target.value) })} className="w-full accent-[var(--wf-violet)]" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={`Late grace — ${s.defaultLateGraceMinutes} min`}>
                <input type="range" min={0} max={45} step={5} value={s.defaultLateGraceMinutes} onChange={(e) => updatePlatformSettings({ defaultLateGraceMinutes: Number(e.target.value) })} className="w-full accent-[var(--wf-violet)]" />
              </Field>
              <Field label={`Geofence exit alert — ${s.defaultExitAlertMinutes} min`}>
                <input type="range" min={0} max={60} step={5} value={s.defaultExitAlertMinutes} onChange={(e) => updatePlatformSettings({ defaultExitAlertMinutes: Number(e.target.value) })} className="w-full accent-[var(--wf-violet)]" />
              </Field>
            </div>
          </div>
        </div>

        <div className="wf-card p-4">
          <SectionTitle>Contact & legal</SectionTitle>
          <div className="flex flex-col gap-3.5">
            <Field label="Support email">
              <input className="wf-input" value={s.supportEmail} onChange={(e) => updatePlatformSettings({ supportEmail: e.target.value })} />
            </Field>
            <Field label="Terms URL">
              <input className="wf-input" value={s.termsUrl} onChange={(e) => updatePlatformSettings({ termsUrl: e.target.value })} />
            </Field>
            <Field label="Privacy policy URL">
              <input className="wf-input" value={s.privacyUrl} onChange={(e) => updatePlatformSettings({ privacyUrl: e.target.value })} />
            </Field>
          </div>
        </div>

        <div className="wf-card p-4">
          <SectionTitle>Maintenance</SectionTitle>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Maintenance mode</p>
              <p className="text-[0.72rem] text-[var(--wf-muted)]">
                Shows a notice in every client app. Attendance already captured
                on devices still syncs.
              </p>
            </div>
            <Toggle checked={s.maintenanceMode} onChange={(v) => updatePlatformSettings({ maintenanceMode: v })} label="Maintenance mode" />
          </div>
          <Field label="Maintenance message">
            <textarea className="wf-input mt-3" rows={3} value={s.maintenanceMessage} onChange={(e) => updatePlatformSettings({ maintenanceMessage: e.target.value })} />
          </Field>
          {s.maintenanceMode && (
            <p className="mt-3 flex items-center gap-2 text-[0.8rem] font-semibold text-[var(--wf-amber)]">
              <IAlert size={15} /> Maintenance mode is live for every tenant.
            </p>
          )}
        </div>

        <div className="wf-card p-4 lg:col-span-2">
          <SectionTitle>Access model</SectionTitle>
          <p className="wf-inset flex items-start gap-2.5 px-3.5 py-3 text-[0.8rem] leading-relaxed text-[var(--wf-muted)]">
            <IShield size={16} className="mt-0.5 shrink-0 text-[var(--wf-violet)]" />
            <span>
              <strong className="text-[var(--wf-fg)]">Super Admin</strong> — the platform:
              tenants, plans, billing, entitlements. Never a client&apos;s day-to-day manager.{" "}
              <strong className="text-[var(--wf-fg)]">Client Admin</strong> — everything inside
              their own organisation.{" "}
              <strong className="text-[var(--wf-fg)]">Manager</strong> — the projects they run.{" "}
              <strong className="text-[var(--wf-fg)]">Employee</strong> — their own shift and
              records. Each tenant&apos;s workforce, routes, attendance and billing are isolated;
              a manager in one client can never read another client&apos;s data.
            </span>
          </p>
          <div className="mt-3 flex flex-wrap gap-2.5">
            <button className="wf-btn wf-btn-ghost" onClick={resetPlatform}>
              <IRefresh size={15} /> Reset platform data
            </button>
            <button className="wf-btn wf-btn-ghost" onClick={() => confirmDestructive(ERASE_DEVICE, eraseLocalData)}>
              <IRefresh size={15} /> Erase workforce data on this device
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
