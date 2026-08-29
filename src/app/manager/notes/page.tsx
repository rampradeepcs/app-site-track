"use client";

/**
 * Project notes.
 *
 * The whiteboard by the site gate, made durable and given an audience. The
 * ordering is the design: pinned first, then by priority, then newest —
 * because the reason to open this screen is almost never "what was written
 * most recently", it is "what do I need to know before I walk out there".
 */

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ScreenHeader } from "@/components/shell";
import { NoteEditor } from "@/components/notes/NoteEditor";
import { Avatar, BottomSheet, Chip, Segmented } from "@/components/ui";
import { canCreateNote, canEditNote, canPinNote } from "@/lib/access";
import { fmtDateLong, fmtTime } from "@/lib/format";
import { noteTimeline, readableNotes, usedCategories } from "@/lib/notes";
import { useWorkforce } from "@/lib/store";
import type { NotePriority, ProjectNote } from "@/lib/types";
import { IEdit, IPlus, ISearch, ITrash } from "@/components/WfIcons";

const PRIORITY_TONE: Record<NotePriority, "green" | "neutral" | "amber" | "red"> = {
  low: "neutral",
  normal: "neutral",
  important: "amber",
  critical: "red",
};

export default function NotesPage() {
  const params = useSearchParams();
  const { state, setNotePinned, setNoteStatus, deleteNote } = useWorkforce();

  const [projectId, setProjectId] = useState(
    params.get("project") ?? state.activeProjectId ?? state.projects[0]?.id ?? "",
  );
  const [view, setView] = useState<"list" | "timeline">("list");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("");
  const [priority, setPriority] = useState<string>("");
  const [includeClosed, setIncludeClosed] = useState(false);
  const [editing, setEditing] = useState<ProjectNote | null | "new">(null);
  const [open, setOpen] = useState<ProjectNote | null>(null);

  const me = state.session?.userId;
  const mayCreate = canCreateNote(state, me, projectId);
  const mayPin = canPinNote(state, me);

  const notes = useMemo(
    () =>
      readableNotes(state, me, {
        projectId,
        search: query,
        category: category || null,
        priority: (priority || null) as NotePriority | null,
        includeClosed,
      }),
    [state, me, projectId, query, category, priority, includeClosed],
  );

  const categories = useMemo(() => usedCategories(state, projectId), [state, projectId]);
  const timeline = useMemo(() => noteTimeline(notes), [notes]);

  return (
    <div>
      <ScreenHeader
        back
        title="Project notes"
        sub={`${notes.length} note${notes.length === 1 ? "" : "s"} you can see`}
        action={
          mayCreate ? (
            <button
              className="wf-btn wf-btn-primary wf-btn-sm"
              onClick={() => setEditing("new")}
            >
              <IPlus size={15} /> Note
            </button>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-3 px-4">
        {state.projects.length > 1 && (
          <select
            className="wf-input"
            aria-label="Project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            {state.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}

        <div className="relative">
          <ISearch
            size={16}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--wf-faint)]"
          />
          <input
            className="wf-input wf-input-search"
            aria-label="Search notes"
            placeholder="Search notes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <select
            className="wf-input"
            aria-label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            className="wf-input"
            aria-label="Priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option value="">Any priority</option>
            <option value="critical">Critical</option>
            <option value="important">Important</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Segmented
            ariaLabel="View"
            size="sm"
            value={view}
            onChange={setView}
            className="flex-1"
            options={[
              { value: "list", label: "By priority" },
              { value: "timeline", label: "Timeline" },
            ]}
          />
          <button
            className={`wf-btn wf-btn-sm ${includeClosed ? "wf-btn-primary" : "wf-btn-ghost"}`}
            onClick={() => setIncludeClosed((v) => !v)}
            aria-pressed={includeClosed}
          >
            Closed
          </button>
        </div>

        {notes.length === 0 ? (
          <div className="wf-card2 flex flex-col items-center gap-2.5 px-4 py-8 text-center">
            <p className="text-sm text-[var(--wf-muted)]">
              Nothing here yet. Notes are how a site keeps its instructions in
              one place.
            </p>
            {mayCreate ? (
              <button
                className="wf-btn wf-btn-ghost wf-btn-sm"
                onClick={() => setEditing("new")}
              >
                <IPlus size={14} /> Write the first note
              </button>
            ) : null}
          </div>
        ) : view === "list" ? (
          <div className="flex flex-col gap-2">
            {notes.map((n) => (
              <NoteCard key={n.id} note={n} onOpen={() => setOpen(n)} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {timeline.map((day) => (
              <div key={day.date} className="flex flex-col gap-2">
                <p className="text-[0.66rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
                  {fmtDateLong(day.date)}
                </p>
                {day.notes.map((n) => (
                  <NoteCard key={n.id} note={n} onOpen={() => setOpen(n)} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {projectId ? (
        <NoteEditor
          key={editing === "new" ? "new" : (editing?.id ?? "closed")}
          open={editing !== null}
          projectId={projectId}
          editing={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {/* one note, opened */}
      <BottomSheet open={!!open} onClose={() => setOpen(null)} title={open?.title} tall>
        {open ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={PRIORITY_TONE[open.priority]}>{open.priority}</Chip>
              <Chip tone="neutral">{open.category}</Chip>
              {open.pinned ? <Chip tone="amber">📌 Pinned</Chip> : null}
              {open.status !== "open" ? <Chip tone="neutral">{open.status}</Chip> : null}
            </div>

            <p className="whitespace-pre-wrap text-[0.88rem] leading-relaxed">{open.body}</p>

            <div className="wf-inset flex flex-col gap-1.5 px-3.5 py-3 text-[0.74rem]">
              <Detail label="Written by" value={state.users.find((u) => u.id === open.authorId)?.name ?? "—"} />
              <Detail label="When" value={`${fmtDateLong(open.createdAt)} · ${fmtTime(open.createdAt)}`} />
              <Detail label="Visible to" value={visibilityLabel(open.visibility)} />
              {open.dueDate ? <Detail label="Due" value={fmtDateLong(open.dueDate)} /> : null}
              {open.remindAt ? (
                <Detail label="Reminder" value={`${fmtDateLong(open.remindAt)} · ${fmtTime(open.remindAt)}`} />
              ) : null}
            </div>

            {mayPin ? (
              <button
                className="wf-btn wf-btn-ghost"
                onClick={() => {
                  setNotePinned(open.id, !open.pinned);
                  setOpen(null);
                }}
              >
                {open.pinned ? "Unpin from the project" : "📌 Pin to the project"}
              </button>
            ) : null}

            {canEditNote(state, open, me) ? (
              <>
                <button
                  className="wf-btn wf-btn-ghost"
                  onClick={() => {
                    setEditing(open);
                    setOpen(null);
                  }}
                >
                  <IEdit size={15} /> Edit note
                </button>
                <button
                  className="wf-btn wf-btn-ghost"
                  onClick={() => {
                    setNoteStatus(open.id, open.status === "done" ? "open" : "done");
                    setOpen(null);
                  }}
                >
                  {open.status === "done" ? "Reopen" : "Mark done"}
                </button>
                <button
                  className="wf-btn wf-btn-ghost wf-btn-danger-text"
                  onClick={() => {
                    deleteNote(open.id);
                    setOpen(null);
                  }}
                >
                  <ITrash size={15} /> Delete note
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </BottomSheet>
    </div>
  );

  function NoteCard({ note, onOpen }: { note: ProjectNote; onOpen: () => void }) {
    const author = state.users.find((u) => u.id === note.authorId);
    const critical = note.priority === "critical";
    return (
      <button
        className="wf-card2 flex w-full cursor-pointer flex-col gap-1.5 px-3.5 py-3 text-left"
        onClick={onOpen}
        style={critical ? { boxShadow: "0 0 0 1px var(--wf-warn)" } : undefined}
      >
        <div className="flex items-center gap-2">
          {note.pinned ? <span aria-hidden>📌</span> : null}
          <span className="min-w-0 flex-1 truncate font-semibold">{note.title}</span>
          <Chip tone={PRIORITY_TONE[note.priority]}>{note.priority}</Chip>
        </div>
        {note.body ? (
          <p className="line-clamp-2 text-[0.78rem] leading-relaxed text-[var(--wf-muted)]">
            {note.body}
          </p>
        ) : null}
        <div className="flex items-center gap-2 text-[0.66rem] text-[var(--wf-faint)]">
          <Avatar name={author?.name ?? "?"} hue={author?.avatarHue ?? 0} size={16} />
          <span className="truncate">{author?.name ?? "—"}</span>
          <span>·</span>
          <span>{note.category}</span>
          <span className="ml-auto tabular-nums">{fmtDateLong(note.createdAt)}</span>
        </div>
      </button>
    );
  }
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[var(--wf-muted)]">{label}</span>
      <span className="truncate font-semibold">{value}</span>
    </div>
  );
}

function visibilityLabel(v: ProjectNote["visibility"]): string {
  switch (v) {
    case "management":
      return "Management only";
    case "managers-engineers":
      return "Managers + site engineers";
    case "project-team":
      return "Everyone on the project";
    case "selected":
      return "Selected people";
    default:
      return v;
  }
}
