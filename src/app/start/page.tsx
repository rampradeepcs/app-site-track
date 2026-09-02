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
import { describeError } from "@/lib/errors";
import { isLiveBackend } from "@/lib/supabase/client";
import {
  sendOtp,
  verifyOtp,
  currentAppUser,
  sessionEmail,
  sessionIdentity,
} from "@/lib/supabase/auth";
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
  const [email, setEmail] = useState(
    () => searchParams.get("email")?.trim().toLowerCase() ?? "",
  );
  const [code, setCode] = useState("");

  /*
   * What the identity provider already established.
   *
   * Someone who reached this screen through Google or Outlook has an address
   * the provider has confirmed and, usually, the name it holds for them.
   * Asking them to type both back is asking for what we were just given, so
   * the fields start filled and the address is not editable — it is the
   * address the session is for, and letting them change it here would only
   * produce a company owned by an address nobody has verified.
   */
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void sessionIdentity().then((who) => {
      if (cancelled || !who) return;
      setVerifiedEmail(who.email.trim().toLowerCase());
      setEmail(who.email.trim().toLowerCase());
      /* Fill the name in; never overwrite something already typed. */
      if (who.name) setName((current) => current || who.name!);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* Signed in through a provider that already vouched for this address.
     Everything about verification — the step, its place on the rail, the
     way back to it — is off for them. */
  const alreadyVerified =
    !!verifiedEmail && verifiedEmail === email.trim().toLowerCase();
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
          /* Straight back to their details. Walking to "verify" put a
             verified arrival on an OTP screen they had never been shown and
             could not answer — the flow only skipped that step going
             forwards. */
          return alreadyVerified ? "identity" : "verify";
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

    /*
     * Someone who arrived here from a Google or Outlook sign-in has already
     * proved this address belongs to them. Asking them to receive a code and
     * type it back proves nothing twice, so if the session already holds this
     * address, go straight on.
     */
    const address = email.trim().toLowerCase();
    const verified = (await sessionEmail())?.trim().toLowerCase();
    if (verified && verified === address) {
      setBusy(false);
      setStep("company");
      return;
    }

    /*
     * The code goes to the address, not the mobile number. This sent the
     * phone to an email endpoint, so GoTrue was handed "9944311118" and
     * answered "unable to validate email address: invalid format" — a
     * correct complaint about a number nobody had claimed was an address.
     * Left over from making the address the identity; the mobile number is
     * contact detail now and is not verified.
     */
    const res = await sendOtp(address);
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
    const res = await verifyOtp(email.trim().toLowerCase(), code);
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
      setError(describeError(e));
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
  const railSiteIndex = FORM_STEPS.indexOf("site");

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
          {/*
            * No rail for an arrival the provider already vouched for.
            *
            * They are not filling in a signup form — they signed in, and the
            * rest is setting up their company. A progress bar counting steps
            * frames it as a queue to get through, and it was counting a step
            * they never see. The screens still say where they are.
            */}
          {alreadyVerified ? null : (
            <div className="wf-steps" role="progressbar" aria-valuemin={1}
                 aria-valuemax={FORM_STEPS.length}
                 aria-valuenow={Math.max(1, railIndex + 1)}
                 aria-label="Signup progress">
              {FORM_STEPS.map((s, i) => (
                <span key={s} data-on={i <= (step === "office" ? railSiteIndex : railIndex)} />
              ))}
            </div>
          )}
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
            hint={
              alreadyVerified
                ? "Confirmed by the account you signed in with. This becomes your company's administrator."
                : "This is how you sign in, and it becomes your company's administrator."
            }
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
              disabled={alreadyVerified}
              readOnly={alreadyVerified}
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
            {busy
              ? alreadyVerified
                ? "Just a moment…"
                : "Sending code…"
              : alreadyVerified
                ? "Next"
                : "Send me a code"}{" "}
            <IArrowR size={17} />
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
            <h1 className="wf-display text-2xl">Verify your email</h1>
            <p className="mt-1 text-sm text-[var(--wf-muted)]">
              Enter the {OTP_LENGTH}-digit code sent to{" "}
              <span className="font-semibold text-[var(--wf-fg)]">{email}</span>.
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
              They sign in with the email address you add here — no passwords,
              no invite codes to chase. You can add the rest later.
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
