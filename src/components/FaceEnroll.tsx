"use client";

/**
 * Enrol a face, so a later check-in can be verified against it.
 *
 * Three samples rather than one. A face at a site gate is lit differently
 * every hour and half of it may be under a helmet; one perfect frame
 * enrols a version of the person that rarely turns up again. The samples
 * are taken a moment apart and each is checked before it counts, so the
 * enrolment is three usable readings rather than three attempts.
 *
 * Nothing is uploaded. The photograph is discarded once the descriptor is
 * computed — what is kept is 128 numbers that can be compared to another
 * face and cannot be turned back into one.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  likelySupported,
  loadFaceEngine,
  readFace,
  type FaceDescriptor,
} from "@/lib/face/engine";
import { ICamera, ICheck, IRefresh, IX } from "./WfIcons";

const SAMPLES = 3;
/** Below this the detector is not confident it is looking at a face. */
const MIN_SCORE = 0.5;

type Phase = "checking" | "unsupported" | "loading" | "starting" | "denied" | "live" | "done";

export function FaceEnroll({
  personName,
  onDone,
  onCancel,
}: {
  personName: string;
  onDone: (descriptors: FaceDescriptor[]) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>("checking");
  const [samples, setSamples] = useState<FaceDescriptor[]>([]);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("");

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => stop(), [stop]);

  // Capability first, then the 6MB of weights, then the camera. A phone
  // that cannot run the model never downloads it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!likelySupported()) {
        if (!cancelled) setPhase("unsupported");
        return;
      }
      setPhase("loading");
      const engine = await loadFaceEngine();
      if (cancelled) return;
      if (!engine) {
        setPhase("unsupported");
        return;
      }
      setPhase("starting");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setPhase("live");
      } catch {
        if (!cancelled) setPhase("denied");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const frame = (): string | null => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.9);
  };

  const capture = async () => {
    if (busy) return;
    setBusy(true);
    setHint("");
    const shot = frame();
    if (!shot) {
      setHint("Camera is not ready yet.");
      setBusy(false);
      return;
    }
    const reading = await readFace(shot);
    // Say which of the two things went wrong: no face at all reads very
    // differently to a face the detector is unsure about.
    if (!reading) {
      setHint("No face found — hold the phone at arm's length, facing you.");
      setBusy(false);
      return;
    }
    if (reading.score < MIN_SCORE) {
      setHint("Too unclear. More light, and take off anything covering the face.");
      setBusy(false);
      return;
    }
    const next = [...samples, reading.descriptor];
    setSamples(next);
    setBusy(false);
    if (next.length >= SAMPLES) {
      stop();
      setPhase("done");
      onDone(next);
    } else {
      setHint(`Captured ${next.length} of ${SAMPLES}. Change angle slightly.`);
    }
  };

  if (phase === "unsupported") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-[0.9rem] leading-relaxed">
          This phone cannot run face verification.
        </p>
        <p className="text-[0.8rem] leading-relaxed text-[var(--wf-muted)]">
          {personName} can still be added and can still check in — the check-in
          selfie is recorded as it always was, just without an automatic
          comparison.
        </p>
        <button className="wf-btn wf-btn-ghost" onClick={onCancel}>
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative overflow-hidden rounded-2xl bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          className="aspect-[3/4] w-full object-cover"
          style={{ transform: "scaleX(-1)" }}
        />
        {phase !== "live" ? (
          <div className="absolute inset-0 grid place-items-center bg-[var(--wf-scrim)] px-6 text-center text-[0.84rem] text-[var(--wf-fg)]">
            {phase === "checking" || phase === "loading"
              ? "Preparing face verification…"
              : phase === "starting"
                ? "Starting the camera…"
                : phase === "denied"
                  ? "Camera permission is needed to enrol a face."
                  : "Done."}
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-center gap-2">
        {Array.from({ length: SAMPLES }, (_, i) => (
          <span
            key={i}
            className="h-1.5 w-8 rounded-full transition"
            style={{
              background:
                i < samples.length ? "var(--wf-green)" : "var(--wf-line-strong)",
            }}
          />
        ))}
      </div>

      <p className="min-h-[2.4em] text-center text-[0.82rem] leading-relaxed text-[var(--wf-muted)]">
        {hint ||
          `Look straight at the camera. ${SAMPLES} photos, a moment apart.`}
      </p>

      <button
        className="wf-btn wf-btn-primary wf-btn-lg"
        disabled={phase !== "live" || busy}
        onClick={capture}
      >
        {busy ? (
          <>
            <IRefresh size={16} /> Checking…
          </>
        ) : (
          <>
            <ICamera size={17} /> Capture {samples.length + 1} of {SAMPLES}
          </>
        )}
      </button>

      {samples.length > 0 ? (
        <button
          className="wf-btn wf-btn-ghost"
          onClick={() => {
            setSamples([]);
            setHint("");
          }}
        >
          <IRefresh size={15} /> Start again
        </button>
      ) : null}

      <button className="wf-btn wf-btn-ghost wf-btn-danger-text" onClick={onCancel}>
        <IX size={15} /> Cancel
      </button>
    </div>
  );
}
