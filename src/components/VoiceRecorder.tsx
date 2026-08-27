"use client";

/**
 * Checkout voice note — record, pause, resume, stop, replay, delete,
 * re-record. The recording never leaves the device here: it becomes a
 * data-URL the checkout attaches to the attendance record.
 *
 * Optional by design (spec §1): a worker with gloves on and a bus to catch
 * gets a working Check Out whether or not the microphone cooperates, so
 * every failure path degrades to "no voice note" rather than a blocked
 * checkout.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { IMic, IPause, IPlay, ITrash } from "./WfIcons";

export interface RecordedNote {
  dataUrl: string;
  seconds: number;
}

/** Hard ceiling so a forgotten recorder cannot fill the device. */
const MAX_SECONDS = 120;

type Phase = "idle" | "recording" | "paused" | "done" | "unavailable";

export function VoiceRecorder({
  value,
  onChange,
}: {
  value: RecordedNote | null;
  onChange: (v: RecordedNote | null) => void;
}) {
  const [phase, setPhase] = useState<Phase>(value ? "done" : "idle");
  const [seconds, setSeconds] = useState(value?.seconds ?? 0);
  const [playing, setPlaying] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const secondsRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stopTimer = () => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
  };
  const startTimer = () => {
    stopTimer();
    timerRef.current = window.setInterval(() => {
      secondsRef.current += 1;
      setSeconds(secondsRef.current);
      if (secondsRef.current >= MAX_SECONDS) recorderRef.current?.stop();
    }, 1000);
  };

  /* Release the microphone the moment this UI goes away. */
  useEffect(
    () => () => {
      stopTimer();
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") rec.stop();
      rec?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      chunksRef.current = [];
      secondsRef.current = 0;
      setSeconds(0);
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stopTimer();
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, {
          type: rec.mimeType || "audio/webm",
        });
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = String(reader.result ?? "");
          if (dataUrl.length > 64) {
            onChange({ dataUrl, seconds: secondsRef.current });
            setPhase("done");
          } else {
            setPhase("idle");
          }
        };
        reader.readAsDataURL(blob);
      };
      rec.start();
      setPhase("recording");
      startTimer();
    } catch {
      // No microphone, or permission declined — checkout continues without.
      setPhase("unavailable");
    }
  }, [onChange]);

  const pause = () => {
    recorderRef.current?.pause();
    stopTimer();
    setPhase("paused");
  };
  const resume = () => {
    recorderRef.current?.resume();
    startTimer();
    setPhase("recording");
  };
  const stop = () => recorderRef.current?.stop();

  const discard = () => {
    audioRef.current?.pause();
    setPlaying(false);
    onChange(null);
    secondsRef.current = 0;
    setSeconds(0);
    setPhase("idle");
  };

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      void el.play();
      setPlaying(true);
    }
  };

  const clock = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  if (phase === "unavailable") {
    return (
      <p className="wf-inset px-3.5 py-3 text-[0.78rem] leading-snug text-[var(--wf-muted)]">
        The microphone isn&apos;t available on this device, so a voice note
        can&apos;t be recorded — checkout works without one.
      </p>
    );
  }

  if (phase === "done" && value) {
    return (
      <div className="wf-card2 flex items-center gap-3 px-3.5 py-3">
        <button
          className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full bg-[var(--wf-amber)] text-[var(--wf-on-amber)]"
          aria-label={playing ? "Pause playback" : "Play voice note"}
          onClick={togglePlay}
        >
          {playing ? <IPause size={18} /> : <IPlay size={18} />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[0.86rem] font-semibold">Voice Note — {clock}</p>
          <p className="text-[0.7rem] text-[var(--wf-muted)]">
            Attached to today&apos;s checkout
          </p>
        </div>
        <button
          className="cursor-pointer p-2 text-[var(--wf-faint)] hover:text-[var(--wf-red)]"
          aria-label="Delete voice note"
          onClick={discard}
        >
          <ITrash size={16} />
        </button>
        <button
          className="wf-btn wf-btn-ghost wf-btn-sm"
          onClick={() => {
            discard();
            void start();
          }}
        >
          Re-record
        </button>
        <audio
          ref={audioRef}
          src={value.dataUrl}
          onEnded={() => setPlaying(false)}
          className="hidden"
        />
      </div>
    );
  }

  if (phase === "recording" || phase === "paused") {
    return (
      <div className="wf-card2 flex items-center gap-3 px-3.5 py-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--wf-red-soft)] text-[var(--wf-red)]">
          <span
            className={`h-3 w-3 rounded-full bg-current ${phase === "recording" ? "wf-blink" : ""}`}
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.86rem] font-semibold tabular-nums">
            {phase === "recording" ? "Recording" : "Paused"} — {clock}
          </p>
          <p className="text-[0.7rem] text-[var(--wf-muted)]">
            Up to {MAX_SECONDS / 60} minutes
          </p>
        </div>
        {phase === "recording" ? (
          <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={pause}>
            <IPause size={14} /> Pause
          </button>
        ) : (
          <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={resume}>
            <IPlay size={14} /> Resume
          </button>
        )}
        <button className="wf-btn wf-btn-primary wf-btn-sm" onClick={stop}>
          Stop
        </button>
      </div>
    );
  }

  return (
    <button className="wf-btn wf-btn-ghost w-full" onClick={() => void start()}>
      <IMic size={17} /> Record Voice Note
    </button>
  );
}

/** Read-only playback for managers: listen without downloading (spec §1). */
export function VoiceNotePlayer({
  dataUrl,
  seconds,
  meta,
}: {
  dataUrl: string;
  seconds: number;
  meta?: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const clock = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <div className="wf-card2 flex items-center gap-3 px-3.5 py-3">
      <button
        className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full bg-[var(--wf-amber)] text-[var(--wf-on-amber)]"
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        onClick={() => {
          const el = audioRef.current;
          if (!el) return;
          if (playing) {
            el.pause();
            setPlaying(false);
          } else {
            void el.play();
            setPlaying(true);
          }
        }}
      >
        {playing ? <IPause size={18} /> : <IPlay size={18} />}
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-[0.86rem] font-semibold">Checkout Voice Note — {clock}</p>
        {meta ? (
          <p className="truncate text-[0.7rem] text-[var(--wf-muted)]">{meta}</p>
        ) : null}
      </div>
      <audio
        ref={audioRef}
        src={dataUrl}
        onEnded={() => setPlaying(false)}
        className="hidden"
      />
    </div>
  );
}
