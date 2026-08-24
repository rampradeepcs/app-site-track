"use client";

/**
 * Work update form — used mid-shift (quick update) and after checkout
 * (full daily summary). Location + timestamp attach automatically.
 */

import { useState } from "react";
import { useWorkforce } from "@/lib/store";
import { WORK_CATEGORIES, type WorkCategory } from "@/lib/types";
import { Field } from "./ui";
import { ICamera, ICheck, IMapPin, IMic } from "./WfIcons";

export function WorkUpdateForm({
  kind,
  onDone,
  onSkip,
}: {
  kind: "shift" | "daily";
  onDone: () => void;
  onSkip?: () => void;
}) {
  const { submitWorkUpdate, fix, fence, online } = useWorkforce();
  const [category, setCategory] = useState<WorkCategory>(
    kind === "daily" ? "Documentation" : "Civil Work",
  );
  const [description, setDescription] = useState("");
  const [completed, setCompleted] = useState("");
  const [inProgress, setInProgress] = useState("");
  const [blockers, setBlockers] = useState("");
  const [materials, setMaterials] = useState("");
  const [safety, setSafety] = useState("");
  const [tomorrow, setTomorrow] = useState("");
  const [photos, setPhotos] = useState(0);
  const [voice, setVoice] = useState(0);
  const [error, setError] = useState("");

  const submit = () => {
    if (description.trim().length < 4) {
      setError("Add a short description of the work.");
      return;
    }
    submitWorkUpdate({
      kind,
      category,
      description: description.trim(),
      completed: completed.trim() || undefined,
      inProgress: inProgress.trim() || undefined,
      blockers: blockers.trim() || undefined,
      materials: materials.trim() || undefined,
      safety: safety.trim() || undefined,
      tomorrow: tomorrow.trim() || undefined,
      photos: Array.from({ length: photos }, (_, i) => `photo-${i}`),
      voiceNoteSeconds: voice || undefined,
    });
    onDone();
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <span className="wf-label">Work category</span>
        <div className="flex flex-wrap gap-1.5">
          {WORK_CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`cursor-pointer rounded-full border px-3 py-1.5 text-[0.76rem] font-semibold transition ${
                category === c
                  ? "border-[var(--wf-amber)] bg-[rgba(246,167,35,0.15)] text-[var(--wf-amber)]"
                  : "border-[var(--wf-line)] bg-[var(--wf-surface2)] text-[var(--wf-muted)] hover:text-[var(--wf-fg)]"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <Field label={kind === "daily" ? "What did you work on today?" : "What's happening?"} required>
        <textarea
          className="wf-input"
          rows={3}
          placeholder={
            kind === "daily"
              ? "Summary of today's work…"
              : "e.g. Concrete reinforcement inspection completed at Block B"
          }
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setError("");
          }}
        />
      </Field>
      {error ? (
        <p className="-mt-2 text-[0.78rem] font-semibold text-[var(--wf-red)]">{error}</p>
      ) : null}

      {kind === "daily" && (
        <>
          <Field label="Work completed">
            <textarea className="wf-input" rows={2} value={completed} onChange={(e) => setCompleted(e.target.value)} placeholder="Closed-out scope…" />
          </Field>
          <Field label="Work in progress">
            <textarea className="wf-input" rows={2} value={inProgress} onChange={(e) => setInProgress(e.target.value)} placeholder="Carry-over items…" />
          </Field>
          <Field label="Issues / blockers">
            <textarea className="wf-input" rows={2} value={blockers} onChange={(e) => setBlockers(e.target.value)} placeholder="Anything blocking progress…" />
          </Field>
          <Field label="Materials required">
            <input className="wf-input" value={materials} onChange={(e) => setMaterials(e.target.value)} placeholder="e.g. Binding wire, cover blocks" />
          </Field>
          <Field label="Safety observations">
            <input className="wf-input" value={safety} onChange={(e) => setSafety(e.target.value)} placeholder="e.g. Edge protection checked" />
          </Field>
          <Field label="Tomorrow's plan">
            <input className="wf-input" value={tomorrow} onChange={(e) => setTomorrow(e.target.value)} placeholder="Next steps…" />
          </Field>
        </>
      )}

      <div className="flex gap-2.5">
        <button
          className="wf-btn wf-btn-ghost wf-btn-sm flex-1"
          onClick={() => setPhotos((p) => (p + 1) % 4)}
        >
          <ICamera size={15} /> {photos ? `${photos} photo${photos > 1 ? "s" : ""}` : "Add photo"}
        </button>
        <button
          className="wf-btn wf-btn-ghost wf-btn-sm flex-1"
          onClick={() => setVoice((v) => (v ? 0 : 32))}
        >
          <IMic size={15} /> {voice ? `Voice ${voice}s` : "Voice note"}
        </button>
      </div>

      <div className="wf-inset flex items-center gap-2 px-3 py-2 text-[0.74rem] text-[var(--wf-muted)]">
        <IMapPin size={13} className="shrink-0 text-[var(--wf-green)]" />
        {fix
          ? `Location attached automatically · ±${Math.round(fix.accuracy)}m${fence?.inside ? " · on site" : ""}`
          : "Location will attach when GPS is available"}
        {!online && <span className="ml-auto font-bold text-[var(--wf-amber)]">will queue</span>}
      </div>

      <div className="flex gap-2.5">
        {onSkip && (
          <button className="wf-btn wf-btn-ghost flex-1" onClick={onSkip}>
            Skip for now
          </button>
        )}
        <button className="wf-btn wf-btn-primary flex-1" onClick={submit}>
          <ICheck size={17} /> Submit update
        </button>
      </div>
    </div>
  );
}
