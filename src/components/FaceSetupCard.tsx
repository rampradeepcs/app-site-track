"use client";

/**
 * Face setup, offered to an employee who has not done it yet.
 *
 * It sits on their home screen rather than blocking the app, and it can be
 * put off. Someone standing at a gate at the start of a shift needs to
 * check in; a setup step that stops them is a setup step that gets them
 * shouted at, and they will do it once rather than well.
 *
 * The card only appears where it can actually finish: an employee with app
 * access, no enrolment yet, on a phone that can run the model. On anything
 * else it renders nothing at all — there is no value in advertising a
 * feature the device cannot perform, and a permanent "unsupported" notice
 * on the home screen is worse than silence.
 */

import { useEffect, useState } from "react";
import { useWorkforce } from "@/lib/store";
import { likelySupported } from "@/lib/face/engine";
import { FaceEnroll } from "./FaceEnroll";
import { BottomSheet } from "./ui";
import { ICheckCircle, IShield } from "./WfIcons";
import { biometricAvailability } from "@/lib/biometric";

/**
 * "Later", remembered against the person who said it.
 *
 * This used to be one key for the whole device, which is wrong on the phones
 * this app is used on. A site phone is shared, and personas are switched on it
 * all day: one worker tapping Later silenced the prompt for everybody who
 * picked the handset up after them, for a week. It is a decision about a
 * person's own face, so it belongs to that person.
 *
 * The old unscoped key is deliberately not migrated. It cannot be attributed to
 * anybody now, and the cost of getting it wrong in each direction is uneven —
 * carrying it over to the wrong person hides a prompt they never dismissed,
 * while dropping it shows the current holder one card they can dismiss again in
 * a second.
 */
const DEFER_PREFIX = "workfence.face-setup.deferred";

function deferKey(userId: string): string {
  return `${DEFER_PREFIX}.${userId}`;
}

/**
 * How long "Later" lasts.
 *
 * It used to last for ever: the key was set to "1" and nothing anywhere
 * cleared it, so one tap at a gate on a busy morning meant the card was
 * never offered again on that phone. Every worker who had ever put it off
 * was permanently without an enrolment and there was no way back.
 *
 * A week is long enough that nobody is nagged and short enough that a
 * deferral is a deferral rather than a refusal. Somebody who genuinely does
 * not want it taps Later again, which costs them a second.
 */
const DEFER_DAYS = 7;

/**
 * Whether the card is being held back right now.
 *
 * The old permanent value is read as a deferral that has already run out,
 * so everybody carrying one is offered the enrolment again the next time
 * they open the app — which is the whole point of changing this.
 */
function deferredUntil(userId: string): number {
  try {
    const raw = localStorage.getItem(deferKey(userId));
    if (!raw) return 0;
    if (raw === "1") return 0; // the old for-ever value: expired by definition
    const at = Number(raw);
    return Number.isFinite(at) ? at + DEFER_DAYS * 86_400_000 : 0;
  } catch {
    return 0;
  }
}

export function FaceSetupCard() {
  const { currentUser, enrollFace } = useWorkforce();
  const [open, setOpen] = useState(false);
  const [deferred, setDeferred] = useState(true);
  const [capable, setCapable] = useState(false);
  const [deviceDoesIt, setDeviceDoesIt] = useState(false);

  // All three reads touch the browser or the device, so they wait for the client.
  const uid = currentUser?.id ?? "";
  useEffect(() => {
    if (!uid) return;
    setCapable(likelySupported());
    setDeferred(Date.now() < deferredUntil(uid));
    void biometricAvailability().then((b) => setDeviceDoesIt(b.available));
  }, [uid]);

  if (!currentUser || currentUser.role !== "employee") return null;
  if (currentUser.face?.descriptors?.length) return null;
  /*
   * The phone already does this, so we do not ask them to do it again.
   *
   * Check-in runs the device prompt first and only falls back to matching
   * against these photos when the device could not answer — see
   * employee/page.tsx, where the comparison is guarded on
   * `deviceAuth !== "ok"`. On a handset with Face ID or a fingerprint
   * enrolled, three photos taken here are never read. Asking for them is
   * asking somebody to do work that will not be used, and every one of them
   * is a face stored on a device that did not need to hold one.
   */
  if (deviceDoesIt) return null;
  if (!capable || deferred) return null;

  return (
    <>
      <div className="wf-card flex items-start gap-3 p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--wf-fill-2)] text-[var(--wf-green)]">
          <IShield size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Set up Face ID</p>
          <p className="mt-0.5 text-[0.78rem] leading-relaxed text-[var(--wf-muted)]">
            Three photos, once. Your check-in selfie is then matched against
            them on this phone — nothing is uploaded.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="wf-btn wf-btn-primary wf-btn-sm"
              onClick={() => setOpen(true)}
            >
              Set up now
            </button>
            <button
              className="wf-btn wf-btn-ghost wf-btn-sm"
              onClick={() => {
                try {
                  // When, not whether. The reader turns this into an expiry.
                  localStorage.setItem(deferKey(currentUser.id), String(Date.now()));
                } catch {
                  /* it simply reappears next launch */
                }
                setDeferred(true);
              }}
            >
              Later
            </button>
          </div>
        </div>
      </div>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Set up Face ID"
        tall
      >
        {open ? (
          <FaceEnroll
            personName={currentUser.name}
            onCancel={() => setOpen(false)}
            onDone={(descriptors) => {
              enrollFace(currentUser.id, descriptors);
              setOpen(false);
            }}
          />
        ) : null}
      </BottomSheet>
    </>
  );
}

/** The enrolled state, for a profile or settings screen. */
export function FaceEnrolledRow() {
  const { currentUser, enrollFace } = useWorkforce();
  const [open, setOpen] = useState(false);
  const [deviceDoesIt, setDeviceDoesIt] = useState(false);
  // Above the early return: a hook cannot be conditional.
  useEffect(() => {
    void biometricAvailability().then((b) => setDeviceDoesIt(b.available));
  }, []);
  if (!currentUser) return null;
  const enrolled = currentUser.face?.descriptors?.length ?? 0;

  return (
    <>
      <div className="wf-card flex items-center gap-3 p-4">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--wf-fill-2)]"
          style={{ color: enrolled ? "var(--wf-green)" : "var(--wf-faint)" }}
        >
          {enrolled ? <ICheckCircle size={18} /> : <IShield size={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Face ID</p>
          <p className="mt-0.5 text-[0.76rem] text-[var(--wf-muted)]">
            {enrolled
              ? `Enrolled from ${enrolled} photos, on this phone only.`
              : deviceDoesIt
                ? "This phone's own Face ID or fingerprint confirms your check-in. Nothing to set up."
                : "Not set up. Check-ins record a selfie without matching it."}
          </p>
        </div>
        {enrolled ? (
          <button
            className="wf-btn wf-btn-ghost wf-btn-sm wf-btn-danger-text shrink-0"
            onClick={() => enrollFace(currentUser.id, [])}
          >
            Remove
          </button>
        ) : deviceDoesIt ? null : (
          <button
            className="wf-btn wf-btn-ghost wf-btn-sm shrink-0"
            onClick={() => setOpen(true)}
          >
            Set up
          </button>
        )}
      </div>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Set up Face ID"
        tall
      >
        {open ? (
          <FaceEnroll
            personName={currentUser.name}
            onCancel={() => setOpen(false)}
            onDone={(descriptors) => {
              enrollFace(currentUser.id, descriptors);
              setOpen(false);
            }}
          />
        ) : null}
      </BottomSheet>
    </>
  );
}
