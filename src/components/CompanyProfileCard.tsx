"use client";

/**
 * The company, on the More screen: enough to recognise, and the way in.
 *
 * The full record and the form both live on their own pages, so there is one
 * implementation of each rather than a card that quietly grows into a
 * second, shorter version of the same screen.
 */

import Link from "next/link";
import { Chip, SectionTitle } from "./ui";
import { usePlatform } from "@/lib/platform-store";
import { useWorkforce } from "@/lib/store";
import { IArrowR } from "./WfIcons";

export function CompanyProfileCard() {
  const { platform } = usePlatform();
  const { currentUser } = useWorkforce();

  // Managers and employees see the company's details too; only an owner may
  // change them, which the page itself enforces.
  if (!currentUser) return null;
  const org = platform.organizations.find((o) => o.id === currentUser.orgId);
  if (!org) return null;

  return (
    <div className="wf-card flex flex-col gap-3 p-4">
      <SectionTitle>Company</SectionTitle>
      <Link href="/admin/company" className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.95rem] font-bold">{org.name}</p>
          <p className="truncate text-[0.74rem] text-[var(--wf-muted)]">
            {org.code}
            {org.industry ? ` · ${org.industry}` : ""}
          </p>
        </div>
        <Chip tone={org.status === "active" ? "green" : "amber"}>
          {org.status[0].toUpperCase() + org.status.slice(1)}
        </Chip>
        <IArrowR size={16} className="shrink-0 text-[var(--wf-muted)]" />
      </Link>
    </div>
  );
}
