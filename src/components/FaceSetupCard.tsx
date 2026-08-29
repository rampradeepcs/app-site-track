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

const DEFER_KEY = "workfence.face-setup.deferred";

export function FaceSetupCard() {
  const { currentUser, enrollFace } = useWorkforce();
  const [open, setOpen] = useState(false);
  const [deferred, setDeferred] = useState(true);
  const [capable, setCapable] = useState(false);

  // Both reads touch the browser, so they wait for the client.
  useEffect(() => {
    setCapable(likelySupported());
    try {
      setDeferred(localStorage.getItem(DEFER_KEY) === "1");
    } catch {
      setDeferred(false);
    }
  }, []);

  if (!currentUser || currentUser.role !== "employee") return null;
  if (currentUser.face?.descriptors?.length) return null;
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
                  localStorage.setItem(DEFER_KEY, "1");
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
        ) : (
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
