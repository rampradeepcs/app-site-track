"use client";

/**
 * Manager settings — its own screen.
 *
 * Tracking, retention and the destructive device reset. None of it
 * belonged behind a tab beside a feed of work updates.
 */

import { ScreenHeader } from "@/components/shell";
import { PersonaMenuEntry } from "@/components/demo/PersonaMenuEntry";
import { AccountPanel } from "@/components/shell";
import { ThemeControl } from "@/components/ThemeControl";
import { Field, SectionTitle } from "@/components/ui";
import { fmtDateLong } from "@/lib/format";
import { useWorkforce } from "@/lib/store";
import { ERASE_DEVICE, confirmDestructive } from "@/lib/confirm";
import { IRefresh, IShield } from "@/components/WfIcons";

export default function ManagerSettings() {
  const { state, updateSettings, eraseLocalData } = useWorkforce();
  return (
    <div>
      <ScreenHeader back title="Settings" sub="Tracking, appearance and this device" />
      <div className="flex flex-col gap-3 px-4">
            <div className="wf-card flex flex-col gap-4 p-4">
              <SectionTitle>Tracking policy</SectionTitle>
              <Field
                label={`GPS sampling — every ${state.settings.samplingSeconds}s`}
                hint="Balances route detail against battery and data use on workers' phones."
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
              <Field
                label={`Accuracy floor — reject fixes worse than ±${state.settings.accuracyFloor}m`}
              >
                <input
                  type="range"
                  min={15}
                  max={100}
                  step={5}
                  value={state.settings.accuracyFloor}
                  onChange={(e) => updateSettings({ accuracyFloor: Number(e.target.value) })}
                  className="w-full accent-[var(--wf-amber)]"
                />
              </Field>
              <Field
                label={`Data retention — ${state.settings.retentionDays} days`}
                hint="Location history older than this is purged."
              >
                <input
                  type="range"
                  min={30}
                  max={365}
                  step={30}
                  value={state.settings.retentionDays}
                  onChange={(e) => updateSettings({ retentionDays: Number(e.target.value) })}
                  className="w-full accent-[var(--wf-amber)]"
                />
              </Field>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">Appearance</p>
                  <p className="mb-2 text-[0.72rem] text-[var(--wf-muted)]">
                    Applies to the whole app, maps included
                  </p>
                  <ThemeControl />
                </div>
              </div>
            </div>

            <div className="wf-inset flex items-start gap-2.5 px-3.5 py-3 text-[0.76rem] leading-relaxed text-[var(--wf-muted)]">
              <IShield size={15} className="mt-0.5 shrink-0 text-[var(--wf-green)]" />
              Role-based access: employees see only their own records; managers
              see assigned projects. Location is captured strictly between
              check-in and checkout, transmitted encrypted, and every geofence
              or assignment change is audit-logged below.
            </div>

            <div className="wf-card p-4">
              <SectionTitle>Audit log</SectionTitle>
              <div className="flex flex-col gap-2">
                {state.audit.slice(0, 8).map((a) => {
                  const actor = state.users.find((u) => u.id === a.actorId);
                  return (
                    <div key={a.id} className="flex items-baseline gap-2 text-[0.76rem]">
                      <span className="shrink-0 tabular-nums text-[var(--wf-faint)]">
                        {fmtDateLong(a.at)}
                      </span>
                      <span className="font-semibold">{a.action}</span>
                      <span className="truncate text-[var(--wf-muted)]">
                        {actor?.name ?? a.actorId} — {a.detail ?? a.target}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <PersonaMenuEntry />
            <AccountPanel />

            <button
              className="wf-btn wf-btn-ghost"
              onClick={() => confirmDestructive(ERASE_DEVICE, eraseLocalData)}
            >
              <IRefresh size={15} /> Erase this device
            </button>
      </div>
    </div>
  );
}
