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

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkforce } from "@/lib/store";
import { Field } from "@/components/ui";
import { IAlert, IArrowR, IChevronL, ILock, IShield } from "@/components/WfIcons";
import { landingFor } from "@/lib/routes";
import { isLiveBackend } from "@/lib/supabase/client";
import LiveGate from "@/components/LiveGate";
import { WorkfenceMark, WorkfenceSplash } from "@/components/Brand";
import { NewCompanyLink } from "@/components/onboarding/NewCompanyLink";
import { phoneKey } from "@/components/onboarding/InviteCrew";

export default function WorkforceGate() {
  // Fixed for the lifetime of a build: NEXT_PUBLIC_* is inlined at compile
  // time, so this never flips at runtime. Both gates are still bundled —
  // the flag is a computed boolean, not a literal the minifier can fold —
  // which costs a few KB and keeps one build able to serve either mode.
  return isLiveBackend ? <LiveGate /> : <LocalGate />;
}

type Step = "splash" | "identify" | "code";

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

  /** Nobody has signed up on this device yet. */
  const empty = state.users.length === 0;

  const match = useMemo(() => {
    const raw = identifier.trim();
    if (!raw) return null;
    if (raw.includes("@")) {
      return (
        state.users.find(
          (u) => (u.email ?? "").toLowerCase() === raw.toLowerCase(),
        ) ?? null
      );
    }
    const key = phoneKey(raw);
    return key ? state.users.find((u) => phoneKey(u.phone) === key) ?? null : null;
  }, [identifier, state.users]);

  const requestCode = () => {
    if (!identifier.trim()) return;
    if (!match) {
      // Naming the failure beats a generic "invalid": on this device the
      // records are right here, so "no such number" is a fact, not a guess.
      setError(
        "No account on this device uses that number. Ask whoever runs your company to add you, or create a company yourself.",
      );
      return;
    }
    setError(null);
    setCode("");
    setStep("code");
    window.setTimeout(() => codeRef.current?.focus(), 60);
  };

  const submitCode = () => {
    if (code.length < 4 || !match) return;
    // Setting the session is the whole job; the effect above does the
    // navigating, so the destination is chosen in exactly one place.
    login(match.role, match.id);
  };

  return (
    <main className="wf-phone justify-center px-6 py-10">
      {step === "splash" ? (
        <div className="flex flex-col items-center gap-6 text-center">
          <WorkfenceSplash onDone={() => setStep("identify")} />
          <p className="text-[0.68rem] text-[var(--wf-faint)]">
            A Nachi Tekneka product
          </p>
        </div>
      ) : step === "identify" ? (
        <div className="wf-fade-in flex flex-col gap-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <WorkfenceMark size={62} />
            <div>
              <h1 className="wf-display text-2xl font-bold">
                {empty ? "Welcome to Workfence" : "Sign in to Workfence"}
              </h1>
              <p className="mt-1 text-sm text-[var(--wf-muted)]">
                {empty
                  ? "Geofenced attendance and live site tracking for construction crews."
                  : "Enter the mobile number your company added you with."}
              </p>
            </div>
          </div>

          {empty ? (
            <>
              {/* Nothing exists yet, so signing in cannot work. Say that
                  plainly and offer the only door that does. */}
              <p className="wf-card2 p-4 text-[0.82rem] leading-relaxed text-[var(--wf-muted)]">
                No company has been set up on this device yet. Create one — it
                takes a minute, and you can invite your crew as you go.
              </p>
              <button
                className="wf-btn wf-btn-primary wf-btn-lg"
                onClick={() => router.push("/start")}
              >
                Create your company <IArrowR size={17} />
              </button>
            </>
          ) : (
            <>
              <Field label="Mobile number or email">
                <input
                  className="wf-input"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+91 90000 00000"
                  value={identifier}
                  onChange={(e) => {
                    setIdentifier(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && requestCode()}
                />
              </Field>

              {error ? (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-xl bg-[var(--wf-red-soft)] px-3 py-2 text-[0.8rem] text-[var(--wf-red)]"
                >
                  <IAlert size={15} className="mt-0.5 shrink-0" />
                  <span className="min-w-0">{error}</span>
                </p>
              ) : null}

              <button
                className="wf-btn wf-btn-primary wf-btn-lg"
                disabled={identifier.trim() === ""}
                onClick={requestCode}
              >
                Send code <IArrowR size={17} />
              </button>

              <NewCompanyLink />
            </>
          )}

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
              <h1 className="wf-display text-2xl font-bold">Verify it&apos;s you</h1>
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
