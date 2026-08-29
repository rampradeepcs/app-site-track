"use client";

/**
 * Files on a note.
 *
 * A safety instruction is often a photograph, and an inspection note is
 * often a PDF someone was emailed. Storing the words without them leaves
 * the note true but useless.
 *
 * Everything is held as a data-URL alongside the rest of the company's
 * records, which is the same bargain the selfies and group photos already
 * make: it works with no signal, and it never leaves the device unless the
 * org is running against a backend. The size cap exists because a phone
 * that stores four 12-megapixel photos per note will eventually fail to
 * save a checkout, and losing attendance to hold a picture is a bad trade.
 */

import { useRef, useState } from "react";
import { useWorkforce } from "@/lib/store";
import { noteAttachments } from "@/lib/notes";
import { VoiceRecorder, type RecordedNote } from "../VoiceRecorder";
import { IFile, IImage, IMic, ITrash } from "../WfIcons";

/** Per file. Generous for a photo, small enough that storage survives. */
const MAX_BYTES = 3_000_000;

function kindOf(mime: string, name: string): "image" | "pdf" | "document" | "voice" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "voice";
  if (mime === "application/pdf" || name.toLowerCase().endsWith(".pdf")) return "pdf";
  return "document";
}

function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function NoteAttachments({
  noteId,
  canEdit,
}: {
  noteId: string;
  canEdit: boolean;
}) {
  const { state, addNoteAttachment, removeNoteAttachment } = useWorkforce();
  const fileRef = useRef<HTMLInputElement>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");

  const files = noteAttachments(state, noteId);

  const attach = (file: File) => {
    if (file.size > MAX_BYTES) {
      setError(`${file.name} is ${human(file.size)}. Attachments are capped at ${human(MAX_BYTES)}.`);
      return;
    }
    setError("");
    const reader = new FileReader();
    reader.onload = () =>
      addNoteAttachment(noteId, {
        file: String(reader.result),
        name: file.name,
        type: kindOf(file.type, file.name),
        size: file.size,
      });
    reader.readAsDataURL(file);
  };

  const attachVoice = (note: RecordedNote | null) => {
    if (!note?.dataUrl) return;
    addNoteAttachment(noteId, {
      file: note.dataUrl,
      name: `Voice note — ${note.seconds}s`,
      type: "voice",
      size: Math.round(note.dataUrl.length * 0.75),
    });
    setRecording(false);
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[0.66rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
        Attachments{files.length ? ` (${files.length})` : ""}
      </p>

      {files.length === 0 && !canEdit ? (
        <p className="text-[0.74rem] text-[var(--wf-faint)]">Nothing attached.</p>
      ) : null}

      {files.map((a) => (
        <div key={a.id} className="wf-card2 flex items-center gap-3 px-3 py-2.5">
          {a.type === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.file} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
          ) : (
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-[var(--wf-fill-2)] text-[var(--wf-muted)]">
              {a.type === "voice" ? <IMic size={17} /> : <IFile size={17} />}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.8rem] font-semibold">{a.name}</span>
            <span className="block text-[0.66rem] text-[var(--wf-faint)]">
              {a.type} · {human(a.size)}
            </span>
          </span>
          {a.type === "voice" ? (
            <audio src={a.file} controls className="h-8 max-w-[9rem]" />
          ) : null}
          {canEdit ? (
            <button
              className="cursor-pointer p-1.5 text-[var(--wf-faint)] hover:text-[var(--wf-red)]"
              aria-label={`Remove ${a.name}`}
              onClick={() => removeNoteAttachment(a.id)}
            >
              <ITrash size={15} />
            </button>
          ) : null}
        </div>
      ))}

      {canEdit ? (
        <>
          <div className="flex gap-2">
            <button
              className="wf-btn wf-btn-ghost wf-btn-sm flex-1"
              onClick={() => fileRef.current?.click()}
            >
              <IImage size={14} /> Add file
            </button>
            <button
              className="wf-btn wf-btn-ghost wf-btn-sm flex-1"
              onClick={() => setRecording((r) => !r)}
              aria-pressed={recording}
            >
              <IMic size={14} /> {recording ? "Cancel voice" : "Voice note"}
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) attach(f);
              e.target.value = "";
            }}
          />
          {recording ? <VoiceRecorder value={null} onChange={attachVoice} /> : null}
          {error ? (
            <p className="text-[0.72rem] leading-snug text-[var(--wf-warn)]">{error}</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
