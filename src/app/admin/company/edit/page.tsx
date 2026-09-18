"use client";

/**
 * Changing what the company is.
 *
 * A page rather than a sheet: there are four groups of fields here, and a
 * tall sheet on a phone puts the save button somewhere you have to hunt for
 * with a keyboard covering half the screen.
 *
 * What is not on it matters as much. Status, subdomain and plan are the
 * commercial relationship between this company and Workfence, and belong to
 * the platform — a company that could suspend or upgrade itself by typing in
 * its own profile would not have a subscription, it would have a suggestion.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ScreenHeader } from "@/components/shell";
import { DISCARD_EDITS } from "@/lib/confirm";
import { Field, SectionTitle } from "@/components/ui";
import { usePlatform } from "@/lib/platform-store";
import { useWorkforce } from "@/lib/store";
import { refreshMyCompanies } from "@/lib/companies";
import { updateMyCompanyRemote } from "@/lib/supabase/repository";
import { isLiveBackend } from "@/lib/supabase/client";
import { demoActive } from "@/lib/demo/mode";
import { describeError } from "@/lib/errors";
import { showToast } from "@/lib/toast";
import { ICheck } from "@/components/WfIcons";
import { useViewingOrgId } from "@/components/FeatureGate";

export default function EditCompanyPage() {
  const { platform, updateOrg } = usePlatform();
  const { currentUser } = useWorkforce();
  const router = useRouter();
  const viewingOrgId = useViewingOrgId();
  const org = platform.organizations.find((o) => o.id === viewingOrgId);

  const [name, setName] = useState(org?.name ?? "");
  const [legalName, setLegalName] = useState(org?.billing.legalName ?? "");
  const [industry, setIndustry] = useState(org?.industry ?? "");
  const [website, setWebsite] = useState(org?.website ?? "");
  const [appName, setAppName] = useState(org?.branding.appName ?? "Workfence");
  const [contactName, setContactName] = useState(org?.contactName ?? "");
  const [contactEmail, setContactEmail] = useState(org?.contactEmail ?? "");
  const [contactPhone, setContactPhone] = useState(org?.contactPhone ?? "");
  const [addressLine, setAddressLine] = useState(org?.billing.addressLine ?? "");
  const [city, setCity] = useState(org?.billing.city ?? "");
  const [stateName, setStateName] = useState(org?.billing.state ?? "");
  const [postcode, setPostcode] = useState(org?.billing.postcode ?? "");
  const [country, setCountry] = useState(org?.country ?? "");
  const [timezone, setTimezone] = useState(org?.timezone ?? "");
  const [taxIdLabel, setTaxIdLabel] = useState(org?.billing.taxIdLabel ?? "GSTIN");
  const [taxId, setTaxId] = useState(org?.billing.taxId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /*
   * Sixteen fields loaded from the company and edited in place, so "dirty"
   * is changed-from-what-was-loaded rather than non-empty. Snapshotted into
   * a state that is never set: stable for the life of the screen, and unlike
   * a ref it may be read while rendering.
   */
  const [loaded] = useState(() => [
    org?.name ?? "",
    org?.billing.legalName ?? "",
    org?.industry ?? "",
    org?.website ?? "",
    org?.branding.appName ?? "Workfence",
    org?.contactName ?? "",
    org?.contactEmail ?? "",
    org?.contactPhone ?? "",
    org?.billing.addressLine ?? "",
    org?.billing.city ?? "",
    org?.billing.state ?? "",
    org?.billing.postcode ?? "",
    org?.country ?? "",
    org?.timezone ?? "",
    org?.billing.taxIdLabel ?? "GSTIN",
    org?.billing.taxId ?? "",
  ]);
  const dirty = [
    name, legalName, industry, website, appName, contactName, contactEmail,
    contactPhone, addressLine, city, stateName, postcode, country, timezone,
    taxIdLabel, taxId,
  ].some((v, i) => v !== loaded[i]);

  if (!org || currentUser?.role !== "admin") {
    return (
      <div>
        <ScreenHeader back="/admin/company" title="Edit company" />
        <p className="px-4 pt-6 text-center text-sm text-[var(--wf-muted)]">
          Only a company administrator can change these details.
        </p>
      </div>
    );
  }

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
      country: country.trim(),
      timezone: timezone.trim(),
      branding: { ...org.branding, appName: appName.trim() || "Workfence" },
      billing: {
        ...org.billing,
        legalName: legalName.trim() || name.trim(),
        addressLine: addressLine.trim(),
        city: city.trim(),
        state: stateName.trim(),
        postcode: postcode.trim(),
        country: country.trim(),
        taxIdLabel: taxIdLabel.trim() || "Tax ID",
        taxId: taxId.trim(),
      },
    };
    setBusy(true);
    try {
      if (isLiveBackend && !demoActive()) {
        await updateMyCompanyRemote(patch);
        // The name is on the header, the switcher and every company list,
        // all reading a cached answer. Refresh it before leaving, so the
        // page they land on already says the new one.
        await refreshMyCompanies();
      }
      updateOrg(org.id, patch);
      showToast(`${patch.name} updated`, "success");
      router.replace("/admin/company");
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <ScreenHeader
        back="/admin/company"
        confirmBack={dirty ? DISCARD_EDITS : undefined}
        title="Edit company"
        sub={org.code}
        /* Just Save. The bar's own back control already returns to the
           company page, which is all Cancel did; two controls for one act,
           side by side, is one too many. */
        action={
          <button
            type="button"
            className="wf-btn wf-btn-primary"
            disabled={busy}
            onClick={() => void save()}
          >
            <ICheck size={16} /> {busy ? "Saving…" : "Save changes"}
          </button>
        }
      />
      <div className="flex flex-col gap-4 px-4 pb-8">
        <div className="wf-card flex flex-col gap-3.5 p-4">
          <SectionTitle>Identity</SectionTitle>
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
          <Field label="Legal name" hint="If it differs from the trading name.">
            <input
              className="wf-input"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Industry">
              <input
                className="wf-input"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
              />
            </Field>
            <Field label="Website">
              <input
                className="wf-input"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </Field>
          </div>
          <Field label="App name" hint="What the sign-in screen calls itself for your crew.">
            <input
              className="wf-input"
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
            />
          </Field>
        </div>

        <div className="wf-card flex flex-col gap-3.5 p-4">
          <SectionTitle>Primary contact</SectionTitle>
          <Field label="Name">
            <input
              className="wf-input"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email">
              <input
                className="wf-input"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
              />
            </Field>
            <Field label="Phone">
              <input
                className="wf-input"
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
              />
            </Field>
          </div>
        </div>

        <div className="wf-card flex flex-col gap-3.5 p-4">
          <SectionTitle>Registered address &amp; tax</SectionTitle>
          <Field label="Address">
            <input
              className="wf-input"
              value={addressLine}
              onChange={(e) => setAddressLine(e.target.value)}
              placeholder="Street, area"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="City">
              <input className="wf-input" value={city} onChange={(e) => setCity(e.target.value)} />
            </Field>
            <Field label="State">
              <input
                className="wf-input"
                value={stateName}
                onChange={(e) => setStateName(e.target.value)}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Postcode">
              <input
                className="wf-input"
                value={postcode}
                onChange={(e) => setPostcode(e.target.value)}
              />
            </Field>
            <Field label="Country">
              <input
                className="wf-input"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tax ID label" hint="GSTIN, VAT, EIN…">
              <input
                className="wf-input"
                value={taxIdLabel}
                onChange={(e) => setTaxIdLabel(e.target.value)}
              />
            </Field>
            <Field label={taxIdLabel.trim() || "Tax ID"}>
              <input className="wf-input" value={taxId} onChange={(e) => setTaxId(e.target.value)} />
            </Field>
          </div>
          <Field label="Time zone" hint="Shifts and attendance are recorded against it.">
            <input
              className="wf-input"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="Asia/Kolkata"
            />
          </Field>
        </div>

        {error ? (
          <p className="text-[0.8rem] font-semibold text-[var(--wf-red)]">{error}</p>
        ) : null}

        <p className="text-center text-[0.72rem] leading-relaxed text-[var(--wf-faint)]">
          Your plan, subscription and sign-in address are managed by Workfence.
          Ask support to change those.
        </p>
      </div>
    </div>
  );
}
