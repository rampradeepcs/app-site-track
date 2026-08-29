"use client";

/**
 * Write or amend a project note.
 *
 * Visibility is the field that matters and the one nobody wants to think
 * about, so it is not buried and it does not default to "everyone". Each
 * option says who it reaches in plain words, because "Managers + Site
 * Engineers" is a label and "the people running the job, not the crew" is
 * an answer.
 */

import { useState } from "react";
import { useWorkforce } from "@/lib/store";
import { usedCategories } from "@/lib/notes";
import { NOTE_CATEGORIES, type NotePriority, type NoteVisibility, type ProjectNote } from "@/lib/types";
import { BottomSheet, Field, Segmented } from "../ui";

const CUSTOM = "__custom__";

const VISIBILITY: Array<{ value: NoteVisibility; label: string; hint: string }> = [
  {
    value: "management",
    label: "Management only",
    hint: "Owners, admins and payroll. Not managers on site.",
  },
  {
    value: "managers-engineers",
    label: "Managers + site engineers",
    hint: "The people running the job. Not the crew.",
  },
  {
    value: "project-team",
    label: "Everyone on the project",
    hint: "Including labour. Use this for safety and site instructions.",
  },
];

export function NoteEditor({
  open,
  projectId,
  editing,
  onClose,
}: {
  open: boolean;
  projectId: string;
  editing?: ProjectNote | null;
  onClose: () => void;
}) {
  const { state, saveNote } = useWorkforce();

  const known = !editing || (NOTE_CATEGORIES as readonly string[]).includes(editing.category);
  const [category, setCategory] = useState(editing ? (known ? editing.category : CUSTOM) : "General");
  const [customCategory, setCustomCategory] = useState(known ? "" : (editing?.category ?? ""));
  const [title, setTitle] = useState(editing?.title ?? "");
  const [body, setBody] = useState(editing?.body ?? "");
  const [priority, setPriority] = useState<NotePriority>(editing?.priority ?? "normal");
  const [visibility, setVisibility] = useState<NoteVisibility>(
    editing?.visibility ?? "managers-engineers",
  );
  const [dueDate, setDueDate] = useState(editing?.dueDate ?? "");
  const [remindAt, setRemindAt] = useState(
    editing?.remindAt ? new Date(editing.remindAt).toISOString().slice(0, 16) : "",
  );
  const [pinned, setPinned] = useState(editing?.pinned ?? false);

  const resolvedCategory = category === CUSTOM ? customCategory.trim() : category;
  const canSave = title.trim().length > 0 && resolvedCategory.length > 0;

  const submit = () => {
    if (!canSave) return;
    saveNote(
      {
        projectId,
        title,
        body,
        category: resolvedCategory,
        priority,
        visibility,
        pinned,
        dueDate: dueDate || undefined,
        remindAt: remindAt ? new Date(remindAt).getTime() : undefined,
      },
      editing?.id,
    );
    onClose();
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={editing ? "Edit note" : "New note"} tall>
      <div className="flex flex-col gap-3.5">
        <Field label="Title" required>
          <input
            className="wf-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Concrete pour at 07:00 tomorrow"
          />
        </Field>

        <Field label="Note">
          <textarea
            className="wf-input"
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What the site needs to know."
          />
        </Field>

        <Field label="Category" required>
          <select
            className="wf-input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {NOTE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {usedCategories(state, projectId)
              .filter((c) => !(NOTE_CATEGORIES as readonly string[]).includes(c))
              .map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            <option value={CUSTOM}>Custom…</option>
          </select>
        </Field>

        {category === CUSTOM ? (
          <Field label="Custom category" required>
            <input
              className="wf-input"
              value={customCategory}
              onChange={(e) => setCustomCategory(e.target.value)}
              placeholder="Commissioning"
            />
          </Field>
        ) : null}

        <Field label="Priority">
          <Segmented
            ariaLabel="Priority"
            size="sm"
            value={priority}
            onChange={setPriority}
            options={[
              { value: "low", label: "Low" },
              { value: "normal", label: "Normal" },
              { value: "important", label: "Important" },
              { value: "critical", label: "Critical" },
            ]}
          />
        </Field>

        <div>
          <span className="wf-label">Who can see this</span>
          <div className="flex flex-col gap-2">
            {VISIBILITY.map((v) => (
              <button
                key={v.value}
                type="button"
                aria-pressed={visibility === v.value}
                onClick={() => setVisibility(v.value)}
                className="wf-card2 flex cursor-pointer items-start gap-2.5 px-3.5 py-2.5 text-left"
                style={
                  visibility === v.value
                    ? { boxShadow: "0 0 0 1.5px var(--wf-fg)" }
                    : undefined
                }
              >
                <span
                  className="mt-1 h-3 w-3 shrink-0 rounded-full"
                  style={{
                    background:
                      visibility === v.value ? "var(--wf-amber)" : "var(--wf-fill-2)",
                  }}
                />
                <span className="min-w-0">
                  <span className="block text-[0.82rem] font-semibold">{v.label}</span>
                  <span className="block text-[0.7rem] leading-snug text-[var(--wf-muted)]">
                    {v.hint}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Due date">
            <input
              type="date"
              className="wf-input"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </Field>
          <Field label="Remind at">
            <input
              type="datetime-local"
              className="wf-input"
              value={remindAt}
              onChange={(e) => setRemindAt(e.target.value)}
            />
          </Field>
        </div>

        <button
          type="button"
          className="wf-btn wf-btn-ghost"
          onClick={() => setPinned((p) => !p)}
          aria-pressed={pinned}
        >
          {pinned ? "📌 Pinned to the project" : "📌 Pin to the project"}
        </button>

        <button className="wf-btn wf-btn-primary wf-btn-lg" disabled={!canSave} onClick={submit}>
          {editing ? "Save note" : "Add note"}
        </button>
      </div>
    </BottomSheet>
  );
}
