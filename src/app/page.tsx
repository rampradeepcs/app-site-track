"use client";

/**
 * Workfence gate.
 *
 * Two gates, one door, and now the same shape. With Supabase credentials
 * configured the real one takes over: identity is established with the auth
 * provider and the role comes from the database. Without them this local gate
 * runs, resolving the number you type against the store on this device.
 *
 * It used to be a role picker listing four invented people, which was the
 * last of the placeholder data and also a lie about how signing in works —
 * nobody chooses their own role. Both gates now ask for a number, send a
 * code, and land you wherever the record says you belong.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import { useWorkforce } from "@/lib/store";
import { Field } from "@/components/ui";
import { SsoButtons } from "@/components/SsoButtons";
import {
  clearSsoFailure,
  readSsoFailure,
  serverSsoFailure,
  subscribeSsoFailure,
} from "@/lib/sso-status";
import { LoginBackdrop } from "@/components/LoginBackdrop";
import { IAlert, IArrowR, IChevronL, ILock, IShield } from "@/components/WfIcons";
import { consumeSignInDirect, landingFor } from "@/lib/routes";
import { isLiveBackend } from "@/lib/supabase/client";
import LiveGate from "@/components/LiveGate";
import { WorkfenceMark, WorkfenceSplash } from "@/components/Brand";
import {
  Highlights,
  markHighlightsSeen,
} from "@/components/onboarding/Highlights";
import { phoneKey } from "@/components/onboarding/InviteCrew";
import { DEMO_EMAIL } from "@/lib/demo/mode";
import { PersonaChooser } from "@/components/demo/PersonaPicker";

export default function WorkforceGate() {
  // Fixed for the lifetime of a build: NEXT_PUBLIC_* is inlined at compile
  // time, so this never flips at runtime. Both gates are still bundled —
  // the flag is a computed boolean, not a literal the minifier can fold —
  // which costs a few KB and keeps one build able to serve either mode.
  return isLiveBackend ? <LiveGate /> : <LocalGate />;
}

type Step = "splash" | "highlights" | "identify" | "code" | "persona";

function LocalGate() {
  const { state, login } = useWorkforce();
  const router = useRouter();

  // Someone already signed in is on their way to a shift, not arriving at the
  // product — the splash would be two seconds standing between them and the
  // check-in button. They skip straight to the redirect.
  const [step, setStep] = useState<Step>(() =>
    state.session ? "identify" : "splash",
  );
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  /* A sign-on that came back and failed left its reason behind. Shown here,
     where the person is actually looking, rather than lost to a toast that
     fired while the browser was still closing. Read as an external store so
     the prerendered HTML and the device agree on the first paint. */
  const ssoFailure = useSyncExternalStore(
    subscribeSsoFailure,
    readSsoFailure,
    serverSsoFailure,
  );
  const shownError = error ?? ssoFailure;
  const codeRef = useRef<HTMLInputElement>(null);

  /*
   * The one place this screen navigates away, whether the session was already
   * there on arrival or was just created by signing in.
   *
   * Two owners would fight: signing in sets the session, which re-runs this
   * effect, so a `router.replace` in the submit handler and this one would
   * each pick a destination and the later one would win. The parked
   * destination is also single-use, so whoever lost the race would find
   * nothing and fall back to the role home. Hence the latch: navigate once.
   */
  const landedRef = useRef(false);
  useEffect(() => {
    if (!state.session || landedRef.current) return;
    landedRef.current = true;
    router.replace(landingFor(state.session.role));
  }, [state.session, router]);

  /* Backing out of the signup wizard skips the intro — they just sat
     through it. Post-mount so the server markup and hydration agree. */
  useEffect(() => {
    if (!state.session && consumeSignInDirect()) setStep("identify");
    // On-mount check only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Email is the identity now, so this is a single lookup rather than a
     branch on what the string looks like. */
  const match = useMemo(() => {
    const raw = identifier.trim().toLowerCase();
    if (!raw) return null;
    return state.users.find((u) => u.email.toLowerCase() === raw) ?? null;
  }, [identifier, state.users]);

  const isDemoAddress = identifier.trim().toLowerCase() === DEMO_EMAIL.toLowerCase();

  const requestCode = () => {
    if (!identifier.trim()) return;
    // One address opens the demonstration, and it is checked before the
    // device's own records: the demo has to work on a phone that has never
    // seen this app (spec §33).
    if (isDemoAddress) {
      setError(null);
      setCode("");
      setStep("code");
      window.setTimeout(() => codeRef.current?.focus(), 60);
      return;
    }
    if (!match) {
      /* An address nobody here recognises is not an error — it is a new
         company. Same rule as signing in with Google: unknown means new,
         and new means the onboarding flow rather than a dead end. The
         address travels with them so the wizard does not ask twice. */
      router.push(`/start?email=${encodeURIComponent(identifier.trim().toLowerCase())}`);
      return;
    }
    setError(null);
    setCode("");
    setStep("code");
    window.setTimeout(() => codeRef.current?.focus(), 60);
  };

  const submitCode = () => {
    if (code.length < 4) return;
    if (isDemoAddress) {
      setStep("persona");
      return;
    }
    if (!match) return;
    // Setting the session is the whole job; the effect above does the
    // navigating, so the destination is chosen in exactly one place.
    login(match.role, match.id);
  };

  /* The signed-out sequence, every time: splash → highlights → sign-in.
     Marking them seen doesn't skip them here — it keeps the signup wizard
     from replaying them to someone who just watched. */
  const afterSplash = () => setStep("highlights");

  const finishHighlights = () => {
    markHighlightsSeen();
    setStep("identify");
  };

  return (
    /* The splash owns the whole screen and sits centred; the highlights fill
       it edge to edge; the input steps sit in the top half instead, so the
       keypad that opens with the focused field never covers what the screen
       is asking for. */
    <main
      className={`wf-phone relative isolate px-6 ${
        step === "splash"
          ? "justify-center py-10"
          : step === "highlights"
            ? "pt-6 pb-8"
            : "justify-start pt-[9dvh] pb-10"
      }`}
    >
      <LoginBackdrop />
      {step === "splash" ? (
        <div className="flex flex-col items-center gap-6 text-center">
          <WorkfenceSplash onDone={afterSplash} />
          <p className="text-[0.68rem] text-[var(--wf-faint)]">
            A Born Creative product
          </p>
        </div>
      ) : step === "highlights" ? (
        <div className="wf-fade-in contents">
          <Highlights onDone={finishHighlights} onSkip={finishHighlights} />
        </div>
      ) : step === "persona" ? (
        <div className="wf-fade-in">
          <PersonaChooser />
        </div>
      ) : step === "identify" ? (
        <div className="wf-fade-in flex flex-col gap-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <WorkfenceMark size={62} />
            <div>
              <h1 className="wf-display text-2xl">
                Sign in to Workfence
              </h1>
              <p className="mt-1 text-sm text-[var(--wf-muted)]">
                Use the email address your company added you with, or sign in
                with Google or Outlook.
              </p>
            </div>
          </div>

          {/* The form shows even on a device with no records yet: the
              highlights land here, and the door should look the same on
              every device. An address nobody recognises is not an error —
              it is a new company, and it opens onboarding. */}
          <Field label="Work email">
            {/* Focused on arrival, and typed as email so the keyboard comes
                up with an @ on it rather than a keypad. */}
            <input
              className="wf-input"
              autoFocus
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@company.com"
              value={identifier}
              onChange={(e) => {
                setIdentifier(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && requestCode()}
            />
          </Field>

          {shownError ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-xl bg-[var(--wf-red-soft)] px-3 py-2 text-[0.8rem] text-[var(--wf-red)]"
            >
              <IAlert size={15} className="mt-0.5 shrink-0" />
              <span className="min-w-0">{shownError}</span>
            </p>
          ) : null}

          <button
            className="wf-btn wf-btn-primary wf-btn-lg"
            disabled={!/.+@.+\..+/.test(identifier.trim())}
            onClick={requestCode}
          >
            {match || isDemoAddress ? "Send code" : "Continue"} <IArrowR size={17} />
          </button>

          <SsoButtons
            onError={setError}
            onStart={() => {
              // A new attempt supersedes whatever the last one reported.
              clearSsoFailure();
              setError(null);
            }}
          />

          {/*
           * No "create your company" link any more. Signing in *is* the
           * signup: an address nobody recognises opens onboarding, whether
           * it arrived by hand or from Google. One door, and the identity
           * decides which side of it you are on.
           */}

          <p className="flex items-center justify-center gap-1.5 text-center text-[0.7rem] text-[var(--wf-faint)]">
            <IShield size={13} /> Location is tracked only during an active shift
          </p>
        </div>
      ) : (
        <div className="wf-fade-in flex flex-col gap-6">
          <button
            className="flex w-fit cursor-pointer items-center gap-1 text-sm font-semibold text-[var(--wf-muted)] hover:text-[var(--wf-fg)]"
            onClick={() => {
              setStep("identify");
              setError(null);
            }}
          >
            <IChevronL size={16} /> Back
          </button>

          <div className="flex flex-col items-center gap-3 text-center">
            <span className="grid h-16 w-16 place-items-center rounded-2xl bg-[var(--wf-amber-soft)] text-[var(--wf-amber)]">
              <ILock size={28} />
            </span>
            <div>
              <h1 className="wf-display text-2xl">Verify it&apos;s you</h1>
              <p className="mt-1 text-sm text-[var(--wf-muted)]">
                Enter the 4-digit code sent to{" "}
                <span className="font-semibold text-[var(--wf-fg)]">
                  {match?.phone ?? identifier}
                </span>
              </p>
              <p className="mt-1 text-[0.7rem] text-[var(--wf-faint)]">
                No backend is configured, so no code was sent — any 4 digits
                work here.
              </p>
            </div>
          </div>

          <input
            ref={codeRef}
            className="wf-input h-16 text-center text-2xl font-bold tracking-[0.5em] tabular-nums"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={4}
            aria-label="4-digit verification code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
            onKeyDown={(e) => e.key === "Enter" && submitCode()}
          />

          <button
            className="wf-btn wf-btn-primary wf-btn-lg"
            disabled={code.length < 4}
            onClick={submitCode}
          >
            Verify &amp; sign in
          </button>
        </div>
      )}
    </main>
  );
}
