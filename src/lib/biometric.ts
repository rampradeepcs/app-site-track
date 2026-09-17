"use client";

/**
 * The phone's own face or fingerprint.
 *
 * Two different questions get confused with each other, so they are named
 * here once. The device biometric asks *is this phone in the right hands* —
 * instant, and a phone passed to a mate fails it before a camera opens. The
 * face engine in `lib/face` asks *is the face at this boundary the enrolled
 * worker's* — slower, and it leaves a photograph and a distance behind that
 * somebody can look at a month later.
 *
 * The first never replaces the second. A biometric returns a yes or a no and
 * records nothing, and an attendance mark that says only "the phone agreed"
 * is not evidence of anybody having been anywhere.
 *
 * On the web, and on a device with nothing enrolled, every call here reports
 * unavailable and the caller carries on. A worker must never be held at a
 * door their phone cannot open.
 */

import { registerPlugin } from "@capacitor/core";

export type BiometricOutcome =
  /** The person proved they hold the phone. */
  | "ok"
  /** They were asked and said no. Worth letting them try again. */
  | "cancelled"
  /** The sensor tried and could not. Not the person's fault. */
  | "failed"
  /** No sensor, nothing enrolled, or not a native platform at all. */
  | "unavailable";

export interface BiometricAvailability {
  available: boolean;
  /** True when the device will show a face rather than a fingerprint. */
  face: boolean;
  reason: string;
}

interface BiometricPlugin {
  isAvailable(): Promise<BiometricAvailability>;
  verify(options: { title?: string; subtitle?: string }): Promise<{
    ok: boolean;
    outcome: BiometricOutcome;
  }>;
}

/*
 * `registerPlugin` never throws: on a platform with no implementation it
 * hands back a proxy whose calls reject. That is the right shape — ask once,
 * cache the answer, stop asking.
 */
const Biometric = registerPlugin<BiometricPlugin>("Biometric");

const UNAVAILABLE: BiometricAvailability = {
  available: false,
  face: false,
  reason: "not a device",
};

function isNative(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor;
  return typeof cap?.isNativePlatform === "function" ? cap.isNativePlatform() : false;
}

/*
 * Asked on a screen that renders before a tap and again at the tap itself,
 * so the answer is kept. It only changes when somebody enrols a face in
 * system settings, which they cannot do without leaving the app — and
 * `refresh` covers the return.
 */
let cached: BiometricAvailability | null = null;

export async function biometricAvailability(
  refresh = false,
): Promise<BiometricAvailability> {
  if (!isNative()) return UNAVAILABLE;
  if (cached && !refresh) return cached;
  try {
    const r = await Biometric.isAvailable();
    cached = {
      available: !!r?.available,
      face: !!r?.face,
      reason: r?.reason ?? "unavailable",
    };
  } catch {
    cached = UNAVAILABLE;
  }
  return cached;
}

/**
 * Ask the person to prove they are holding their own phone.
 *
 * Returns the outcome rather than a boolean, because the caller has to tell
 * a refusal from a sensor that could not read. Somebody who cancelled can be
 * asked again; somebody whose phone has no working sensor has to be let
 * through, or the app has invented a way to stop them working.
 */
export async function biometricVerify(options?: {
  title?: string;
  subtitle?: string;
}): Promise<BiometricOutcome> {
  const { available } = await biometricAvailability();
  if (!available) return "unavailable";
  try {
    const r = await Biometric.verify({
      title: options?.title ?? "Confirm it's you",
      subtitle: options?.subtitle ?? "",
    });
    if (r?.ok) return "ok";
    return r?.outcome ?? "failed";
  } catch {
    // A plugin that rejects is a device that cannot answer, which is the
    // same thing as not having one for every decision above this.
    return "unavailable";
  }
}

/** What to call it on screen, so the words match the sheet the phone shows. */
export function biometricWord(a: BiometricAvailability): string {
  return a.face ? "Face ID" : "fingerprint";
}
