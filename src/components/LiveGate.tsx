"use client";

/**
 * Sign-in against a real Supabase backend.
 *
 * The local gate matches the number you type against this device's records.
 * That cannot work here: every row this product reads sits behind a policy
 * keyed on `auth.uid()`, so identity has to be established with Supabase
 * before there is anything to show — and the role comes back from the user's
 * database record rather than being chosen at the door.
 *
 * Rendered only when credentials are configured; see `isLiveBackend`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkforce } from "@/lib/store";
import {
  currentAppUser,
  currentAuthEmail,
  sendOtp,
  signOut,
  verifyOtp,
} from "@/lib/supabase/auth";
import { SsoButtons } from "./SsoButtons";
import { consumeSignInDirect, landingFor } from "@/lib/routes";
import { Field } from "@/components/ui";
import { WorkfenceMark } from "@/components/Brand";
import {
  Highlights,
  markHighlightsSeen,
} from "@/components/onboarding/Highlights";
import { IAlert, IArrowR, IChevronL, ILock, IShield } from "@/components/WfIcons";

const CODE_LENGTH = 6;

type Step = "restoring" | "highlights" | "identity" | "code" | "unlinked";

export default function LiveGate() {
  const { state, loginAs } = useWorkforce();
  const router = useRouter();

  const [step, setStep] = useState<Step>("restoring");
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement | null>(null);

  /**
   * Resolve the auth identity to a product user. Signing them in is the whole
   * job — the effect below owns the navigation, so the destination is chosen
   * in exactly one place. Returns false for an identity that authenticated
   * but matches no worker record.
   */
  const enter = useCallback(async (): Promise<boolean> => {
    const user = await currentAppUser();
    if (!user) return false;
    loginAs(user);
    return true;
  }, [loginAs]);

  /*
   * The one place this screen navigates away. Latched because the parked
   * destination is single-use: a second run would find nothing and fall back
   * to the role home, undoing the deep link it just honoured.
   */
  const landedRef = useRef(false);
  useEffect(() => {
    if (!state.session || landedRef.current) return;
    landedRef.current = true;
    router.replace(landingFor(state.session.role));
  }, [state.session, router]);

  /* An unexpired token means this device is already signed in. Anyone else
     gets the signed-out sequence: highlights, then sign-in. */
  useEffect(() => {
    let cancelled = false;
    if (state.session) return; // the effect above is already taking them in
    const arrive = () =>
      setStep(consumeSignInDirect() ? "identity" : "highlights");
    enter()
      .then((ok) => {
        if (!cancelled && !ok) arrive();
      })
      .catch(() => {
        if (!cancelled) arrive();
      });
    return () => {
      cancelled = true;
    };
    // Runs once: this is session restore, not a subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finishHighlights = () => {
    markHighlightsSeen();
    setStep("identity");
  };

  const requestCode = async () => {
    const id = identifier.trim();
    if (!id) return;
    setBusy(true);
    setError(null);
    const res = await sendOtp(id);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Could not send the code.");
      return;
    }
    setNotice(
      id.includes("@")
        ? `We emailed a ${CODE_LENGTH}-digit code to ${id}.`
        : `We texted a ${CODE_LENGTH}-digit code to ${id}.`,
    );
    setCode("");
    setStep("code");
    window.setTimeout(() => codeRef.current?.focus(), 60);
  };

  const submitCode = async () => {
    if (code.length < CODE_LENGTH) return;
    setBusy(true);
    setError(null);
    const res = await verifyOtp(identifier.trim(), code);
    if (!res.ok) {
      setBusy(false);
      setError(res.error ?? "That code did not work.");
      return;
    }
    // Verified with Supabase but possibly not yet a member of any tenant —
    // a real state, and one worth naming rather than showing an empty app.
    const ok = await enter();
    setBusy(false);
    if (!ok) {
      // The SSO path never touched the form, so ask the session who this is.
      const who = await currentAuthEmail();
      if (who) setIdentifier(who);
      setStep("unlinked");
    }
  };

  return (
    /* Session restore sits centred like a splash; the highlights fill the
       screen; the input steps sit in the top half so the keypad that opens
       with the focused field never covers what the screen is asking for.
       Matches the local gate. */
    <main
      className={`wf-phone px-6 ${
        step === "restoring"
          ? "justify-center py-10"
          : step === "highlights"
            ? "pt-6 pb-8"
            : "justify-start pt-[9dvh] pb-10"
      }`}
    >
      {step === "restoring" ? (
        <div className="flex flex-col items-center gap-4 text-center">
          <WorkfenceMark size={72} />
          <p className="text-sm text-[var(--wf-muted)]">Checking your session…</p>
        </div>
      ) : step === "highlights" ? (
        <Highlights
          onDone={finishHighlights}
          onSkip={finishHighlights}
        />
      ) : step === "unlinked" ? (
        <div className="wf-fade-in flex flex-col gap-5 text-center">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-[var(--wf-red-soft)] text-[var(--wf-red)]">
            <IAlert size={30} />
          </span>
          <div>
            <h1 className="wf-display text-2xl">New to Workfence</h1>
            <p className="mt-2 text-sm text-[var(--wf-muted)]">
              <span className="font-semibold text-[var(--wf-fg)]">{identifier}</span> signed
              in successfully, and isn&apos;t on any company yet. Set one up, and
              this address becomes its administrator.
            </p>
          </div>
          {/*
           * An unrecognised identity is a new company, not a dead end — the
           * sign-in and the sign-up are the same door, and which side you
           * land on is decided by the address rather than by which link you
           * happened to press.
           */}
          <button
            className="wf-btn wf-btn-primary wf-btn-lg"
            onClick={() =>
              router.push(`/start?email=${encodeURIComponent(identifier)}`)
            }
          >
            Set up my company <IArrowR size={17} />
          </button>
          {/*
           * Kept, because the other reason to be unlinked is mundane and
           * common: an employee whose administrator has not added them yet.
           * Pushing them into creating a second empty company would be the
           * worse failure of the two.
           */}
          <p className="text-[0.76rem] leading-relaxed text-[var(--wf-muted)]">
            Expecting to join a company that already exists? Ask whoever runs
            it to add this address, then sign in again.
          </p>
          <button
            className="wf-btn wf-btn-ghost"
            onClick={async () => {
              await signOut();
              setIdentifier("");
              setCode("");
              setError(null);
              setNotice(null);
              setStep("identity");
            }}
          >
            Use a different account
          </button>
        </div>
      ) : step === "identity" ? (
        <div className="wf-fade-in flex flex-col gap-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <WorkfenceMark size={62} />
            <div>
              <h1 className="wf-display text-2xl">Sign in to Workfence</h1>
              <p className="mt-1 text-sm text-[var(--wf-muted)]">
                We&apos;ll send a one-time code. No password to remember on site.
              </p>
            </div>
          </div>

          <Field
            label="Work email"
            hint="The address your company added you with."
          >
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
              onChange={(e) => setIdentifier(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void requestCode();
              }}
            />
          </Field>

          {error ? <ErrorNote>{error}</ErrorNote> : null}

          <button
            className="wf-btn wf-btn-primary wf-btn-lg"
            disabled={busy || identifier.trim() === ""}
            onClick={() => void requestCode()}
          >
            {busy ? "Sending…" : "Send code"} <IArrowR size={17} />
          </button>

          <SsoButtons onError={setError} />

          <p className="flex items-center justify-center gap-1.5 text-center text-[0.7rem] text-[var(--wf-faint)]">
            <IShield size={13} /> Location is tracked only during an active shift
          </p>
        </div>
      ) : (
        <div className="wf-fade-in flex flex-col gap-6">
          <button
            className="flex w-fit cursor-pointer items-center gap-1 text-sm font-semibold text-[var(--wf-muted)] hover:text-[var(--wf-fg)]"
            onClick={() => {
              setStep("identity");
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
              <p className="mt-1 text-sm text-[var(--wf-muted)]">{notice}</p>
            </div>
          </div>

          <input
            ref={codeRef}
            className="wf-input h-16 text-center text-2xl font-bold tracking-[0.5em] tabular-nums"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={CODE_LENGTH}
            aria-label={`${CODE_LENGTH}-digit verification code`}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitCode();
            }}
          />

          {error ? <ErrorNote>{error}</ErrorNote> : null}

          <button
            className="wf-btn wf-btn-primary wf-btn-lg"
            disabled={busy || code.length < CODE_LENGTH}
            onClick={() => void submitCode()}
          >
            {busy ? "Verifying…" : "Verify & sign in"}
          </button>

          <button
            className="cursor-pointer text-center text-[0.78rem] font-semibold text-[var(--wf-muted)] hover:text-[var(--wf-fg)]"
            disabled={busy}
            onClick={() => void requestCode()}
          >
            Didn&apos;t get it? Send again
          </button>
        </div>
      )}
    </main>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-xl bg-[var(--wf-red-soft)] px-3 py-2 text-[0.8rem] text-[var(--wf-red)]"
    >
      <IAlert size={15} className="mt-0.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

