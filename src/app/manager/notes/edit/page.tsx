"use client";

/**
 * Writing or changing a project note.
 *
 * Its own screen, because a note is a title, a body, a category, a
 * visibility, a due date and a reminder — and a sheet holding that much
 * dismisses itself on a downward flick made by the thumb that is typing.
 *
 * `project` says which project it belongs to; `id` names the note when one
 * is being changed and is absent when one is being written.
 */

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { NoteForm } from "@/components/notes/NoteForm";
import { ScreenHeader } from "@/components/shell";
import { useWorkforce } from "@/lib/store";

export default function NotePage() {
  return (
    <Suspense fallback={null}>
      <NoteScreen />
    </Suspense>
  );
}

function NoteScreen() {
  const params = useSearchParams();
  const { state } = useWorkforce();
  const id = params.get("id");
  const note = id ? (state.projectNotes.find((n) => n.id === id) ?? null) : null;
  const projectId = note?.projectId ?? params.get("project") ?? state.activeProjectId ?? "";

  if (id && !note) {
    return (
      <div>
        <ScreenHeader back="/manager/notes" title="Note not found" />
        <p className="px-4 pt-6 text-center text-sm text-[var(--wf-muted)]">
          It may have been deleted.
        </p>
      </div>
    );
  }
  return (
    <NoteForm
      key={note?.id ?? "new"}
      projectId={projectId}
      editing={note}
      backTo="/manager/notes"
    />
  );
}
