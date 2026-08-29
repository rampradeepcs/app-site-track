"use client";

/**
 * Site notices — the worker's view of project notes.
 *
 * Read-only, and only what has been shared with the workforce. The
 * filtering is the same `readableNotes` the manager screens use, so there
 * is exactly one implementation of who may read a note: a screen cannot
 * accidentally widen an audience by forgetting to ask.
 *
 * Called "Site notices" rather than "Project notes" on purpose. To a
 * labourer these are instructions from the people running the job, not a
 * shared notebook they contribute to.
 */

import { useMemo, useState } from "react";
import { ScreenHeader } from "@/components/shell";
import { BottomSheet, Chip } from "@/components/ui";
import { fmtDateLong, fmtTime } from "@/lib/format";
import { readableNotes } from "@/lib/notes";
import { NoteAttachments } from "@/components/notes/NoteAttachments";
import { useWorkforce } from "@/lib/store";
import type { NotePriority, ProjectNote } from "@/lib/types";
import { IBell } from "@/components/WfIcons";

const TONE: Record<NotePriority, "green" | "neutral" | "amber" | "red"> = {
  low: "neutral",
  normal: "neutral",
  important: "amber",
  critical: "red",
};

export default function EmployeeNotes() {
  const { state, currentUser } = useWorkforce();
  const [open, setOpen] = useState<ProjectNote | null>(null);

  /* Across every project this worker is on — they do not think in projects,
     they think in "what am I meant to know today". */
  const notes = useMemo(() => {
    if (!currentUser) return [];
    return currentUser.projectIds.flatMap((pid) =>
      readableNotes(state, currentUser.id, { projectId: pid }),
    );
  }, [state, currentUser]);

  if (!currentUser) return null;

  return (
    <div>
      <ScreenHeader
        back
        title="Site notices"
        sub={notes.length ? `${notes.length} for you` : "Nothing right now"}
      />

      <div className="flex flex-col gap-2 px-4">
        {notes.length === 0 ? (
          <div className="wf-card2 flex flex-col items-center gap-2.5 px-4 py-8 text-center">
            <IBell size={20} className="text-[var(--wf-faint)]" />
            <p className="text-sm text-[var(--wf-muted)]">
              No site notices for you at the moment. Instructions your
              supervisor shares with the crew appear here.
            </p>
          </div>
        ) : null}

        {notes.map((n) => {
          const project = state.projects.find((p) => p.id === n.projectId);
          const critical = n.priority === "critical";
          return (
            <button
              key={n.id}
              className="wf-card2 flex w-full cursor-pointer flex-col gap-1.5 px-3.5 py-3 text-left"
              onClick={() => setOpen(n)}
              style={critical ? { boxShadow: "0 0 0 1px var(--wf-warn)" } : undefined}
            >
              <div className="flex items-center gap-2">
                {n.pinned ? <span aria-hidden>📌</span> : null}
                <span className="min-w-0 flex-1 truncate font-semibold">{n.title}</span>
                {n.priority === "critical" || n.priority === "important" ? (
                  <Chip tone={TONE[n.priority]}>{n.priority}</Chip>
                ) : null}
              </div>
              {n.body ? (
                <p className="line-clamp-2 text-[0.78rem] leading-relaxed text-[var(--wf-muted)]">
                  {n.body}
                </p>
              ) : null}
              <p className="text-[0.66rem] text-[var(--wf-faint)]">
                {project?.name} · {n.category} · {fmtDateLong(n.createdAt)}
              </p>
            </button>
          );
        })}
      </div>

      <BottomSheet open={!!open} onClose={() => setOpen(null)} title={open?.title} tall>
        {open ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={TONE[open.priority]}>{open.priority}</Chip>
              <Chip tone="neutral">{open.category}</Chip>
              {open.pinned ? <Chip tone="amber">📌 Pinned</Chip> : null}
            </div>
            <p className="whitespace-pre-wrap text-[0.88rem] leading-relaxed">{open.body}</p>
            <p className="text-[0.72rem] text-[var(--wf-faint)]">
              {state.users.find((u) => u.id === open.authorId)?.name ?? "—"} ·{" "}
              {fmtDateLong(open.createdAt)} · {fmtTime(open.createdAt)}
            </p>
            {open.dueDate ? (
              <p className="wf-inset px-3.5 py-2.5 text-[0.78rem]">
                Due {fmtDateLong(open.dueDate)}
              </p>
            ) : null}
            {/* Read-only: the crew reads notices, it does not edit them. */}
            <NoteAttachments noteId={open.id} canEdit={false} />
          </div>
        ) : null}
      </BottomSheet>
    </div>
  );
}
