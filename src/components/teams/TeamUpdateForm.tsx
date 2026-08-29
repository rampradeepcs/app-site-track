"use client";

/**
 * Log what a gang did.
 *
 * One field is required — what happened. Everything else is picked up from
 * where and when it is written: the project, the team's zone, the time and
 * the GPS fix. A supervisor with a hard hat under one arm should be
 * answering a question, not completing a form.
 */

import { useState } from "react";
import { useWorkforce } from "@/lib/store";
import { WORK_CATEGORIES, type LabourTeam, type WorkCategory } from "@/lib/types";
import { BottomSheet, Field } from "../ui";
import { ICamera, IX } from "../WfIcons";

export function TeamUpdateForm({
  open,
  team,
  onClose,
}: {
  open: boolean;
  team: LabourTeam;
  onClose: () => void;
}) {
  const { state, submitTeamUpdate } = useWorkforce();
  const [category, setCategory] = useState<WorkCategory>("Civil Work");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [error, setError] = useState("");

  const project = state.projects.find((p) => p.id === team.projectId);
  const zone = project?.zones.find((z) => z.id === team.workZoneId);

  const addPhoto = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setPhotos((p) => [...p, String(reader.result)]);
    reader.readAsDataURL(file);
  };

  const submit = () => {
    const res = submitTeamUpdate({
      teamId: team.id,
      category,
      description,
      photos,
    });
    if (!res.ok) {
      setError(res.reason ?? "Could not log this update.");
      return;
    }
    setDescription("");
    setPhotos([]);
    setError("");
    onClose();
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={`${team.name} update`} tall>
      <div className="flex flex-col gap-3.5">
        <div className="wf-inset px-3.5 py-2.5">
          <p className="text-[0.74rem] text-[var(--wf-muted)]">
            {project?.name}
            {zone ? ` · ${zone.name}` : ""}
          </p>
          <p className="mt-0.5 text-[0.68rem] text-[var(--wf-faint)]">
            Recorded against the team, timestamped, and located from where you
            are standing.
          </p>
        </div>

        <Field label="Category">
          <select
            className="wf-input"
            value={category}
            onChange={(e) => setCategory(e.target.value as WorkCategory)}
          >
            {WORK_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>

        <Field label="What did the team do?" required>
          <textarea
            className="wf-input"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Water line installation completed for Level 2."
          />
        </Field>

        <div>
          <span className="wf-label">Photos</span>
          <div className="grid grid-cols-4 gap-2">
            {photos.map((p, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p} alt="" className="h-16 w-full rounded-lg object-cover" />
                <button
                  className="absolute right-1 top-1 grid h-5 w-5 cursor-pointer place-items-center rounded-full bg-[rgba(0,0,0,0.6)] text-white"
                  aria-label={`Remove photo ${i + 1}`}
                  onClick={() => setPhotos((ps) => ps.filter((_, k) => k !== i))}
                >
                  <IX size={10} />
                </button>
              </div>
            ))}
            <label className="wf-card2 grid h-16 cursor-pointer place-items-center text-[var(--wf-muted)]">
              <ICamera size={16} />
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) addPhoto(f);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </div>

        {error ? (
          <p className="wf-inset px-3.5 py-2.5 text-[0.78rem] text-[var(--wf-red)]">{error}</p>
        ) : null}

        <button
          className="wf-btn wf-btn-primary wf-btn-lg"
          disabled={description.trim().length < 4}
          onClick={submit}
        >
          Log update
        </button>
      </div>
    </BottomSheet>
  );
}
