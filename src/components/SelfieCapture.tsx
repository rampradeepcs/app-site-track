"use client";

/**
 * Selfie capture for check-in/checkout. Uses the front camera when the user
 * grants permission; falls back to a generated placeholder so the demo flow
 * never dead-ends on a denied permission.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkforce } from "@/lib/store";
import { makeSelfie } from "@/lib/seed";
import { fmtTime } from "@/lib/format";
import { ICamera, ICheck, IRefresh, IX } from "./WfIcons";

export function SelfieCapture({
  label,
  onCapture,
  onCancel,
}: {
  label: string;
  onCapture: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const { currentUser, setPermission } = useWorkforce();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<"starting" | "live" | "denied" | "shot">(
    "starting",
  );
  const [shot, setShot] = useState<string | null>(null);
  const [openedAt] = useState(() => Date.now());

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
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
        setPermission("camera", "granted");
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setPhase("live");
      } catch {
        if (!cancelled) {
          setPermission("camera", "denied");
          setPhase("denied");
        }
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const capture = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const size = 320;
    const canvas = document.createElement("canvas");
    const ratio = video.videoWidth / video.videoHeight;
    canvas.width = size;
    canvas.height = Math.round(size / ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Mirror to match the on-screen preview.
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setShot(canvas.toDataURL("image/jpeg", 0.72));
    setPhase("shot");
    stop();
  };

  const usePlaceholder = () => {
    const url = makeSelfie(
      currentUser?.name ?? "Worker",
      currentUser?.avatarHue ?? 200,
      label,
    );
    onCapture(url);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="relative mx-auto aspect-[3/4] w-full max-w-[290px] overflow-hidden rounded-3xl border-2 border-[var(--wf-line-strong)] bg-black">
        {phase === "shot" && shot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shot} alt="Captured selfie preview" className="h-full w-full object-cover" />
        ) : phase === "denied" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <ICamera size={36} className="text-[var(--wf-faint)]" />
            <p className="text-sm font-semibold">Camera unavailable</p>
            <p className="text-xs text-[var(--wf-muted)]">
              Permission was denied or no camera was found. You can continue
              with a placeholder photo for this demo.
            </p>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              className="h-full w-full -scale-x-100 object-cover"
            />
            {phase === "starting" && (
              <div className="absolute inset-0 grid place-items-center">
                <div className="h-9 w-9 animate-spin rounded-full border-2 border-white/20 border-t-[var(--wf-amber)]" />
              </div>
            )}
            {/* face guide */}
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="h-[62%] w-[68%] rounded-[46%] border-2 border-dashed border-white/35" />
            </div>
          </>
        )}
        <span className="absolute left-3 top-3 rounded-full bg-black/65 px-2.5 py-1 text-[0.68rem] font-bold uppercase tracking-wider text-white">
          {label}
        </span>
        <span className="absolute right-3 top-3 rounded-full bg-black/65 px-2.5 py-1 text-[0.68rem] font-semibold tabular-nums text-white">
          {fmtTime(openedAt)}
        </span>
      </div>

      <div className="flex items-center justify-center gap-3">
        {phase === "shot" && shot ? (
          <>
            <button
              className="wf-btn wf-btn-ghost"
              onClick={() => {
                setShot(null);
                setPhase("starting");
                // restart the stream
                navigator.mediaDevices
                  .getUserMedia({ video: { facingMode: "user" }, audio: false })
                  .then((stream) => {
                    streamRef.current = stream;
                    if (videoRef.current) {
                      videoRef.current.srcObject = stream;
                      videoRef.current.play().catch(() => {});
                    }
                    setPhase("live");
                  })
                  .catch(() => setPhase("denied"));
              }}
            >
              <IRefresh size={17} /> Retake
            </button>
            <button className="wf-btn wf-btn-success" onClick={() => onCapture(shot)}>
              <ICheck size={17} /> Use photo
            </button>
          </>
        ) : phase === "denied" ? (
          <>
            <button className="wf-btn wf-btn-ghost" onClick={onCancel}>
              <IX size={16} /> Cancel
            </button>
            <button className="wf-btn wf-btn-primary" onClick={usePlaceholder}>
              Continue with placeholder
            </button>
          </>
        ) : (
          <>
            <button className="wf-btn wf-btn-ghost" onClick={onCancel}>
              <IX size={16} /> Cancel
            </button>
            <button
              className="wf-btn wf-btn-primary wf-btn-lg px-8"
              onClick={capture}
              disabled={phase !== "live"}
            >
              <ICamera size={19} /> Capture
            </button>
          </>
        )}
      </div>
    </div>
  );
}
