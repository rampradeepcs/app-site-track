"use client";

/**
 * On-device face recognition.
 *
 * Everything here runs in the WebView: the model files ship inside the app,
 * a face never leaves the phone, and a gate with no signal still works —
 * which is the whole reason this app has an offline outbox in the first
 * place. Nothing is uploaded and there is no per-check-in cost.
 *
 * What is stored is a descriptor, not a photograph: 128 floats that describe
 * a face well enough to compare against another one and not well enough to
 * reconstruct it. It is still biometric data and is treated as such — it
 * lives with the employee record on this device, and deleting the enrolment
 * removes it.
 *
 * The whole module is loaded on demand. A phone that cannot run the model
 * never downloads it, and the app behaves exactly as it did before.
 */

import type * as FaceApi from "@vladmandic/face-api";

export type FaceSupport = "unknown" | "supported" | "unsupported";

/** 128 floats. Stored per employee; compared, never rendered. */
export type FaceDescriptor = number[];

const MODEL_URL = "/models";

/**
 * Below this distance two descriptors are the same person.
 *
 * 0.6 is the figure the model's authors quote for this architecture, and
 * it is deliberately not tightened: a site is dusty, lit badly and full of
 * helmets, and the cost of a false rejection there is a worker who cannot
 * start a paid shift.
 */
export const MATCH_THRESHOLD = 0.6;

let api: typeof FaceApi | null = null;
let loading: Promise<typeof FaceApi | null> | null = null;
let support: FaceSupport = "unknown";

/**
 * Whether this device can plausibly run the model, before committing to a
 * 6MB download. WebGL is the honest signal — TensorFlow falls back to a
 * CPU backend without it, which on a low-end phone takes long enough that
 * a queue forms at the gate.
 */
export function likelySupported(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ??
      canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl");
    if (!gl) return false;
    // Very small heaps mean the model load itself is likely to fail.
    const mem = (navigator as { deviceMemory?: number }).deviceMemory;
    return mem === undefined || mem >= 2;
  } catch {
    return false;
  }
}

export function supportState(): FaceSupport {
  if (support !== "unknown") return support;
  return likelySupported() ? "unknown" : "unsupported";
}

/**
 * Load the library and its weights once.
 *
 * Returns null rather than throwing when the device cannot manage it: the
 * caller's job is to fall back to the ordinary selfie, not to handle an
 * exception on a check-in screen.
 */
export async function loadFaceEngine(): Promise<typeof FaceApi | null> {
  if (api) return api;
  if (support === "unsupported") return null;
  if (!likelySupported()) {
    support = "unsupported";
    return null;
  }
  if (loading) return loading;

  loading = (async () => {
    try {
      const mod = await import("@vladmandic/face-api");
      await Promise.all([
        mod.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        mod.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
        mod.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      api = mod;
      support = "supported";
      return mod;
    } catch {
      support = "unsupported";
      return null;
    } finally {
      loading = null;
    }
  })();

  return loading;
}

/** An image element from a data URL, ready to feed the model. */
function toImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image"));
    img.src = dataUrl;
  });
}

export interface FaceReading {
  descriptor: FaceDescriptor;
  /** How confident the detector was that this is a face at all. */
  score: number;
}

/**
 * The single most prominent face in a photo.
 *
 * One face on purpose: enrolment and check-in are both about one person,
 * and quietly picking among several would be a guess presented as a fact.
 */
export async function readFace(dataUrl: string): Promise<FaceReading | null> {
  const mod = await loadFaceEngine();
  if (!mod) return null;
  try {
    const img = await toImage(dataUrl);
    const found = await mod
      .detectSingleFace(img, new mod.TinyFaceDetectorOptions({ inputSize: 416 }))
      .withFaceLandmarks(true)
      .withFaceDescriptor();
    if (!found) return null;
    return {
      descriptor: Array.from(found.descriptor),
      score: found.detection.score,
    };
  } catch {
    return null;
  }
}

/** Euclidean distance. Smaller is more alike; see MATCH_THRESHOLD. */
export function distance(a: FaceDescriptor, b: FaceDescriptor): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export interface MatchResult {
  matched: boolean;
  /** Distance to the closest enrolled sample. */
  distance: number;
  /** 0–1, for showing a human a number that gets larger when it is better. */
  confidence: number;
}

/**
 * Compare a reading against everything enrolled for one person.
 *
 * The best of several samples wins rather than an average: the samples
 * exist precisely because a face looks different in different light, and
 * averaging them would blur away the variation they were captured for.
 */
export function matchAgainst(
  reading: FaceDescriptor,
  enrolled: FaceDescriptor[],
): MatchResult {
  let best = Number.POSITIVE_INFINITY;
  for (const d of enrolled) best = Math.min(best, distance(reading, d));
  return {
    matched: best <= MATCH_THRESHOLD,
    distance: best,
    confidence: Number.isFinite(best)
      ? Math.max(0, Math.min(1, 1 - best / (MATCH_THRESHOLD * 2)))
      : 0,
  };
}

/* ------------------------------------------------------------- group */

export interface FaceBox {
  /** Fractions of the image, so they survive any rendered size. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GroupFace extends FaceReading {
  box: FaceBox;
}

/**
 * Every face in a photo, with where it sits.
 *
 * A larger input size than the single-face path uses: in a group shot the
 * faces are small, far away and often turned, and the default is tuned for
 * someone holding a phone at arm's length. It costs time on a big image
 * and finds people the smaller size walks straight past.
 *
 * Boxes come back as fractions rather than pixels, so the caller can draw
 * them over the photo at whatever size it ends up rendered.
 */
export async function readAllFaces(dataUrl: string): Promise<GroupFace[]> {
  const mod = await loadFaceEngine();
  if (!mod) return [];
  try {
    const img = await toImage(dataUrl);
    const found = await mod
      .detectAllFaces(img, new mod.TinyFaceDetectorOptions({ inputSize: 608 }))
      .withFaceLandmarks(true)
      .withFaceDescriptors();
    return found.map((f) => ({
      descriptor: Array.from(f.descriptor),
      score: f.detection.score,
      box: {
        x: f.detection.box.x / img.naturalWidth,
        y: f.detection.box.y / img.naturalHeight,
        w: f.detection.box.width / img.naturalWidth,
        h: f.detection.box.height / img.naturalHeight,
      },
    }));
  } catch {
    return [];
  }
}

/**
 * Distance beyond which a group-photo match is not offered at all.
 *
 * Tighter than MATCH_THRESHOLD on purpose. A check-in selfie is one known
 * person confirming themselves; a group photo is a guess about which of
 * forty people a small, angled face belongs to, and a wrong name presented
 * confidently is worse than no name — the supervisor would have to notice
 * the error to undo it, and the whole point is that they are moving fast.
 */
export const GROUP_MATCH_THRESHOLD = 0.52;
