"use client";

/**
 * Feature management — the entitlement matrix. Plan columns show what each
 * plan grants; client rows show what each tenant effectively has, including
 * overrides, and let the Super Admin flip any one of them.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHead } from "@/components/platform/PlatformShell";
import { SectionTitle, Segmented, Toggle } from "@/components/ui";
import { entitlementsFor } from "@/lib/entitlements";
import { usePlatform } from "@/lib/platform-store";
import type { FeatureSet } from "@/lib/saas-types";
import { FEATURE_LABELS } from "@/lib/saas-types";
import { IArrowR, IShield } from "@/components/WfIcons";

const KEYS = Object.keys(FEATURE_LABELS) as Array<keyof FeatureSet>;

export default function FeaturesPage() {
  const { platform, overrideFeature, updatePlatformSettings } = usePlatform();
  const [view, setView] = useState<"plans" | "clients" | "flags">("plans");
  const live = useMemo(
    () => platform.organizations.filter((o) => o.status !== "cancelled"),
    [platform.organizations],
  );

  return (
    <div className="pb-10">
      <PageHead
        title="Feature Management"
        sub="What each plan grants, and what each client actually has"
      />
      <div className="flex flex-col gap-4 px-5">
        <Segmented
          ariaLabel="Matrix view"
          value={view}
          onChange={setView}
          size="sm"
          options={[
            { value: "plans", label: "By plan" },
            { value: "clients", label: "By client" },
            { value: "flags", label: "Global flags" },
          ]}
        />

        {view === "plans" && (
          <div className="wf-card overflow-hidden">
            <div className="wf-scroll-x">
              <table className="wf-table">
                <thead>
                  <tr>
                    <th>Feature</th>
                    {platform.plans.map((p) => (
                      <th key={p.id} className="text-center">{p.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {KEYS.map((k) => (
                    <tr key={k}>
                      <td className="font-semibold">{FEATURE_LABELS[k]}</td>
                      {platform.plans.map((p) => (
                        <td key={p.id} className="text-center">
                          {p.features[k] ? (
                            <span className="text-[var(--wf-green)]">✓</span>
                          ) : (
                            <span className="text-[var(--wf-faint)]">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {view === "clients" && (
          <>
            <p className="text-[0.78rem] text-[var(--wf-muted)]">
              Toggling here writes a per-client override — the client&apos;s base
              plan is untouched, and the change is audit-logged.
            </p>
            <div className="wf-card overflow-hidden">
              <div className="wf-scroll-x">
                <table className="wf-table">
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th>Plan</th>
                      {KEYS.map((k) => (
                        <th key={k} className="whitespace-nowrap text-center text-[0.6rem]">
                          {FEATURE_LABELS[k]}
                        </th>
                      ))}
                      <th aria-label="Open" />
                    </tr>
                  </thead>
                  <tbody>
                    {live.map((o) => {
                      const ent = entitlementsFor(platform, o.id);
                      return (
                        <tr key={o.id}>
                          <td className="whitespace-nowrap font-semibold">{o.name}</td>
                          <td className="whitespace-nowrap text-[var(--wf-muted)]">{ent.planName}</td>
                          {KEYS.map((k) => {
                            const overridden = ent.overriddenFeatures.includes(k);
                            return (
                              <td key={k} className="text-center">
                                <span
                                  className="inline-flex flex-col items-center gap-0.5"
                                  title={overridden ? "Overridden for this client" : undefined}
                                >
                                  <Toggle
                                    checked={ent.features[k]}
                                    onChange={(v) => overrideFeature(o.id, k, v)}
                                    label={`${FEATURE_LABELS[k]} for ${o.name}`}
                                  />
                                  {overridden && (
                                    <span className="text-[0.5rem] font-bold text-[var(--wf-violet)]">OVR</span>
                                  )}
                                </span>
                              </td>
                            );
                          })}
                          <td>
                            <Link
                              href={`/platform/client?id=${o.id}&tab=subscription`}
                              aria-label={`Open subscription for ${o.name}`}
                              title={`Subscription — ${o.name}`}
                              className="wf-btn wf-btn-quiet wf-btn-sm"
                            >
                              <IArrowR size={13} />
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {view === "flags" && (
          <div className="wf-card p-4">
            <SectionTitle>Global feature flags</SectionTitle>
            <p className="wf-inset mb-3 flex items-start gap-2.5 px-3.5 py-3 text-[0.78rem] leading-relaxed text-[var(--wf-muted)]">
              <IShield size={16} className="mt-0.5 shrink-0 text-[var(--wf-violet)]" />
              A global flag only supplies a default where a client has expressed
              no preference. It can switch a capability <em>on</em> for accounts
              whose plan omits it — it never revokes something a plan grants, and
              never overrides an explicit per-client setting.
            </p>
            <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
              {KEYS.map((k) => (
                <div key={k} className="flex items-center justify-between gap-3 border-b border-[var(--wf-line)] py-2.5">
                  <span className="text-[0.84rem] font-semibold">{FEATURE_LABELS[k]}</span>
                  <Toggle
                    checked={platform.platformSettings.globalFeatureFlags[k] === true}
                    onChange={(v) =>
                      updatePlatformSettings({
                        globalFeatureFlags: {
                          ...platform.platformSettings.globalFeatureFlags,
                          [k]: v ? true : undefined,
                        },
                      })
                    }
                    label={`Global ${FEATURE_LABELS[k]}`}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
