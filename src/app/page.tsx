"use client";

/**
 * SiteTrack gate.
 *
 * Two gates, one door. With Supabase credentials configured the real one
 * takes over: identity is established with the auth provider and the role
 * comes from the database. Without them this demo gate runs, where you pick
 * a seeded person and any code works — that is what keeps the product
 * explorable with no backend attached.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkforce } from "@/lib/store";
import { Avatar } from "@/components/ui";
import {
  IArrowR,
  IChevronL,
  IHardHat,
  IMapPin,
  IShield,
  IUsers,
} from "@/components/WfIcons";
import type { Role, User } from "@/lib/types";
import { homeFor } from "@/lib/routes";
import { isLiveBackend } from "@/lib/supabase/client";
import LiveGate from "@/components/LiveGate";

type Step = "splash" | "role" | "who" | "otp";

export default function WorkforceGate() {
  // Fixed for the lifetime of a build: NEXT_PUBLIC_* is inlined at compile
  // time, so this never flips at runtime. Both gates are still bundled —
  // the flag is a computed boolean, not a literal the minifier can fold —
  // which costs a few KB and keeps one build able to serve either mode.
  return isLiveBackend ? <LiveGate /> : <DemoGate />;
}

function DemoGate() {
  const { state, login } = useWorkforce();
  const router = useRouter();
  const [step, setStep] = useState<Step>("splash");
  const [role, setRole] = useState<Role>("employee");
  const [who, setWho] = useState<User | null>(null);
  const [otp, setOtp] = useState(["", "", "", ""]);
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);

  /* Already signed in → straight to the app. */
  useEffect(() => {
    if (state.session) router.replace(homeFor(state.session.role));
  }, [state.session, router]);

  /* Splash advances on its own. */
  useEffect(() => {
    if (step !== "splash") return;
    const t = window.setTimeout(() => setStep("role"), 1400);
    return () => window.clearTimeout(t);
  }, [step]);

  const employees = useMemo(
    () => state.users.filter((u) => u.role === "employee" && u.status === "active"),
    [state.users],
  );
  const manager = useMemo(
    () => state.users.find((u) => u.role === "manager") ?? null,
    [state.users],
  );
  const owner = useMemo(
    () => state.users.find((u) => u.role === "superadmin") ?? null,
    [state.users],
  );

  const submitOtp = () => {
    if (otp.some((d) => d === "")) return;
    const user = role === "superadmin" ? owner : role === "manager" ? manager : who;
    login(role, user?.id);
    router.replace(homeFor(role));
  };

  return (
    <main className="wf-phone justify-center px-6 py-10">
      {step === "splash" ? (
        <div className="wf-pop-in flex flex-col items-center gap-5 text-center">
          <BrandMark size={92} />
          <div>
            <h1 className="wf-display text-3xl font-bold tracking-tight">
              Site<span className="text-[var(--wf-amber)]">Track</span>
            </h1>
            <p className="mt-1 text-sm text-[var(--wf-muted)]">
              Workforce attendance & live site tracking
            </p>
          </div>
          <div className="mt-4 h-1 w-28 overflow-hidden rounded-full bg-[var(--wf-surface3)]">
            <div className="h-full w-1/2 animate-[wf-loadbar_1.3s_ease-in-out_infinite] rounded-full bg-[var(--wf-amber)]" />
          </div>
          <style>{`@keyframes wf-loadbar{0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}`}</style>
          <p className="text-[0.68rem] text-[var(--wf-faint)]">
            A Nachi Tekneka product demo
          </p>
        </div>
      ) : step === "role" ? (
        <div className="wf-fade-in flex flex-col gap-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <BrandMark size={62} />
            <div>
              <h1 className="wf-display text-2xl font-bold">Welcome to SiteTrack</h1>
              <p className="mt-1 text-sm text-[var(--wf-muted)]">
                Choose how you want to sign in
              </p>
            </div>
          </div>
          <button
            className="wf-card flex cursor-pointer items-center gap-4 p-5 text-left transition hover:border-[var(--wf-amber)]"
            onClick={() => {
              setRole("employee");
              setStep("who");
            }}
          >
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[rgba(246,167,35,0.14)] text-[var(--wf-amber)]">
              <IHardHat size={26} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold">Employee</span>
              <span className="block text-[0.8rem] text-[var(--wf-muted)]">
                Check in on site, track your shift, log work
              </span>
            </span>
            <IArrowR size={18} className="shrink-0 text-[var(--wf-faint)]" />
          </button>
          <button
            className="wf-card flex cursor-pointer items-center gap-4 p-5 text-left transition hover:border-[var(--wf-amber)]"
            onClick={() => {
              setRole("manager");
              setWho(manager);
              setStep("otp");
            }}
          >
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[rgba(69,184,245,0.14)] text-[var(--wf-blue)]">
              <IUsers size={26} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold">Manager / Project Manager</span>
              <span className="block text-[0.8rem] text-[var(--wf-muted)]">
                Live workforce map, attendance, reports
              </span>
            </span>
            <IArrowR size={18} className="shrink-0 text-[var(--wf-faint)]" />
          </button>
          <button
            className="wf-card flex cursor-pointer items-center gap-4 p-5 text-left transition hover:border-[var(--wf-amber)]"
            onClick={() => {
              setRole("superadmin");
              setWho(owner);
              setStep("otp");
            }}
          >
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[rgba(167,139,250,0.14)] text-[var(--wf-violet)]">
              <IShield size={26} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold">Product Owner / Super Admin</span>
              <span className="block text-[0.8rem] text-[var(--wf-muted)]">
                Tenants, subscriptions, billing, platform analytics
              </span>
            </span>
            <IArrowR size={18} className="shrink-0 text-[var(--wf-faint)]" />
          </button>
          <p className="flex items-center justify-center gap-1.5 text-center text-[0.7rem] text-[var(--wf-faint)]">
            <IShield size={13} /> Location is tracked only during an active shift
          </p>
        </div>
      ) : step === "who" ? (
        <div className="wf-fade-in flex min-h-0 flex-col gap-4">
          <button
            className="flex w-fit cursor-pointer items-center gap-1 text-sm font-semibold text-[var(--wf-muted)] hover:text-[var(--wf-fg)]"
            onClick={() => setStep("role")}
          >
            <IChevronL size={16} /> Back
          </button>
          <div>
            <h1 className="wf-display text-2xl font-bold">Who&apos;s signing in?</h1>
            <p className="mt-1 text-sm text-[var(--wf-muted)]">
              Demo accounts — in production this is your phone number
            </p>
          </div>
          <div className="flex max-h-[52dvh] flex-col gap-2 overflow-y-auto pr-1">
            {employees.map((u) => (
              <button
                key={u.id}
                className="wf-card2 flex cursor-pointer items-center gap-3 p-3 text-left transition hover:border-[var(--wf-amber)]"
                onClick={() => {
                  setWho(u);
                  setStep("otp");
                }}
              >
                <Avatar name={u.name} hue={u.avatarHue} size={42} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{u.name}</span>
                  <span className="block truncate text-[0.75rem] text-[var(--wf-muted)]">
                    {u.designation} · {u.employeeCode}
                  </span>
                </span>
                <IArrowR size={16} className="shrink-0 text-[var(--wf-faint)]" />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="wf-fade-in flex flex-col gap-6">
          <button
            className="flex w-fit cursor-pointer items-center gap-1 text-sm font-semibold text-[var(--wf-muted)] hover:text-[var(--wf-fg)]"
            onClick={() => setStep(role === "employee" ? "who" : "role")}
          >
            <IChevronL size={16} /> Back
          </button>
          <div className="flex flex-col items-center gap-3 text-center">
            {who ? <Avatar name={who.name} hue={who.avatarHue} size={64} /> : null}
            <div>
              <h1 className="wf-display text-2xl font-bold">Verify it&apos;s you</h1>
              <p className="mt-1 text-sm text-[var(--wf-muted)]">
                Enter the 4-digit code sent to{" "}
                <span className="font-semibold text-[var(--wf-fg)]">
                  {who?.phone ?? "your phone"}
                </span>
              </p>
              <p className="mt-1 text-[0.7rem] text-[var(--wf-faint)]">
                (demo: any 4 digits work)
              </p>
            </div>
          </div>
          <div className="flex justify-center gap-3">
            {otp.map((d, i) => (
              <input
                key={i}
                ref={(el) => {
                  otpRefs.current[i] = el;
                }}
                inputMode="numeric"
                maxLength={1}
                aria-label={`OTP digit ${i + 1}`}
                className="wf-input h-16 w-14 text-center text-2xl font-bold tabular-nums"
                value={d}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "").slice(-1);
                  setOtp((o) => o.map((x, j) => (j === i ? v : x)));
                  if (v && i < 3) otpRefs.current[i + 1]?.focus();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Backspace" && !otp[i] && i > 0)
                    otpRefs.current[i - 1]?.focus();
                  if (e.key === "Enter") submitOtp();
                }}
              />
            ))}
          </div>
          <button
            className="wf-btn wf-btn-primary wf-btn-lg"
            disabled={otp.some((d) => d === "")}
            onClick={submitOtp}
          >
            Verify & sign in
          </button>
        </div>
      )}
    </main>
  );
}

function BrandMark({ size }: { size: number }) {
  return (
    <span
      className="grid place-items-center rounded-[26%] shadow-2xl"
      style={{
        width: size,
        height: size,
        background: "linear-gradient(145deg, #f6a723, #ee6c2b)",
        color: "#17130a",
      }}
      aria-hidden="true"
    >
      <IMapPin size={size * 0.52} strokeWidth={2.1} />
    </span>
  );
}
