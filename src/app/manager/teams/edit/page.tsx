"use client";

/**
 * Making or changing a labour team.
 *
 * `project` says which project a new team belongs to; `id` names the team
 * when one is being changed. A team opened for editing returns to its own
 * page, a new one to the list it came from.
 */

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { TeamForm } from "@/components/teams/TeamForm";
import { ScreenHeader } from "@/components/shell";
import { useWorkforce } from "@/lib/store";

export default function TeamEditPage() {
  return (
    <Suspense fallback={null}>
      <TeamEditScreen />
    </Suspense>
  );
}

function TeamEditScreen() {
  const params = useSearchParams();
  const { state } = useWorkforce();
  const id = params.get("id");
  const team = id ? (state.labourTeams?.find((t) => t.id === id) ?? null) : null;
  const projectId = team?.projectId ?? params.get("project") ?? state.activeProjectId ?? "";

  if (id && !team) {
    return (
      <div>
        <ScreenHeader back="/manager/teams" title="Team not found" />
        <p className="px-4 pt-6 text-center text-sm text-[var(--wf-muted)]">
          It may have been disbanded.
        </p>
      </div>
    );
  }
  return (
    <TeamForm
      key={team?.id ?? "new"}
      projectId={projectId}
      editing={team}
      backTo={team ? `/manager/team?id=${team.id}` : "/manager/teams"}
    />
  );
}
