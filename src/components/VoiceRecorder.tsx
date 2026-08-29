"use client";

/**
 * Checkout voice note — record, pause, resume, stop, replay, delete,
 * re-record, and dictate. The recording never leaves the device: it becomes
 * a data-URL the checkout attaches to the attendance record, and the
 * transcript is produced by the phone's own recogniser.
 *
 * Optional by design (spec §1): a worker with gloves on and a bus to catch
 * gets a working Check Out whether or not the microphone cooperates, so
 * every failure path degrades to "no voice note" rather than a blocked
 * checkout. The transcript degrades one step further — losing dictation
 * must not cost the audio.
 *
 * One hardware fact shapes this component. Android's speech recogniser and
 * the WebView's recorder are two separate microphone clients, and not every
 * phone will serve both. Where a phone refuses, the recorder is the one
 * that gets silence — so the signal level is watched while recording, and a
 * note that turns out to be silent is saved as a transcript rather than as
 * two minutes of nothing.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  SPEECH_LANGUAGES,
  languageLabel,
  readLanguage,
  serverLanguage,
  speechSource,
  startDictation,
  subscribeLanguage,
  writeLanguage,
  type DictationSession,
} from "@/lib/speech";
import { summariseTranscript } from "@/lib/transcript";
import { IMic, IPause, IPlay, ITrash } from "./WfIcons";

export interface RecordedNote {
  dataUrl: string;
  seconds: number;
  transcript?: string;
  transcriptLang?: string;
}

/** Hard ceiling so a forgotten recorder cannot fill the device. */
const MAX_SECONDS = 120;

/** Below this peak amplitude the recorder captured nothing audible. */
const SILENCE_PEAK = 3;

type Phase = "idle" | "recording" | "paused" | "done" | "denied" | "missing";
type Dictation = "off" | "listening" | "unavailable" | "denied";

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
  const lang = useSyncExternalStore(subscribeLanguage, readLanguage, serverLanguage);
  const [dictation, setDictation] = useState<Dictation>("off");
  const [live, setLive] = useState("");
  const [dictationNote, setDictationNote] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const secondsRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sessionRef = useRef<DictationSession | null>(null);
  const transcriptRef = useRef("");
  const peakRef = useRef(0);
  const meterRef = useRef<{ ctx: AudioContext; analyser: AnalyserNode } | null>(null);

  const canDictate = speechSource() !== "none";

  const stopTimer = () => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
  };

  /** Sample the input level so a silent recording can be recognised as one. */
  const sampleLevel = () => {
    const m = meterRef.current;
    if (!m) return;
    const buf = new Uint8Array(m.analyser.fftSize);
    m.analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
    peakRef.current = Math.max(peakRef.current, peak);
  };

  const startTimer = () => {
    stopTimer();
    timerRef.current = window.setInterval(() => {
      secondsRef.current += 1;
      setSeconds(secondsRef.current);
      sampleLevel();
      if (secondsRef.current >= MAX_SECONDS) recorderRef.current?.stop();
    }, 1000);
  };

  const teardownMeter = () => {
    meterRef.current?.ctx.close().catch(() => {});
    meterRef.current = null;
  };

  /* Release the microphone the moment this UI goes away. */
  useEffect(
    () => () => {
      stopTimer();
      teardownMeter();
      void sessionRef.current?.stop();
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") rec.stop();
      rec?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase("missing");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      /* Two very different problems, and only one of them is the worker's
         to fix — so they are not allowed to share a message. */
      const name = (err as DOMException | undefined)?.name;
      setPhase(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "missing");
      return;
    }

    try {
      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      chunksRef.current = [];
      secondsRef.current = 0;
      transcriptRef.current = "";
      peakRef.current = 0;
      setSeconds(0);
      setLive("");

      try {
        const Ctx =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctx) {
          const ctx = new Ctx();
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          ctx.createMediaStreamSource(stream).connect(analyser);
          meterRef.current = { ctx, analyser };
        }
      } catch {
        /* No meter. The note still records; it just can't self-diagnose. */
      }

      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stopTimer();
        sampleLevel();
        const silent = meterRef.current !== null && peakRef.current < SILENCE_PEAK;
        teardownMeter();
        stream.getTracks().forEach((t) => t.stop());

        const finish = (dataUrl: string) => {
          const transcript = transcriptRef.current.trim();
          if (!dataUrl && !transcript) {
            setPhase("idle");
            return;
          }
          onChange({
            dataUrl,
            seconds: secondsRef.current,
            transcript: transcript || undefined,
            transcriptLang: transcript ? readLanguage() : undefined,
          });
          setPhase("done");
        };

        /* The phone kept the microphone for the recogniser. Saving two
           minutes of silence would be worse than saving nothing. */
        if (silent && transcriptRef.current.trim()) {
          finish("");
          return;
        }

        const blob = new Blob(chunksRef.current, {
          type: rec.mimeType || "audio/webm",
        });
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = String(reader.result ?? "");
          finish(dataUrl.length > 64 ? dataUrl : "");
        };
        reader.readAsDataURL(blob);
      };

      rec.start();
      setPhase("recording");
      startTimer();
    } catch {
      // MediaRecorder refused the stream. Hand the microphone back rather
      // than leaving the indicator burning in the status bar.
      stream.getTracks().forEach((t) => t.stop());
      teardownMeter();
      setPhase("missing");
      return;
    }

    /* Dictation is started after the recorder, and its failure is never
       allowed to reach the recorder. */
    if (!canDictate) {
      setDictation("unavailable");
      return;
    }
    setDictation("listening");
    setDictationNote(null);
    sessionRef.current = await startDictation({
      language: readLanguage(),
      onText: (t) => {
        transcriptRef.current = t;
        setLive(t);
      },
      onFailure: (reason, detail) => {
        setDictation(reason === "denied" ? "denied" : "unavailable");
        setDictationNote(detail ?? null);
      },
    });
  }, [canDictate, onChange]);

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
  /**
   * Stop the recorder first, always.
   *
   * This used to await the dictation session before touching the recorder,
   * which made Stop dead on any phone where the recogniser hung — exactly
   * the phones where dictation was already failing. The recorder is the
   * artifact; nothing about the transcript is allowed to block it.
   */
  const stop = () => {
    recorderRef.current?.stop();
    const session = sessionRef.current;
    sessionRef.current = null;
    setDictation("off");
    if (!session) return;
    /* Its final words are worth waiting a moment for, but not forever. */
    void Promise.race([
      session.stop(),
      new Promise((r) => setTimeout(r, 1500)),
    ]).catch(() => {});
  };

  const discard = () => {
    audioRef.current?.pause();
    setPlaying(false);
    onChange(null);
    secondsRef.current = 0;
    transcriptRef.current = "";
    setSeconds(0);
    setLive("");
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

  if (phase === "denied" || phase === "missing") {
    return (
      <div className="wf-inset flex flex-col gap-2.5 px-3.5 py-3">
        <p className="text-[0.78rem] leading-snug text-[var(--wf-muted)]">
          {phase === "denied"
            ? "Workfence needs microphone access to record a voice note. Allow it when asked, or turn it on in Settings › Apps › Workfence › Permissions."
            : "No microphone is available on this device, so a voice note can't be recorded."}{" "}
          Checkout works without one.
        </p>
        {/* Denying the prompt used to end the feature until the app was
            restarted. It is one tap to ask again. */}
        <button
          className="wf-btn wf-btn-ghost wf-btn-sm self-start"
          onClick={() => void start()}
        >
          <IMic size={14} /> Try again
        </button>
      </div>
    );
  }

  if (phase === "done" && value) {
    return (
      <div className="flex flex-col gap-2">
        <div className="wf-card2 flex items-center gap-3 px-3.5 py-3">
          {value.dataUrl ? (
            <button
              className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full bg-[var(--wf-amber)] text-[var(--wf-on-amber)]"
              aria-label={playing ? "Pause playback" : "Play voice note"}
              onClick={togglePlay}
            >
              {playing ? <IPause size={18} /> : <IPlay size={18} />}
            </button>
          ) : (
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--wf-fill-2)] text-[var(--wf-faint)]">
              <IMic size={18} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[0.86rem] font-semibold">
              {value.dataUrl ? `Voice Note — ${clock}` : "Voice Note — transcript only"}
            </p>
            <p className="text-[0.7rem] text-[var(--wf-muted)]">
              {value.dataUrl
                ? "Attached to today's checkout"
                : "This phone wouldn't share the microphone, so the words were kept and the audio wasn't."}
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
          {value.dataUrl ? (
            <audio
              ref={audioRef}
              src={value.dataUrl}
              onEnded={() => setPlaying(false)}
              className="hidden"
            />
          ) : null}
        </div>

        {value.transcript ? (
          <TranscriptCard
            transcript={value.transcript}
            language={value.transcriptLang}
            defaultOpen
          />
        ) : dictation === "denied" || dictation === "unavailable" ? (
          <p className="px-1 text-[0.72rem] leading-snug text-[var(--wf-faint)]">
            {dictationFailureText(dictation, languageLabel(lang))}
            {dictationNote ? ` (${dictationNote})` : ""}
          </p>
        ) : null}
      </div>
    );
  }

  if (phase === "recording" || phase === "paused") {
    return (
      <div className="flex flex-col gap-2">
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
              {dictation === "listening"
                ? `Transcribing in ${languageLabel(lang)} · up to ${MAX_SECONDS / 60} minutes`
                : `Up to ${MAX_SECONDS / 60} minutes`}
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
          <button className="wf-btn wf-btn-primary wf-btn-sm" onClick={() => void stop()}>
            Stop
          </button>
        </div>

        {/* The words as they land. Seeing them appear is also how a worker
            knows the recogniser picked the right language. */}
        {dictation === "listening" ? (
          <div className="wf-inset px-3.5 py-3">
            <p className="text-[0.62rem] font-bold uppercase tracking-wider text-[var(--wf-faint)]">
              Transcript
            </p>
            <p className="mt-1 text-[0.82rem] leading-relaxed">
              {live || (
                <span className="text-[var(--wf-faint)]">Listening…</span>
              )}
            </p>
          </div>
        ) : dictation === "denied" || dictation === "unavailable" ? (
          /* It used to sit on "Listening…" forever when the recogniser was
             not working. Saying so, mid-recording, is the whole point. */
          <div className="wf-inset px-3.5 py-3">
            <p className="text-[0.78rem] leading-snug text-[var(--wf-muted)]">
              {dictationFailureText(dictation, languageLabel(lang))}
            </p>
            <p className="mt-1 text-[0.7rem] text-[var(--wf-faint)]">
              The recording itself is unaffected — keep talking.
            </p>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button className="wf-btn wf-btn-ghost w-full" onClick={() => void start()}>
        <IMic size={17} /> Record Voice Note
      </button>
      {canDictate ? (
        /* Deliberately not a <label> wrapping the <select>. Android's WebView
           re-dispatches the label's click into the control, so the picker
           opened and closed again in the same tap and read as dead. The
           select carries its own aria-label instead. */
        <div className="flex items-center gap-2.5 px-1">
          <span className="shrink-0 text-[0.74rem] text-[var(--wf-muted)]">
            Speaking in
          </span>
          <select
            className="wf-input flex-1"
            aria-label="Voice note language"
            value={lang}
            onChange={(e) => writeLanguage(e.target.value)}
          >
            {SPEECH_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}

/**
 * What to say when dictation fails.
 *
 * "Speech recognition is unavailable" tells a supervisor nothing they can
 * do. On Android the usual cause is that the phone has no offline language
 * pack for the chosen language and no signal to reach the online one, and
 * that is fixable — so the message says where to fix it.
 */
function dictationFailureText(state: "denied" | "unavailable", language: string): string {
  if (state === "denied") {
    return "Speech recognition is blocked for Workfence, so there's no transcript. Allow the microphone in Settings › Apps › Workfence › Permissions.";
  }
  return `This phone's speech recognition didn't respond in ${language}, so there's no transcript. Open the Google app › Settings › Voice › Offline speech recognition and download ${language}, or try another language here.`;
}

/**
 * The transcript and its summary.
 *
 * The summary leads, because it is what a manager reads; the words as
 * spoken sit underneath, one tap away, because it is what they check
 * against when the summary matters.
 */
export function TranscriptCard({
  transcript,
  language,
  defaultOpen,
}: {
  transcript: string;
  language?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const summary = summariseTranscript(transcript);

  return (
    <div className="wf-card2 flex flex-col gap-2.5 px-3.5 py-3">
      <div className="flex items-baseline gap-2">
        <p className="text-[0.62rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
          Summary
        </p>
        <span className="ml-auto text-[0.62rem] text-[var(--wf-faint)]">
          {summary.words} words{language ? ` · ${languageLabel(language)}` : ""}
        </span>
      </div>

      {summary.points.length > 0 ? (
        <dl className="flex flex-col gap-1.5">
          {summary.points.map((p) => (
            <div key={p.label} className="flex gap-2.5">
              <dt className="w-[5.5rem] shrink-0 text-[0.7rem] font-bold text-[var(--wf-muted)]">
                {p.label}
              </dt>
              <dd className="min-w-0 flex-1 text-[0.8rem] leading-relaxed">{p.text}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-[0.82rem] leading-relaxed">
          {summary.gist || "Nothing was recognised in this recording."}
        </p>
      )}

      {/* Extractive, so the summary is always the worker's own sentences —
          worth saying once, where someone might otherwise assume a model
          wrote it. */}
      {!summary.structured && summary.gist ? (
        <p className="text-[0.66rem] leading-snug text-[var(--wf-faint)]">
          Headings are only detected in English. This note is shown as its
          opening lines.
        </p>
      ) : null}

      <button
        className="wf-btn wf-btn-ghost wf-btn-sm self-start"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? "Hide full transcript" : "Show full transcript"}
      </button>
      {open ? (
        <p className="wf-inset px-3 py-2.5 text-[0.8rem] leading-relaxed text-[var(--wf-muted)]">
          {transcript}
        </p>
      ) : null}
    </div>
  );
}

/** Read-only playback for managers: listen without downloading (spec §1). */
export function VoiceNotePlayer({
  dataUrl,
  seconds,
  meta,
  transcript,
  transcriptLang,
}: {
  dataUrl: string;
  seconds: number;
  meta?: string;
  transcript?: string;
  transcriptLang?: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const clock = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <div className="flex flex-col gap-2">
      <div className="wf-card2 flex items-center gap-3 px-3.5 py-3">
        {dataUrl ? (
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
        ) : (
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--wf-fill-2)] text-[var(--wf-faint)]">
            <IMic size={18} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[0.86rem] font-semibold">
            {dataUrl ? `Checkout Voice Note — ${clock}` : "Checkout Voice Note — transcript only"}
          </p>
          {meta ? (
            <p className="truncate text-[0.7rem] text-[var(--wf-muted)]">{meta}</p>
          ) : null}
        </div>
        {dataUrl ? (
          <audio
            ref={audioRef}
            src={dataUrl}
            onEnded={() => setPlaying(false)}
            className="hidden"
          />
        ) : null}
      </div>
      {transcript ? (
        <TranscriptCard transcript={transcript} language={transcriptLang} />
      ) : null}
    </div>
  );
}
