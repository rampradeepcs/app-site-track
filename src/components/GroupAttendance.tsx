"use client";

/**
 * Mark a crew present from one photograph.
 *
 * The photo is a shortcut through the queue at a gate, not an authority.
 * A face in a group shot is small, often turned and sometimes half behind
 * a helmet, so every match here is a *proposal*: the supervisor sees who
 * was found, who was guessed, and who could not be placed, and nothing is
 * written until they say so. Auto-marking from this would be a register
 * full of confident mistakes nobody knew to look for.
 *
 * The matching is one-to-one. A person can be proposed for only one face
 * in the photo — without that, one clear face tends to win several boxes
 * and three people are all marked as the same man.
 */

import { useMemo, useRef, useState } from "react";
import { useWorkforce } from "@/lib/store";
import {
  GROUP_MATCH_THRESHOLD,
  distance,
  likelySupported,
  readAllFaces,
  type GroupFace,
} from "@/lib/face/engine";
import type { User } from "@/lib/types";
import { Avatar, BottomSheet, Field } from "./ui";
import { ICamera, ICheck, IRefresh, IUsers, IX } from "./WfIcons";

interface Candidate {
  face: GroupFace;
  /** Proposed person, or null when nothing was close enough. */
  userId: string | null;
  distance: number;
  /** Cleared by the supervisor, or never proposed. */
  dismissed: boolean;
}

export function GroupAttendance({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const { state, markPresentFromPhoto } = useWorkforce();
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [done, setDone] = useState<{ marked: number; skipped: number } | null>(null);

  /** Enrolled people on this project — the only ones a face can be. */
  const roster = useMemo(
    () =>
      state.users.filter(
        (u) =>
          u.status === "active" &&
          u.face?.descriptors?.length &&
          (u.projectIds.includes(projectId) || u.projectIds.length === 0),
      ),
    [state.users, projectId],
  );

  const alreadyIn = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return new Set(
      state.attendance.filter((a) => a.date === today).map((a) => a.employeeId),
    );
  }, [state.attendance]);

  const analyse = async (dataUrl: string) => {
    setBusy(true);
    setError("");
    setCandidates([]);
    const faces = await readAllFaces(dataUrl);
    if (faces.length === 0) {
      setError(
        "No faces found. Get closer, or take the photo with everyone facing the camera.",
      );
      setBusy(false);
      return;
    }

    /*
     * Greedy one-to-one assignment: score every face against every enrolled
     * person, then take the strongest pairs first, retiring both sides as
     * they are used. Simple, and it removes the failure that matters —
     * the same person proposed for several faces at once.
     */
    const pairs: Array<{ fi: number; userId: string; d: number }> = [];
    faces.forEach((f, fi) => {
      for (const u of roster) {
        let best = Number.POSITIVE_INFINITY;
        for (const d of u.face!.descriptors) best = Math.min(best, distance(f.descriptor, d));
        if (best <= GROUP_MATCH_THRESHOLD) pairs.push({ fi, userId: u.id, d: best });
      }
    });
    pairs.sort((a, b) => a.d - b.d);

    const takenFace = new Set<number>();
    const takenUser = new Set<string>();
    const assigned = new Map<number, { userId: string; d: number }>();
    for (const p of pairs) {
      if (takenFace.has(p.fi) || takenUser.has(p.userId)) continue;
      takenFace.add(p.fi);
      takenUser.add(p.userId);
      assigned.set(p.fi, { userId: p.userId, d: p.d });
    }

    setCandidates(
      faces.map((face, i) => {
        const hit = assigned.get(i);
        return {
          face,
          userId: hit?.userId ?? null,
          distance: hit?.d ?? Number.POSITIVE_INFINITY,
          dismissed: false,
        };
      }),
    );
    setBusy(false);
  };

  const pick = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      setPhoto(url);
      setDone(null);
      void analyse(url);
    };
    reader.readAsDataURL(file);
  };

  const chosen = candidates.filter((c) => c.userId && !c.dismissed);
  const unmatched = candidates.filter((c) => !c.userId && !c.dismissed);
  const userById = (id: string) => state.users.find((u) => u.id === id);

  /** People on the roster nobody in the photo was matched to. */
  const spare = roster.filter(
    (u) => !candidates.some((c) => c.userId === u.id && !c.dismissed),
  );

  if (!likelySupported()) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-[0.9rem] leading-relaxed">
          This phone cannot run face detection.
        </p>
        <p className="text-[0.8rem] leading-relaxed text-[var(--wf-muted)]">
          Attendance can still be marked from the workforce list, one person
          at a time.
        </p>
        <button className="wf-btn wf-btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <p className="wf-display text-[1.15rem]">
          {done.marked} marked present
        </p>
        {done.skipped ? (
          <p className="text-[0.82rem] leading-relaxed text-[var(--wf-muted)]">
            {done.skipped} were already checked in and were left as they were —
            their original check-in time stands.
          </p>
        ) : null}
        <button className="wf-btn wf-btn-primary wf-btn-lg" onClick={onClose}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) pick(f);
          e.target.value = "";
        }}
      />

      {photo ? (
        <div className="relative overflow-hidden rounded-2xl bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt="Crew" className="w-full" />
          {candidates.map((c, i) => (
            <span
              key={i}
              className="pointer-events-none absolute rounded-md border-2"
              style={{
                left: `${c.face.box.x * 100}%`,
                top: `${c.face.box.y * 100}%`,
                width: `${c.face.box.w * 100}%`,
                height: `${c.face.box.h * 100}%`,
                borderColor: c.dismissed
                  ? "var(--wf-faint)"
                  : c.userId
                    ? "var(--wf-green)"
                    : "var(--wf-warn)",
              }}
            />
          ))}
        </div>
      ) : (
        <button
          className="wf-btn wf-btn-primary wf-btn-lg"
          onClick={() => fileRef.current?.click()}
        >
          <ICamera size={17} /> Take a photo of the crew
        </button>
      )}

      {busy ? (
        <p className="flex items-center justify-center gap-2 py-4 text-[0.86rem] text-[var(--wf-muted)]">
          <IRefresh size={15} /> Looking for faces…
        </p>
      ) : null}

      {error ? (
        <p className="text-[0.82rem] font-semibold text-[var(--wf-red)]">{error}</p>
      ) : null}

      {photo && !busy ? (
        <>
          <p className="text-[0.8rem] leading-relaxed text-[var(--wf-muted)]">
            {candidates.length} face{candidates.length === 1 ? "" : "s"} found ·{" "}
            {chosen.length} recognised
            {unmatched.length ? ` · ${unmatched.length} not recognised` : ""}
          </p>

          {chosen.length ? (
            <Field label="Recognised — uncheck anyone who is wrong">
              <div className="flex flex-col gap-2">
                {chosen.map((c, i) => {
                  const u = userById(c.userId!);
                  if (!u) return null;
                  const isIn = alreadyIn.has(u.id);
                  return (
                    <div
                      key={`${c.userId}-${i}`}
                      className="wf-card2 flex items-center gap-3 px-3.5 py-2.5"
                    >
                      <Avatar name={u.name} hue={u.avatarHue} size={34} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{u.name}</span>
                        <span className="block truncate text-[0.7rem] text-[var(--wf-muted)]">
                          {isIn
                            ? "Already checked in — will be left alone"
                            : `${u.designation} · match ${(1 - c.distance).toFixed(2)}`}
                        </span>
                      </span>
                      <button
                        className="wf-btn wf-btn-ghost wf-btn-sm wf-btn-danger-text shrink-0"
                        onClick={() =>
                          setCandidates((prev) =>
                            prev.map((x) => (x === c ? { ...x, dismissed: true } : x)),
                          )
                        }
                      >
                        <IX size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </Field>
          ) : null}

          {unmatched.length ? (
            <Field
              label={`${unmatched.length} face${unmatched.length === 1 ? "" : "s"} not recognised`}
              hint="Assign them by name, or leave them — nobody is marked by guesswork."
            >
              <div className="flex flex-col gap-2">
                {unmatched.map((c, i) => (
                  <select
                    key={i}
                    className="wf-input"
                    value=""
                    onChange={(e) => {
                      const id = e.target.value;
                      if (!id) return;
                      setCandidates((prev) =>
                        prev.map((x) =>
                          x === c ? { ...x, userId: id, distance: 0 } : x,
                        ),
                      );
                    }}
                  >
                    <option value="">Unrecognised face — choose a name</option>
                    {spare.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} · {u.employeeCode}
                      </option>
                    ))}
                  </select>
                ))}
              </div>
            </Field>
          ) : null}

          <button
            className="wf-btn wf-btn-primary wf-btn-lg"
            disabled={chosen.length === 0}
            onClick={() => {
              const ids = chosen.map((c) => c.userId!).filter(Boolean);
              setDone(markPresentFromPhoto(ids, projectId));
            }}
          >
            <ICheck size={17} /> Mark {chosen.length} present
          </button>

          <button
            className="wf-btn wf-btn-ghost"
            onClick={() => fileRef.current?.click()}
          >
            <IRefresh size={15} /> Take another photo
          </button>
        </>
      ) : null}
    </div>
  );
}

/** Opens the flow from a manager screen. */
export function GroupAttendanceButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => setOpen(true)}>
        <IUsers size={14} /> Group photo
      </button>
      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Mark attendance from a photo"
        tall
      >
        {open ? (
          <GroupAttendance projectId={projectId} onClose={() => setOpen(false)} />
        ) : null}
      </BottomSheet>
    </>
  );
}
