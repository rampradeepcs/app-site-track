"use client";

/**
 * The company, in full.
 *
 * Everything a company knows about itself on one screen: what it is called,
 * how it is reached, who to ask for, where it is registered and what it is
 * registered as. The plan and the invoices are deliberately not repeated
 * here — Subscription owns those — but the page links to them, because
 * somebody checking their tax number is often on their way there.
 *
 * Read-only, with one way in to change it. A form the moment you open it
 * invites a stray keystroke into a field nobody meant to touch.
 */

import Link from "next/link";
import { ScreenHeader } from "@/components/shell";
import { Chip, Fact, Facts, SectionTitle } from "@/components/ui";
import { useEntitlements, useViewingOrgId } from "@/components/FeatureGate";
import { usePlatform } from "@/lib/platform-store";
import { useWorkforce } from "@/lib/store";
import { fmtDateLong } from "@/lib/format";
import { TENANT_BASE_DOMAIN, tenantUrl } from "@/lib/tenant";
import { IArrowR, IEdit } from "@/components/WfIcons";


export default function CompanyPage() {
  const { platform } = usePlatform();
  const { state, currentUser } = useWorkforce();
  const ent = useEntitlements();
  const viewingOrgId = useViewingOrgId();

  const org = platform.organizations.find((o) => o.id === viewingOrgId);
  const canEdit = currentUser?.role === "admin";

  if (!org) {
    return (
      <div>
        <ScreenHeader back="/admin/more" title="Company" />
        <p className="px-4 pt-6 text-center text-sm text-[var(--wf-muted)]">
          This company&apos;s details haven&apos;t loaded yet.
        </p>
      </div>
    );
  }

  const b = org.billing;
  const address = [b.addressLine, b.city, b.state, b.postcode, b.country]
    .filter((x) => x && x.trim())
    .join(", ");
  const people = state.users.filter((u) => u.status !== "revoked").length;

  return (
    <div>
      <ScreenHeader
        back="/admin/more"
        title={org.name}
        sub={`${org.code}${org.industry ? ` · ${org.industry}` : ""}`}
        action={
          canEdit ? (
            <Link href="/admin/company/edit" className="wf-btn wf-btn-primary wf-btn-sm">
              <IEdit size={14} /> Edit
            </Link>
          ) : null
        }
      />
      <div className="flex flex-col gap-4 px-4 pb-8">
        <div className="wf-card flex flex-col gap-1 p-4">
          <div className="flex items-center justify-between gap-3 pb-1">
            <SectionTitle>Identity</SectionTitle>
            <Chip tone={org.status === "active" ? "green" : "amber"}>
              {org.status[0].toUpperCase() + org.status.slice(1)}
            </Chip>
          </div>
          <Facts>
  <Fact label="Company name" value={org.name} />
            <Fact label="Legal name" value={b.legalName} />
            <Fact label="Company ID" value={org.code} />
            <Fact label="Industry" value={org.industry} />
            <Fact label="Website" value={org.website} />
            <Fact label="On Workfence since" value={fmtDateLong(new Date(org.createdAt).toISOString().slice(0, 10))} />
          </Facts>
          {org.suspendedReason ? (
            <p className="mt-1 rounded-xl bg-[var(--wf-red-soft)] p-3 text-[0.8rem] leading-relaxed">
              Suspended: {org.suspendedReason}
            </p>
          ) : null}
        </div>

        <div className="wf-card flex flex-col gap-1 p-4">
          <SectionTitle>Primary contact</SectionTitle>
          <Facts>
  <Fact label="Name" value={org.contactName} />
            <Fact label="Email" value={org.contactEmail} />
            <Fact label="Phone" value={org.contactPhone} />
          </Facts>
        </div>

        <div className="wf-card flex flex-col gap-1 p-4">
          <SectionTitle>Registered address &amp; tax</SectionTitle>
          <Facts>
  <Fact label="Address" value={address} />
            <Fact label={b.taxIdLabel || "Tax ID"} value={b.taxId} />
            <Fact label="Currency" value={b.currency} />
            <Fact label="Time zone" value={org.timezone} />
          </Facts>
        </div>

        <div className="wf-card flex flex-col gap-1 p-4">
          <SectionTitle>How your crew sees it</SectionTitle>
          <Facts>
  <Fact label="App name" value={org.branding.appName} />
            <Fact
              label="Sign-in address"
              value={org.slug ? tenantUrl(org.slug) : undefined}
            />
          </Facts>
          {!TENANT_BASE_DOMAIN && org.slug ? (
            <p className="pt-1 text-[0.72rem] leading-relaxed text-[var(--wf-faint)]">
              Workers can reach a sign-in page branded for {org.name} at this
              address.
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <Link href="/admin/team" className="wf-card2 px-3.5 py-3">
            <p className="text-[1.05rem] font-bold tabular-nums">{people}</p>
            <p className="text-[0.66rem] uppercase tracking-wider text-[var(--wf-muted)]">
              People
            </p>
          </Link>
          <Link href="/admin/subscription" className="wf-card2 px-3.5 py-3">
            <p className="truncate text-[1.05rem] font-bold">{ent.planName}</p>
            <p className="text-[0.66rem] uppercase tracking-wider text-[var(--wf-muted)]">
              Plan
            </p>
          </Link>
        </div>

        <Link
          href="/admin/subscription"
          className="wf-card2 flex items-center gap-2 px-3.5 py-3"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[0.84rem] font-semibold">
              Subscription &amp; invoices
            </span>
            <span className="block text-[0.72rem] text-[var(--wf-muted)]">
              Your plan, limits and billing history
            </span>
          </span>
          <IArrowR size={15} className="shrink-0 text-[var(--wf-muted)]" />
        </Link>

        {canEdit ? null : (
          <p className="text-center text-[0.74rem] leading-relaxed text-[var(--wf-faint)]">
            Only a company administrator can change these details.
          </p>
        )}
      </div>
    </div>
  );
}
