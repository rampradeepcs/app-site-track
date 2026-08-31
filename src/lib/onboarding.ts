"use client";

/**
 * Self-serve signup — the one call that turns a filled-in wizard into a
 * working company.
 *
 * A tenant is two things stored in two places: the operational side (people,
 * premises, assignments) in the workforce store, and the commercial side (the
 * organisation record and its subscription) in the platform store. They are
 * separate on purpose — a client's site data and the platform's billing data
 * should not share a table — but a signup creates both, and a company that
 * exists in only one of them is broken in a way neither screen can explain.
 *
 * So the order matters and is fixed here rather than in the UI: provision
 * first, because the admin being created needs an org id to belong to, then
 * file the commercial record against that same id.
 */

import { useCallback } from "react";
import { usePlatform } from "./platform-store";
import { useWorkforce, type CompanyDraft, type ProvisionedCompany } from "./store";

/** Blank fields a company fills in when it actually subscribes, not before. */
function newBilling(company: string, admin: CompanyDraft["admin"]) {
  return {
    legalName: company,
    contactName: admin.name,
    email: admin.email,
    phone: admin.phone ?? "",
    addressLine: "",
    city: "",
    state: "",
    postcode: "",
    country: "",
    taxIdLabel: "GSTIN",
    taxId: "",
    taxPercent: 18,
    currency: "INR" as const,
    paymentMethod: "",
  };
}

/** Initials for the in-app logo tile: "Born Creative" -> "BC". */
function logoText(company: string): string {
  const initials = company
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase();
  return initials || "WF";
}

export interface SignUpResult extends ProvisionedCompany {
  orgName: string;
  trialDays: number;
}

export function useSignUp() {
  const { provisionCompany } = useWorkforce();
  const { platform, onboardClient } = usePlatform();
  const settings = platform.platformSettings;

  const signUp = useCallback(
    (draft: CompanyDraft): SignUpResult => {
      const provisioned = provisionCompany(draft);
      const { orgId, admin } = provisioned;

      onboardClient({
        orgId,
        actor: { id: admin.id, name: admin.name },
        org: {
          name: draft.company,
          code: `${logoText(draft.company)}-${orgId.slice(-4).toUpperCase()}`,
          industry: "Construction",
          website: "",
          contactName: draft.admin.name,
          contactEmail: draft.admin.email,
          contactPhone: draft.admin.phone ?? "",
          country: "",
          // A real value, read off the device: shift times, "late" and the
          // attendance calendar are all local-calendar questions, and the
          // wrong zone quietly shifts every one of them.
          timezone:
            Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata",
          status: settings.defaultTrialDays > 0 ? "trial" : "active",
          billing: newBilling(draft.company, draft.admin),
          branding: {
            appName: "Workfence",
            accent: "#000000",
            logoText: logoText(draft.company),
          },
        },
        admin: {
          name: draft.admin.name,
          email: draft.admin.email,
          phone: draft.admin.phone ?? "",
          role: "Client Administrator",
        },
        planId: settings.defaultPlanId,
        cycle: "monthly",
        trialDays: settings.defaultTrialDays,
        limitOverrides: {},
        featureOverrides: {},
      });

      return {
        ...provisioned,
        orgName: draft.company,
        trialDays: settings.defaultTrialDays,
      };
    },
    [provisionCompany, onboardClient, settings],
  );

  return { signUp, signupsEnabled: settings.signupsEnabled };
}
