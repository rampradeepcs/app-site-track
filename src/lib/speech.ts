/**
 * Dictation for checkout voice notes.
 *
 * Two backends behind one interface: Android's own recogniser through the
 * Capacitor bridge on a device, and the Web Speech API in a desktop browser
 * so the web demo is not a dead button. Both are on-device on the platforms
 * that matter, which is the point — a voice note recorded at a site gate
 * with no signal still comes back as text.
 *
 * The awkward part is that Android's SpeechRecognizer is built for short
 * commands, not for a worker describing their day. It ends the session at
 * every pause for breath. So a transcript here is stitched: each recognised
 * utterance is committed as a segment, and recognition is restarted until
 * the recorder is stopped.
 */

export type SpeechSource = "native" | "web" | "none";

export interface SpeechLanguage {
  code: string;
  label: string;
}

/**
 * Android names recognisers by BCP-47 locale and will only listen in one at
 * a time — there is no "detect the language" mode, and no mid-sentence
 * switching. A crew that mixes English and Tamil in one breath will get the
 * chosen language transcribed and the rest approximated, which is why the
 * picker sits next to the record button rather than buried in settings.
 */
export const SPEECH_LANGUAGES: SpeechLanguage[] = [
  { code: "en-IN", label: "English" },
  { code: "ta-IN", label: "தமிழ்" },
  { code: "hi-IN", label: "हिन्दी" },
  { code: "te-IN", label: "తెలుగు" },
  { code: "ml-IN", label: "മലയാളം" },
  { code: "kn-IN", label: "ಕನ್ನಡ" },
];

export const DEFAULT_SPEECH_LANGUAGE = "en-IN";

/* ------------------------------------------------- remembered language -- */

/**
 * The chosen language is an external store rather than component state.
 * localStorage cannot be read while rendering on the server, and mirroring
 * it into state from an effect costs a second render of the checkout screen
 * — the one screen a worker is standing in the rain to finish. Same reason
 * components/Brand.tsx subscribes to prefers-reduced-motion this way.
 */
const LANG_KEY = "workfence.voice-language";
const langListeners = new Set<() => void>();
let langCache: string | null = null;

export function subscribeLanguage(fn: () => void): () => void {
  langListeners.add(fn);
  return () => {
    langListeners.delete(fn);
  };
}

/** Stable across calls, which useSyncExternalStore requires. */
export function readLanguage(): string {
  if (langCache === null) {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(LANG_KEY);
    } catch {
      /* private mode */
    }
    langCache =
      saved && SPEECH_LANGUAGES.some((l) => l.code === saved)
        ? saved
        : DEFAULT_SPEECH_LANGUAGE;
  }
  return langCache;
}

export function serverLanguage(): string {
  return DEFAULT_SPEECH_LANGUAGE;
}

export function writeLanguage(code: string): void {
  langCache = code;
  try {
    localStorage.setItem(LANG_KEY, code);
  } catch {
    /* private mode */
  }
  for (const fn of langListeners) fn();
}

export function languageLabel(code: string | undefined): string {
  return SPEECH_LANGUAGES.find((l) => l.code === code)?.label ?? code ?? "";
}

/* --------------------------------------------------------------- native -- */

interface ListenerHandle {
  remove: () => Promise<void>;
}

interface NativeSpeech {
  available?: () => Promise<{ available: boolean }>;
  start?: (o: Record<string, unknown>) => Promise<unknown>;
  stop?: () => Promise<void>;
  checkPermissions?: () => Promise<{ speechRecognition: string }>;
  requestPermissions?: () => Promise<{ speechRecognition: string }>;
  addListener?: (
    event: string,
    fn: (data: { matches?: string[]; status?: string }) => void,
  ) => Promise<ListenerHandle>;
  removeAllListeners?: () => Promise<void>;
}

/**
 * Read off the injected bridge rather than importing the plugin, matching
 * how this app reaches every other native plugin — see lib/contacts.ts for
 * why `Capacitor.isPluginAvailable` is not the check to use here.
 */
function nativeSpeech(): NativeSpeech | null {
  if (typeof window === "undefined") return null;
  const cap = (
    window as unknown as { Capacitor?: { Plugins?: { SpeechRecognition?: NativeSpeech } } }
  ).Capacitor;
  const p = cap?.Plugins?.SpeechRecognition;
  return typeof p?.start === "function" ? p : null;
}

/* ------------------------------------------------------------------ web -- */

interface WebRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionLikeEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

interface SpeechRecognitionLikeEvent {
  resultIndex: number;
  results: ArrayLike<
    ArrayLike<{ transcript: string }> & { isFinal: boolean }
  >;
}

function webRecognition(): (new () => WebRecognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => WebRecognition;
    webkitSpeechRecognition?: new () => WebRecognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/* ------------------------------------------------------------- public -- */

export function speechSource(): SpeechSource {
  if (nativeSpeech()) return "native";
  if (webRecognition()) return "web";
  return "none";
}

export type SpeechFailure = "denied" | "unsupported" | "error";

export interface DictationOptions {
  language: string;
  /** Everything recognised so far — committed segments plus the live one. */
  onText: (text: string) => void;
  /** `detail` is the recogniser's own words, for the message shown. */
  onFailure: (reason: SpeechFailure, detail?: string) => void;
}

export interface DictationSession {
  stop: () => Promise<void>;
}

/** Errors that just mean "they stopped talking"; the session continues. */
const BENIGN = /no match|speech timeout|didn.t understand|no speech/i;

/**
 * Android reports "nobody spoke" and "this service is broken" with the same
 * error code, and the only thing that tells them apart is the clock: a real
 * silence takes seconds to time out, while a broken service rejects in
 * milliseconds. Anything faster than this was not listening.
 */
const TOO_FAST_MS = 900;

/** Consecutive instant failures before the recogniser is declared unusable. */
const MAX_INSTANT_FAILURES = 3;

/** Nothing recognised in this long, from the top, and dictation gives up. */
const WATCHDOG_MS = 15_000;

export async function startDictation(
  opts: DictationOptions,
): Promise<DictationSession | null> {
  const native = nativeSpeech();
  if (native) return startNative(native, opts);
  const Web = webRecognition();
  if (Web) return startWeb(Web, opts);
  opts.onFailure("unsupported");
  return null;
}

async function startNative(
  plugin: NativeSpeech,
  { language, onText, onFailure }: DictationOptions,
): Promise<DictationSession | null> {
  try {
    const perm = await plugin.requestPermissions?.();
    if (perm && perm.speechRecognition !== "granted") {
      onFailure("denied");
      return null;
    }
    const avail = await plugin.available?.();
    if (avail && !avail.available) {
      onFailure("unsupported");
      return null;
    }
  } catch {
    onFailure("error");
    return null;
  }

  const segments: string[] = [];
  let current = "";
  let active = true;
  let restart: number | null = null;
  let watchdog: number | null = null;
  const handles: ListenerHandle[] = [];

  const emit = () => onText([...segments, current].join(" ").replace(/\s+/g, " ").trim());

  /* onEndOfSpeech arrives before the final onResults, so a pause commits
     after a short grace period rather than immediately — otherwise the last
     few words of every sentence are dropped on the floor. */
  const commit = () => {
    if (current.trim()) segments.push(current.trim());
    current = "";
  };

  let heard = false;
  let instantFailures = 0;

  const give_up = (reason: SpeechFailure, detail?: string) => {
    active = false;
    if (restart !== null) window.clearTimeout(restart);
    if (watchdog !== null) window.clearTimeout(watchdog);
    void plugin.stop?.().catch(() => {});
    onFailure(reason, detail);
  };

  const listen = async () => {
    if (!active) return;
    const startedAt = Date.now();
    try {
      await plugin.start?.({
        language,
        maxResults: 1,
        partialResults: true,
        popup: false,
      });
    } catch (err) {
      if (!active) return;
      const msg = String((err as Error)?.message ?? err);
      if (/permission/i.test(msg)) {
        give_up("denied", msg);
        return;
      }

      /* The bug this replaces: ERROR_NO_MATCH was treated as ordinary
         silence and retried after 250ms. On a phone whose recogniser is
         not working, that rejects instantly and retries forever — four
         native recognisers a second, a transcript stuck on "Listening…",
         and an app too busy to notice a tap on Stop. */
      const instant = Date.now() - startedAt < TOO_FAST_MS;
      if (BENIGN.test(msg) && !instant) {
        instantFailures = 0;
        restart = window.setTimeout(() => void listen(), 400);
        return;
      }
      if (!BENIGN.test(msg) && !heard) {
        give_up("error", msg);
        return;
      }

      instantFailures += 1;
      if (instantFailures >= MAX_INSTANT_FAILURES) {
        give_up(heard ? "error" : "unsupported", msg);
        return;
      }
      // Back off rather than spin: 600ms, 1200ms.
      restart = window.setTimeout(() => void listen(), 600 * instantFailures);
    }
  };

  try {
    handles.push(
      await plugin.addListener!("partialResults", (d) => {
        const text = d.matches?.[0];
        if (typeof text === "string") {
          heard = true;
          instantFailures = 0;
          current = text;
          emit();
        }
      }),
    );
    handles.push(
      await plugin.addListener!("listeningState", (d) => {
        if (d.status !== "stopped" || !active) return;
        restart = window.setTimeout(() => {
          commit();
          emit();
          void listen();
        }, 350);
      }),
    );
  } catch {
    onFailure("error");
    return null;
  }

  /* A recogniser that neither errors nor produces a word is the worst
     case, because the UI has nothing to say. Give it a deadline. */
  watchdog = window.setTimeout(() => {
    if (active && !heard) give_up("unsupported");
  }, WATCHDOG_MS);

  void listen();

  return {
    stop: async () => {
      active = false;
      if (restart !== null) window.clearTimeout(restart);
      if (watchdog !== null) window.clearTimeout(watchdog);
      try {
        await plugin.stop?.();
      } catch {
        /* already stopped */
      }
      // Give the recogniser a moment to deliver its last result.
      await new Promise((r) => setTimeout(r, 300));
      commit();
      emit();
      for (const h of handles) await h.remove().catch(() => {});
      await plugin.removeAllListeners?.().catch(() => {});
    },
  };
}

function startWeb(
  Web: new () => WebRecognition,
  { language, onText, onFailure }: DictationOptions,
): DictationSession {
  const rec = new Web();
  rec.lang = language;
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let active = true;
  let settled = "";

  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const text = r[0]?.transcript ?? "";
      if (r.isFinal) settled += text + " ";
      else interim += text;
    }
    onText((settled + interim).replace(/\s+/g, " ").trim());
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      active = false;
      onFailure("denied");
    } else if (!/no-speech|aborted|audio-capture/.test(e.error)) {
      active = false;
      onFailure("error");
    }
  };
  // Chrome ends `continuous` sessions on its own after a stretch of silence.
  rec.onend = () => {
    if (active) {
      try {
        rec.start();
      } catch {
        /* already restarting */
      }
    }
  };

  try {
    rec.start();
  } catch {
    onFailure("error");
  }

  return {
    stop: async () => {
      active = false;
      rec.onend = null;
      try {
        rec.stop();
      } catch {
        /* not running */
      }
      await new Promise((r) => setTimeout(r, 200));
      onText(settled.replace(/\s+/g, " ").trim());
    },
  };
}
