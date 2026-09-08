"use client";

/**
 * The company, on the administrator's own screen.
 *
 * Its name is the one thing about a company that shows up everywhere — the
 * header, the switcher, the sign-in page a worker sees — and until now the
 * only person who could change it was the platform owner. This is where its
 * administrator does.
 */

import { useState } from "react";
import { Chip, SectionTitle } from "./ui";
import { CompanyProfileSheet } from "./CompanyProfileSheet";
import { usePlatform } from "@/lib/platform-store";
import { useWorkforce } from "@/lib/store";
import { IEdit } from "./WfIcons";

export function CompanyProfileCard() {
  const { platform } = usePlatform();
  const { currentUser } = useWorkforce();
  const [editing, setEditing] = useState(false);

  // Only the company's own owner. A manager runs the sites; the company's
  // name and contact details are not theirs to change.
  if (currentUser?.role !== "admin") return null;
  const org = platform.organizations.find((o) => o.id === currentUser.orgId);
  if (!org) return null;

  return (
    <div className="wf-card flex flex-col gap-3 p-4">
      <SectionTitle>Company</SectionTitle>
      <div className="flex items-center gap-3">
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
        <button
          type="button"
          className="wf-btn wf-btn-ghost wf-btn-sm h-9 w-9 shrink-0 p-0"
          aria-label="Edit company profile"
          onClick={() => setEditing(true)}
        >
          <IEdit size={15} />
        </button>
      </div>
      <CompanyProfileSheet org={org} open={editing} onClose={() => setEditing(false)} />
    </div>
  );
}
