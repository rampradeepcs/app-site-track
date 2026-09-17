"use client";

/**
 * Logging what a gang did today.
 *
 * Its own screen because of the photographs. They are read to data URLs and
 * held only here — a downward flick on a sheet took them with it, and unlike
 * typed text a picture of a wall as it was an hour ago cannot be taken
 * again.
 */

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { TeamUpdateScreen } from "@/components/teams/TeamUpdateScreen";
import { ScreenHeader } from "@/components/shell";
import { useWorkforce } from "@/lib/store";

export default function TeamUpdatePage() {
  return (
    <Suspense fallback={null}>
      <TeamUpdate />
    </Suspense>
  );
}

function TeamUpdate() {
  const params = useSearchParams();
  const { state } = useWorkforce();
  const id = params.get("id") ?? "";
  const team = state.labourTeams?.find((t) => t.id === id) ?? null;

  if (!team) {
    return (
      <div>
        <ScreenHeader back="/manager/teams" title="Team not found" />
        <p className="px-4 pt-6 text-center text-sm text-[var(--wf-muted)]">
          It may have been disbanded.
        </p>
      </div>
    );
  }
  return <TeamUpdateScreen team={team} backTo={`/manager/team?id=${team.id}`} />;
}
