"use client";

/**
 * Self-serve signup.
 *
 * A construction company signs itself up from a phone, usually standing
 * somewhere noisy, and the thing it must reach is not a dashboard — it is a
 * site a worker can check in to. So the wizard collects exactly what makes
 * that true and nothing else: who you are, what the company is called, where
 * the first site is, and who is on it. Billing, tax details, logos and
 * everything else the org record can hold are asked for later, by the screens
 * that need them.
 *
 * The last step is the one that justifies the rest: the company exists, with
 * a boundary drawn and a crew attached, and the next tap is a working app.
 */

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Field, Segmented } from "@/components/ui";
import {
  Highlights,
  markHighlightsSeen,
  seenHighlights,
} from "@/components/onboarding/Highlights";
import { PremiseStep, type PremiseFields } from "@/components/onboarding/PremiseStep";
import { InviteCrew } from "@/components/onboarding/InviteCrew";
import { WorkfenceMark } from "@/components/Brand";
import {
  IAlert,
  IArrowR,
  IBuilding,
  ICheckCircle,
  IChevronL,
  IHardHat,
  IUsers,
} from "@/components/WfIcons";
import { useWorkforce, type CompanyDraft, type CrewInvite } from "@/lib/store";
import { useSignUp } from "@/lib/onboarding";
import { requestSignInDirect } from "@/lib/routes";
import { isLiveBackend } from "@/lib/supabase/client";
import { sendOtp, verifyOtp, currentAppUser } from "@/lib/supabase/auth";
import { provisionCompanyRemote } from "@/lib/supabase/repository";
import type { TrackingMode } from "@/lib/types";

/** Steps that collect something, in order. The rail counts these. */
const FORM_STEPS = ["identity", "verify", "company", "site", "crew"] as const;
type Step = "highlights" | (typeof FORM_STEPS)[number] | "office" | "done";

/** Coimbatore. A first pin has to be somewhere; the map step moves it. */
const FALLBACK_CENTRE = { lat: 11.0273, lng: 77.0037 };

const OTP_LENGTH = isLiveBackend ? 6 : 4;

const isUsableEmail = (raw: string) => /.+@.+\..+/.test(raw.trim());

export default function StartPage() {
  return (
    <Suspense
      fallback={
        <main className="wf-phone px-6 pt-[9dvh]">
          <p className="text-sm text-[var(--wf-muted)]">Loading…</p>
        </main>
      }
    >
      <StartWizard />
    </Suspense>
  );
}

function StartWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { state, loginAs } = useWorkforce();
  const { signUp, signupsEnabled } = useSignUp();

  const [step, setStep] = useState<Step>("highlights");

  /* The gate already ran the highlights on this device's first launch, so
     arriving here from its "Create your company" would replay them. Checked
     in an effect rather than the initializer so the server markup and the
     first client render agree. */
  useEffect(() => {
    if (seenHighlights()) {
      setStep((s) => (s === "highlights" ? "identity" : s));
    }
    // On-mount check only — this must not re-fire as the wizard advances.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  /* Arriving from a sign-in that found no company: the address is already
     known, so asking for it again would be asking twice. */
  const [email, setEmail] = useState(
    () => searchParams.get("email")?.trim().toLowerCase() ?? "",
  );
  const [code, setCode] = useState("");
  const [company, setCompany] = useState("");
  const [site, setSite] = useState<PremiseFields>({
    name: "",
    address: "",
    location: FALLBACK_CENTRE,
    radius: 150,
  });
  const [tracking, setTracking] = useState<TrackingMode>("full-shift");
  const [wantOffice, setWantOffice] = useState(false);
  const [office, setOffice] = useState<PremiseFields>({
    name: "",
    address: "",
    location: FALLBACK_CENTRE,
    radius: 80,
  });
  const [crew, setCrew] = useState<CrewInvite[]>([]);
  const [orgName, setOrgName] = useState("");

  /*
   * Somebody already signed in has no business here — they belong to a
   * company already, and a second one is not a thing this product models.
   *
   * The latch is what stops this from firing on the session *we create*:
   * provisioning signs the new admin in, which would otherwise bounce them
   * off the success screen the instant they earned it.
   */
  const ownSession = useRef(false);
  const bounced = useRef(false);
  useEffect(() => {
    if (ownSession.current || bounced.current || !state.session) return;
    bounced.current = true;
    router.replace("/");
  }, [state.session, router]);

  const back = () => {
    setError(null);
    // The first form step backs out of the wizard entirely — straight to
    // sign-in, which is where the person came from. Not to the gate's
    // intro: they sat through the splash and highlights this visit.
    if (step === "identity" || step === "highlights") {
      requestSignInDirect();
      router.replace("/");
      return;
    }
    setStep((s) => {
      switch (s) {
        case "verify":
          return "identity";
        case "company":
          return "verify";
        case "site":
          return "company";
        case "office":
          return "site";
        case "crew":
          return wantOffice ? "office" : "site";
        default:
          return "identity";
      }
    });
  };

  /* ------------------------------------------------------------- identity */

  const submitIdentity = async () => {
    if (!name.trim() || !isUsableEmail(email)) return;
    setError(null);
    if (!isLiveBackend) {
      setStep("verify");
      return;
    }
    setBusy(true);
    const res = await sendOtp(phone.trim());
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Couldn't send the code.");
      return;
    }
    setStep("verify");
  };

  const submitCode = async () => {
    if (code.length !== OTP_LENGTH) return;
    setError(null);
    if (!isLiveBackend) {
      setStep("company");
      return;
    }
    setBusy(true);
    const res = await verifyOtp(phone.trim(), code);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "That code didn't work.");
      return;
    }
    setStep("company");
  };

  /* ---------------------------------------------------------- provisioning */

  const draft = useCallback(
    (): CompanyDraft => ({
      company: company.trim(),
      admin: {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim() || undefined,
      },
      site: {
        name: site.name.trim() || "First Site",
        address: site.address.trim(),
        location: site.location,
        radius: site.radius,
        trackingMode: tracking,
      },
      office: wantOffice
        ? {
            name: office.name.trim() || "Head Office",
            address: office.address.trim(),
            location: office.location,
            radius: office.radius,
          }
        : null,
      crew: crew.filter((c) => c.name.trim()),
    }),
    [company, name, phone, email, site, tracking, wantOffice, office, crew],
  );

  const finish = async () => {
    setError(null);
    const d = draft();
    ownSession.current = true;
    setOrgName(d.company);

    if (!isLiveBackend) {
      signUp(d);
      setStep("done");
      return;
    }

    setBusy(true);
    try {
      await provisionCompanyRemote({
        ...d,
        timezone:
          Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata",
      });
      // The RPC created the admin row and linked it to this identity; read it
      // back rather than reconstructing it, so the session holds the record
      // the database actually stored.
      const me = await currentAppUser();
      if (!me) throw new Error("Company created, but signing you in failed.");
      loginAs(me);
      setStep("done");
    } catch (e) {
      ownSession.current = false;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /* --------------------------------------------------------------- render */

  if (!signupsEnabled) {
    return (
      <main className="wf-phone justify-center gap-4 px-6 py-10 text-center">
        <WorkfenceMark size={54} className="mx-auto" />
        <h1 className="wf-display text-2xl">Signups are closed</h1>
        <p className="text-sm text-[var(--wf-muted)]">
          New companies aren&apos;t being taken on right now. If you were
          invited to one, sign in instead.
        </p>
        <button className="wf-btn wf-btn-primary" onClick={() => router.replace("/")}>
          Go to sign in
        </button>
      </main>
    );
  }

  const railIndex = FORM_STEPS.indexOf(step as (typeof FORM_STEPS)[number]);

  return (
    <main className="wf-phone gap-5 px-6 py-8">
      {step !== "highlights" && step !== "done" ? (
        <>
          <div className="flex items-center justify-between">
            <button
              className="flex cursor-pointer items-center gap-1 text-sm font-semibold text-[var(--wf-muted)] hover:text-[var(--wf-fg)]"
              onClick={back}
            >
              <IChevronL size={16} /> Back
            </button>
            <WorkfenceMark size={26} title="Workfence" />
          </div>
          <div className="wf-steps" role="progressbar" aria-valuemin={1}
               aria-valuemax={FORM_STEPS.length}
               aria-valuenow={Math.max(1, railIndex + 1)}
               aria-label="Signup progress">
            {FORM_STEPS.map((s, i) => (
              <span key={s} data-on={i <= (step === "office" ? 3 : railIndex)} />
            ))}
          </div>
        </>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-[var(--wf-red-edge)] bg-[var(--wf-red-soft)] px-3 py-2.5 text-[0.8rem] text-[var(--wf-red)]"
        >
          <IAlert size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}

      {step === "highlights" ? (
        <Highlights
          onDone={() => {
            markHighlightsSeen();
            setStep("identity");
          }}
          onSkip={() => {
            markHighlightsSeen();
            setStep("identity");
          }}
        />
      ) : null}

      {step === "identity" ? (
        <div className="wf-fade-in flex flex-col gap-4">
          <header>
            <h1 className="wf-display text-2xl">Let&apos;s start with you</h1>
            <p className="mt-1 text-sm text-[var(--wf-muted)]">
              You&apos;ll be the administrator of the company you create.
            </p>
          </header>
          <Field label="Your name" required>
            <input
              className="wf-input"
              placeholder="Full name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field
            label="Work email"
            required
            hint="This is how you sign in, and it becomes your company's administrator."
          >
            <input
              className="wf-input"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Mobile number" hint="Optional. How your crew reaches you.">
            <input
              className="wf-input"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+91 90000 00000"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
          <button
            className="wf-btn wf-btn-primary wf-btn-lg mt-1"
            disabled={busy || !name.trim() || !isUsableEmail(email)}
            onClick={submitIdentity}
          >
            {busy ? "Sending code…" : "Send me a code"} <IArrowR size={17} />
          </button>
          <button
            className="cursor-pointer text-center text-[0.8rem] font-semibold text-[var(--wf-muted)] hover:text-[var(--wf-fg)]"
            onClick={() => {
              requestSignInDirect();
              router.replace("/");
            }}
          >
            Already invited to a company? Sign in
          </button>
        </div>
      ) : null}

      {step === "verify" ? (
        <div className="wf-fade-in flex flex-col gap-5">
          <header>
            <h1 className="wf-display text-2xl">Verify your number</h1>
            <p className="mt-1 text-sm text-[var(--wf-muted)]">
              Enter the {OTP_LENGTH}-digit code sent to{" "}
              <span className="font-semibold text-[var(--wf-fg)]">{phone}</span>.
            </p>
            {!isLiveBackend ? (
              <p className="mt-1 text-[0.72rem] text-[var(--wf-faint)]">
                No backend is configured, so no code was sent — any{" "}
                {OTP_LENGTH} digits work.
              </p>
            ) : null}
          </header>
          <input
            className="wf-input text-center text-2xl font-bold tracking-[0.5em] tabular-nums"
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="One-time code"
            maxLength={OTP_LENGTH}
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH))
            }
            onKeyDown={(e) => e.key === "Enter" && submitCode()}
          />
          <button
            className="wf-btn wf-btn-primary wf-btn-lg"
            disabled={busy || code.length !== OTP_LENGTH}
            onClick={submitCode}
          >
            {busy ? "Checking…" : "Verify"} <IArrowR size={17} />
          </button>
        </div>
      ) : null}

      {step === "company" ? (
        <div className="wf-fade-in flex flex-col gap-4">
          <header>
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--wf-green-soft)] text-[var(--wf-green)]">
              <IBuilding size={24} />
            </span>
            <h1 className="wf-display mt-3 text-2xl">
              What&apos;s the company called?
            </h1>
            <p className="mt-1 text-sm text-[var(--wf-muted)]">
              It names your workspace and appears on exports and reports.
            </p>
          </header>
          <Field label="Company name" required>
            <input
              className="wf-input"
              placeholder="e.g. Born Creative"
              autoComplete="organization"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && company.trim() && setStep("site")
              }
            />
          </Field>
          <button
            className="wf-btn wf-btn-primary wf-btn-lg mt-1"
            disabled={!company.trim()}
            onClick={() => setStep("site")}
          >
            Continue <IArrowR size={17} />
          </button>
        </div>
      ) : null}

      {step === "site" ? (
        <div className="wf-fade-in flex flex-col gap-4">
          <header>
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--wf-amber-soft)] text-[var(--wf-amber)]">
              <IHardHat size={24} />
            </span>
            <h1 className="wf-display mt-3 text-2xl">Your first site</h1>
            <p className="mt-1 text-sm text-[var(--wf-muted)]">
              Attendance happens inside a boundary, so there has to be one
              before anybody can check in.
            </p>
          </header>

          <PremiseStep
            value={site}
            onChange={setSite}
            namePlaceholder="e.g. Riverside Tower"
          >
            <div className="wf-card2 flex flex-col gap-3 p-4">
              <span className="text-[0.72rem] font-bold tracking-wider uppercase text-[var(--wf-muted)]">
                Movement inside the boundary
              </span>
              <Segmented
                ariaLabel="Tracking policy"
                value={tracking}
                onChange={setTracking}
                options={[
                  { value: "full-shift", label: "Record it" },
                  { value: "outside-only", label: "Don't record it" },
                ]}
              />
              <p className="text-[0.78rem] leading-relaxed text-[var(--wf-muted)]">
                {tracking === "full-shift"
                  ? "The whole shift is recorded, check-in to checkout, and the day's route is on the map."
                  : "Nothing is recorded while they're on site. The trail starts when someone leaves the boundary and runs until checkout — which is then only accepted at a premise they're assigned to."}
              </p>
            </div>

            <label className="wf-card2 flex cursor-pointer items-center gap-3 p-4">
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0 accent-[var(--wf-amber)]"
                checked={wantOffice}
                onChange={(e) => setWantOffice(e.target.checked)}
              />
              <span className="min-w-0">
                <span className="block text-[0.88rem] font-semibold">
                  We also have an office
                </span>
                <span className="block text-[0.76rem] text-[var(--wf-muted)]">
                  {tracking === "outside-only"
                    ? "Recommended — it gives a crew somewhere other than the site to end the day."
                    : "A second premise a shift can start and end at."}
                </span>
              </span>
            </label>
          </PremiseStep>

          <button
            className="wf-btn wf-btn-primary wf-btn-lg"
            disabled={!site.name.trim()}
            onClick={() => setStep(wantOffice ? "office" : "crew")}
          >
            Continue <IArrowR size={17} />
          </button>
        </div>
      ) : null}

      {step === "office" ? (
        <div className="wf-fade-in flex flex-col gap-4">
          <header>
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--wf-blue-soft)] text-[var(--wf-blue)]">
              <IBuilding size={24} />
            </span>
            <h1 className="wf-display mt-3 text-2xl">Your office</h1>
            <p className="mt-1 text-sm text-[var(--wf-muted)]">
              A premise, not a job — somewhere a shift can be started or closed
              when nobody is on a site.
            </p>
          </header>
          <PremiseStep
            value={office}
            onChange={setOffice}
            namePlaceholder="e.g. Head Office"
          />
          <button
            className="wf-btn wf-btn-primary wf-btn-lg"
            disabled={!office.name.trim()}
            onClick={() => setStep("crew")}
          >
            Continue <IArrowR size={17} />
          </button>
        </div>
      ) : null}

      {step === "crew" ? (
        <div className="wf-fade-in flex flex-col gap-4">
          <header>
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--wf-violet-soft)] text-[var(--wf-violet)]">
              <IUsers size={24} />
            </span>
            <h1 className="wf-display mt-3 text-2xl">Add your crew</h1>
            <p className="mt-1 text-sm text-[var(--wf-muted)]">
              They sign in with the number you add here — no passwords, no
              invite codes to chase. You can add the rest later.
            </p>
          </header>
          <InviteCrew invites={crew} onChange={setCrew} />
          <button
            className="wf-btn wf-btn-primary wf-btn-lg mt-2"
            disabled={busy}
            onClick={finish}
          >
            {busy
              ? "Creating your company…"
              : crew.length
                ? `Create ${company.trim()} with ${crew.length} ${crew.length === 1 ? "person" : "people"}`
                : `Create ${company.trim()}`}
          </button>
          {crew.length === 0 ? (
            <p className="text-center text-[0.76rem] text-[var(--wf-faint)]">
              You can start on your own and add people from Team.
            </p>
          ) : null}
        </div>
      ) : null}

      {step === "done" ? (
        <div className="wf-fade-in flex flex-1 flex-col items-center justify-center gap-6 text-center">
          <span className="grid h-20 w-20 place-items-center rounded-[1.6rem] bg-[var(--wf-green-soft)] text-[var(--wf-green)]">
            <ICheckCircle size={38} />
          </span>
          <div>
            <h1 className="wf-display text-2xl">{orgName} is live</h1>
            <p className="mt-2 text-sm leading-relaxed text-[var(--wf-muted)]">
              {site.name.trim() || "Your site"} has a boundary, {crew.length}{" "}
              {crew.length === 1 ? "person is" : "people are"} on it, and you
              can check in from today.
            </p>
          </div>
          <button
            className="wf-btn wf-btn-primary wf-btn-lg w-full"
            onClick={() => router.replace("/admin")}
          >
            Open your dashboard <IArrowR size={17} />
          </button>
        </div>
      ) : null}
    </main>
  );
}
