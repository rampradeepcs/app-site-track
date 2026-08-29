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
  /** A crop of this face, so a picker row shows who it is asking about. */
  thumb: string;
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

  /**
   * Cut each detected face out of the photo.
   *
   * A row that says "unrecognised face, choose a name" is unanswerable
   * without it: the supervisor is looking at a list of identical dropdowns
   * and a photo with several boxes, and nothing connects the two.
   */
  const cropFaces = (img: HTMLImageElement, faces: GroupFace[]): string[] =>
    faces.map((f) => {
      const pad = 0.25;
      const x = Math.max(0, (f.box.x - f.box.w * pad) * img.naturalWidth);
      const y = Math.max(0, (f.box.y - f.box.h * pad) * img.naturalHeight);
      const w = Math.min(
        img.naturalWidth - x,
        f.box.w * (1 + pad * 2) * img.naturalWidth,
      );
      const h = Math.min(
        img.naturalHeight - y,
        f.box.h * (1 + pad * 2) * img.naturalHeight,
      );
      const c = document.createElement("canvas");
      c.width = 96;
      c.height = 96;
      const ctx = c.getContext("2d");
      if (!ctx) return "";
      ctx.drawImage(img, x, y, w, h, 0, 0, 96, 96);
      return c.toDataURL("image/jpeg", 0.8);
    });

  const analyse = async (dataUrl: string) => {
    setBusy(true);
    setError("");
    setCandidates([]);
    const faces = await readAllFaces(dataUrl);
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = dataUrl;
    }).catch(() => null);
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

    const thumbs = img ? cropFaces(img, faces) : faces.map(() => "");
    setCandidates(
      faces.map((face, i) => {
        const hit = assigned.get(i);
        return {
          face,
          thumb: thumbs[i] ?? "",
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
  /*
   * Who this will actually change. Someone already checked in is skipped,
   * so counting them in the button would promise more than it does — and
   * the supervisor would only find out on the screen after.
   */
  const willMark = chosen.filter((c) => !alreadyIn.has(c.userId!));
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
          <img
            src={photo}
            alt="Crew"
            className="max-h-[46vh] w-full object-contain"
          />
          {/* Numbered, because the rows below refer to these boxes and a
              colour alone cannot say which of four amber boxes is the one
              the third dropdown is asking about. */}
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
            >
              <span
                className="absolute -top-2 -left-2 grid h-5 w-5 place-items-center rounded-full text-[0.6rem] font-bold"
                style={{
                  background: c.dismissed
                    ? "var(--wf-faint)"
                    : c.userId
                      ? "var(--wf-green)"
                      : "var(--wf-warn)",
                  color: "#000",
                }}
              >
                {i + 1}
              </span>
            </span>
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

      {/* Nothing found is one message and one way forward — not a message,
          a "0 faces found" tally, and a dead "Mark 0 present" button all
          describing the same emptiness. */}
      {photo && !busy && candidates.length === 0 ? (
        <button
          className="wf-btn wf-btn-primary wf-btn-lg"
          onClick={() => fileRef.current?.click()}
        >
          <IRefresh size={16} /> Take another photo
        </button>
      ) : null}

      {photo && !busy && candidates.length > 0 ? (
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
                      <span className="relative shrink-0">
                        <Avatar name={u.name} hue={u.avatarHue} size={34} />
                        <span className="absolute -top-1 -left-1 grid h-4 w-4 place-items-center rounded-full bg-[var(--wf-green)] text-[0.55rem] font-bold text-black">
                          {candidates.indexOf(c) + 1}
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{u.name}</span>
                        <span className="block truncate text-[0.7rem] text-[var(--wf-muted)]">
                          {isIn
                            ? "Already checked in — left as it is"
                            : u.designation}
                        </span>
                      </span>
                      <button
                        className="wf-btn wf-btn-ghost wf-btn-sm wf-btn-danger-text shrink-0"
                        aria-label={`Not ${u.name}`}
                        onClick={() =>
                          setCandidates((prev) =>
                            prev.map((x) =>
                              x === c ? { ...x, userId: null, dismissed: false } : x,
                            ),
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
                {unmatched.map((c) => {
                  const n = candidates.indexOf(c) + 1;
                  return (
                    <div key={n} className="flex items-center gap-2.5">
                      {/* The crop is the whole point of this row: a column
                          of identical dropdowns beside a photo of four
                          boxes is a question nobody can answer. */}
                      <span className="relative shrink-0">
                        {c.thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={c.thumb}
                            alt={`Face ${n}`}
                            className="h-11 w-11 rounded-xl object-cover"
                          />
                        ) : (
                          <span className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--wf-fill-2)]">
                            <IUsers size={16} />
                          </span>
                        )}
                        <span className="absolute -top-1 -left-1 grid h-4 w-4 place-items-center rounded-full bg-[var(--wf-warn)] text-[0.55rem] font-bold text-black">
                          {n}
                        </span>
                      </span>
                      <select
                        className="wf-input min-w-0 flex-1"
                        aria-label={`Name for face ${n}`}
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
                        <option value="">Choose a name…</option>
                        {spare.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} · {u.employeeCode}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </Field>
          ) : null}

          <button
            className="wf-btn wf-btn-primary wf-btn-lg"
            disabled={willMark.length === 0}
            onClick={() => {
              const ids = chosen.map((c) => c.userId!).filter(Boolean);
              setDone(markPresentFromPhoto(ids, projectId));
            }}
          >
            <ICheck size={17} /> Mark {willMark.length} present
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
