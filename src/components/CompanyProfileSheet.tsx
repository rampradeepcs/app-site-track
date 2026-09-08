"use client";

/**
 * What the company calls itself.
 *
 * A name typed at signup was permanent: organizations could only be written
 * by the platform owner, so a typo on day one was the company's name for
 * good, on every screen and on the sign-in page their workers see. An
 * administrator can now correct it, along with how to reach the company.
 *
 * Not here: status, subdomain, plan and billing state. Those are the
 * commercial relationship rather than the company's description of itself,
 * and they stay with the platform.
 */

import { useState } from "react";
import { BottomSheet, Field } from "./ui";
import { refreshMyCompanies } from "@/lib/companies";
import { usePlatform } from "@/lib/platform-store";
import { updateMyCompanyRemote } from "@/lib/supabase/repository";
import { isLiveBackend } from "@/lib/supabase/client";
import { demoActive } from "@/lib/demo/mode";
import { describeError } from "@/lib/errors";
import { showToast } from "@/lib/toast";
import type { Organization } from "@/lib/saas-types";
import { ICheck } from "./WfIcons";

export function CompanyProfileSheet({
  org,
  open,
  onClose,
}: {
  org: Organization;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title="Company profile" tall>
      {open ? <CompanyProfileForm key={org.id} org={org} onDone={onClose} /> : null}
    </BottomSheet>
  );
}

function CompanyProfileForm({ org, onDone }: { org: Organization; onDone: () => void }) {
  const { updateOrg } = usePlatform();
  const [name, setName] = useState(org.name);
  const [industry, setIndustry] = useState(org.industry ?? "");
  const [website, setWebsite] = useState(org.website ?? "");
  const [contactName, setContactName] = useState(org.contactName ?? "");
  const [contactEmail, setContactEmail] = useState(org.contactEmail ?? "");
  const [contactPhone, setContactPhone] = useState(org.contactPhone ?? "");
  const [appName, setAppName] = useState(org.branding?.appName ?? "Workfence");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (name.trim().length < 2) {
      setError("The company needs a name.");
      return;
    }
    const patch = {
      name: name.trim(),
      industry: industry.trim(),
      website: website.trim(),
      contactName: contactName.trim(),
      contactEmail: contactEmail.trim(),
      contactPhone: contactPhone.trim(),
      branding: { ...org.branding, appName: appName.trim() || "Workfence" },
    };
    setBusy(true);
    try {
      if (isLiveBackend && !demoActive()) {
        await updateMyCompanyRemote(patch);
        // The name is shown by the switcher, the header and every company
        // list, all of which read a cached answer. Refresh it here so the
        // new name is everywhere by the time this sheet closes.
        await refreshMyCompanies();
      }
      // And in the local copy the dashboard reads.
      updateOrg(org.id, patch);
      showToast(`${patch.name} updated`, "success");
      onDone();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3.5 pb-2">
      <Field label="Company name" required hint="Shown across the app and to your workers.">
        <input
          className="wf-input"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError("");
          }}
        />
      </Field>
      {error ? (
        <p className="-mt-2 text-[0.78rem] font-semibold text-[var(--wf-red)]">{error}</p>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Industry">
          <input className="wf-input" value={industry} onChange={(e) => setIndustry(e.target.value)} />
        </Field>
        <Field label="Website">
          <input className="wf-input" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </Field>
      </div>

      <Field label="App name" hint="What the sign-in screen calls itself for your crew.">
        <input className="wf-input" value={appName} onChange={(e) => setAppName(e.target.value)} />
      </Field>

      <Field label="Primary contact">
        <input
          className="wf-input"
          value={contactName}
          onChange={(e) => setContactName(e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Contact email">
          <input
            className="wf-input"
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
          />
        </Field>
        <Field label="Contact phone">
          <input
            className="wf-input"
            type="tel"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
          />
        </Field>
      </div>

      <p className="text-[0.74rem] leading-relaxed text-[var(--wf-faint)]">
        Company ID {org.code}
        {org.slug ? ` · workers reach you at /t/${org.slug}` : ""}. Your plan,
        billing and subscription are managed by Workfence.
      </p>

      <div className="mt-1 grid grid-cols-2 gap-2.5">
        <button type="button" className="wf-btn wf-btn-ghost" onClick={onDone}>
          Cancel
        </button>
        <button
          type="button"
          className="wf-btn wf-btn-primary"
          disabled={busy}
          onClick={() => void save()}
        >
          <ICheck size={16} /> {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
