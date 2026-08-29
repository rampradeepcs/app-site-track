/**
 * Reading a crowd out of a photograph.
 *
 * Extracted so the project-wide capture and the team capture share one
 * matcher. Two implementations of "who is in this picture" would drift, and
 * the drift would show up as two screens disagreeing about whether a man
 * was at work.
 *
 * Nothing here decides attendance. It proposes, with a distance attached,
 * and a person decides.
 */

import { GROUP_MATCH_THRESHOLD, distance, readAllFaces, type GroupFace } from "./engine";
import type { User } from "../types";

/** How close two unmatched faces must be to be treated as the same stranger. */
const SAME_STRANGER = 0.45;

export interface DetectedFace {
  face: GroupFace;
  /** 96px crop, so a review row can show the face it is asking about. */
  thumb: string;
  /** Which photograph this came from, for multi-photo captures. */
  photoIndex: number;
  /** Proposed person, or null when nothing was close enough. */
  userId: string | null;
  distance: number;
}

export async function loadImage(dataUrl: string): Promise<HTMLImageElement | null> {
  return new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = dataUrl;
  }).catch(() => null);
}

/**
 * Cut each detected face out of the photo.
 *
 * A row that says "unrecognised face, choose a name" is unanswerable
 * without it: the supervisor is looking at a list of identical dropdowns
 * and a photo with several boxes, and nothing connects the two.
 */
export function cropFaces(img: HTMLImageElement, faces: GroupFace[]): string[] {
  return faces.map((f) => {
    const pad = 0.25;
    const x = Math.max(0, (f.box.x - f.box.w * pad) * img.naturalWidth);
    const y = Math.max(0, (f.box.y - f.box.h * pad) * img.naturalHeight);
    const w = Math.min(img.naturalWidth - x, f.box.w * (1 + pad * 2) * img.naturalWidth);
    const h = Math.min(img.naturalHeight - y, f.box.h * (1 + pad * 2) * img.naturalHeight);
    const c = document.createElement("canvas");
    c.width = 96;
    c.height = 96;
    const ctx = c.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(img, x, y, w, h, 0, 0, 96, 96);
    return c.toDataURL("image/jpeg", 0.8);
  });
}

/**
 * Greedy one-to-one assignment across every face in every photo.
 *
 * Score each face against each enrolled person, take the strongest pairs
 * first, and retire both sides as they are used. Simple, and it removes the
 * failure that matters: without it one clear face wins several boxes and
 * three men are all marked as the same person.
 *
 * Running it across all photos at once is what makes multi-photo captures
 * safe — a worker who appears in both frames can only be claimed once, so
 * the consolidated review cannot double-count them (spec §11).
 */
export function assignFaces(
  detections: Array<{ face: GroupFace; photoIndex: number }>,
  roster: User[],
): Map<number, { userId: string; d: number }> {
  const pairs: Array<{ fi: number; userId: string; d: number }> = [];
  detections.forEach((det, fi) => {
    for (const u of roster) {
      const descriptors = u.face?.descriptors ?? [];
      let best = Number.POSITIVE_INFINITY;
      for (const d of descriptors) best = Math.min(best, distance(det.face.descriptor, d));
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
  return assigned;
}

/**
 * Detect and match across a whole set of photographs.
 *
 * Faces nobody could be put to are then de-duplicated between photos, so a
 * stranger standing in two frames is reported once. Without it a two-photo
 * capture of eight workers cheerfully claims it found fourteen faces.
 */
export async function analysePhotos(
  photos: string[],
  roster: User[],
): Promise<{ detected: DetectedFace[]; faceCount: number }> {
  const raw: Array<{ face: GroupFace; photoIndex: number; thumb: string }> = [];

  for (let i = 0; i < photos.length; i++) {
    const faces = await readAllFaces(photos[i]);
    if (faces.length === 0) continue;
    const img = await loadImage(photos[i]);
    const thumbs = img ? cropFaces(img, faces) : faces.map(() => "");
    faces.forEach((face, k) => {
      raw.push({ face, photoIndex: i, thumb: thumbs[k] ?? "" });
    });
  }

  const assigned = assignFaces(raw, roster);

  const detected: DetectedFace[] = raw.map((r, i) => {
    const hit = assigned.get(i);
    return {
      face: r.face,
      thumb: r.thumb,
      photoIndex: r.photoIndex,
      userId: hit?.userId ?? null,
      distance: hit?.d ?? Number.POSITIVE_INFINITY,
    };
  });

  /* Collapse the same unidentified person appearing in more than one frame. */
  const keep: DetectedFace[] = [];
  for (const d of detected) {
    if (d.userId) {
      keep.push(d);
      continue;
    }
    const twin = keep.find(
      (k) =>
        !k.userId &&
        k.photoIndex !== d.photoIndex &&
        distance(k.face.descriptor, d.face.descriptor) < SAME_STRANGER,
    );
    if (!twin) keep.push(d);
  }

  return { detected: keep, faceCount: keep.length };
}
