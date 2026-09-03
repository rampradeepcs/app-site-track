"use client";

/**
 * The project list. Creating one is its own screen — see ./new.
 */

import Link from "next/link";
import { useMemo } from "react";
import { ScreenHeader } from "@/components/shell";
import { SiteMap } from "@/components/SiteMap";
import { Chip, StatusChip } from "@/components/ui";
import { liveBoard } from "@/lib/metrics";
import { useWorkforce } from "@/lib/store";
import { IArrowR, IHardHat, IPlus, IUsers } from "@/components/WfIcons";

export default function ManagerProjects() {
  const { state } = useWorkforce();

  const board = useMemo(() => liveBoard(state), [state]);

  return (
    <div>
      <ScreenHeader
        title="Projects"
        sub={`${state.projects.length} total · ${state.projects.filter((p) => p.status === "active").length} active`}
        action={
          <Link className="wf-btn wf-btn-primary wf-btn-sm" href="/manager/projects/new">
            <IPlus size={15} /> New project
          </Link>
        }
      />
      <div className="grid grid-cols-1 gap-3 px-4 md:grid-cols-2">
        {state.projects.map((p) => {
          const onsite = board.filter((b) => b.state === "working" && b.project?.id === p.id).length;
          return (
            <Link
              key={p.id}
              href={`/manager/project?id=${p.id}`}
              className="wf-card overflow-hidden transition hover:border-[var(--wf-line-strong)]"
            >
              <SiteMap
                project={p}
                heightClass="h-36 rounded-none border-0"
                /* A thumbnail inside a link: controls here would compete
                   with the tap that opens the project. */
                showControls={false}
                interactive={false}
              />
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="wf-display truncate">{p.name}</h2>
                    <p className="truncate text-[0.74rem] text-[var(--wf-muted)]">
                      {p.code} · {p.client}
                    </p>
                  </div>
                  <StatusChip
                    status={p.status === "active" ? "working" : "not-in"}
                    label={p.status[0].toUpperCase() + p.status.slice(1)}
                  />
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[0.72rem] text-[var(--wf-muted)]">
                  <Chip tone="green">
                    <IHardHat size={11} /> {onsite} on site
                  </Chip>
                  <Chip tone="neutral">
                    <IUsers size={11} /> {p.employeeIds.length} assigned
                  </Chip>
                  <span className="ml-auto flex items-center gap-1 font-semibold text-[var(--wf-amber)]">
                    Open <IArrowR size={13} />
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
