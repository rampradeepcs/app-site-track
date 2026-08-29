"use client";

/**
 * The pinned and critical notes for a project, as a strip.
 *
 * Deliberately short. A hint strip that lists everything is a list, and a
 * list at the top of a dashboard is scrolled past — which is exactly the
 * fate you do not want for "do not start painting Level 3".
 */

import Link from "next/link";
import { projectHints } from "@/lib/notes";
import { useWorkforce } from "@/lib/store";
import { IArrowR } from "../WfIcons";

export function ProjectHints({
  projectId,
  limit = 3,
  className,
}: {
  projectId: string;
  limit?: number;
  className?: string;
}) {
  const { state } = useWorkforce();
  const hints = projectHints(state, state.session?.userId, projectId, limit);
  if (hints.length === 0) return null;

  return (
    <div className={`flex flex-col gap-2 ${className ?? ""}`}>
      {hints.map((n) => {
        const critical = n.priority === "critical";
        return (
          <Link
            key={n.id}
            href={`/manager/notes?project=${projectId}&note=${n.id}`}
            className="wf-card2 flex items-start gap-2.5 px-3.5 py-2.5"
            style={
              critical ? { boxShadow: "0 0 0 1px var(--wf-warn)" } : undefined
            }
          >
            <span aria-hidden className="mt-[1px] text-[0.9rem]">
              {critical ? "⚠️" : "📌"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.82rem] font-semibold">
                {n.title}
              </span>
              {n.body ? (
                <span className="block truncate text-[0.7rem] text-[var(--wf-muted)]">
                  {n.body}
                </span>
              ) : null}
            </span>
            <IArrowR size={14} className="mt-1 shrink-0 text-[var(--wf-faint)]" />
          </Link>
        );
      })}
    </div>
  );
}
