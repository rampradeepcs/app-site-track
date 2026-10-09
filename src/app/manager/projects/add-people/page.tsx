"use client";

/**
 * Adding people from a project's Team tab.
 *
 * The same Add people screen as Team & Roles, opened on this project and
 * returning to its Team tab. It lives under /manager because the project
 * page does: a manager cannot enter /admin, and an admin can enter here.
 */

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AddPeople } from "@/components/AddPeople";
import { ScreenHeader } from "@/components/shell";
import { useWorkforce } from "@/lib/store";

export default function ProjectAddPeoplePage() {
  return (
    <Suspense fallback={null}>
      <ProjectAddPeople />
    </Suspense>
  );
}

function ProjectAddPeople() {
  const params = useSearchParams();
  const { state } = useWorkforce();
  const id = params.get("id") ?? "";
  const project = state.projects.find((p) => p.id === id) ?? null;

  if (!project) {
    return (
      <div>
        <ScreenHeader back="/manager/projects" title="Project not found" />
        <p className="px-4 pt-6 text-center text-sm text-[var(--wf-muted)]">
          It may have been removed.
        </p>
      </div>
    );
  }
  return (
    <AddPeople
      key={project.id}
      backTo={`/manager/project?id=${project.id}&tab=team`}
      presetProjectId={project.id}
    />
  );
}
