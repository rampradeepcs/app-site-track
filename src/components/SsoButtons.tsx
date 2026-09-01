"use client";

/**
 * Google and Outlook sign-in.
 *
 * Offered alongside the mobile code rather than instead of it, and the
 * ordering says which is which: a site labourer is far more likely to have a
 * phone number than a work email, while an engineer or a manager almost
 * certainly signs in to everything else with their company account. Making
 * either one the only way in locks somebody out.
 *
 * The marks are drawn rather than fetched. A sign-in screen that waits on a
 * CDN for its buttons is a sign-in screen that is blank on a bad connection,
 * which is most of a construction site.
 */

import { useEffect, useState } from "react";
import {
  SSO_PROVIDERS,
  currentAuthEmail,
  signInWithProvider,
  type SsoProvider,
} from "@/lib/supabase/auth";
import { isLiveBackend } from "@/lib/supabase/client";

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="17" height="17" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2.5 24 .5 14.6.5 6.5 5.9 2.6 13.7l7.8 6.1C12.3 14 17.6 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 6.9-10 6.9-17.5z" />
      <path fill="#FBBC05" d="M10.4 28.2c-.5-1.4-.8-2.9-.8-4.2s.3-2.8.8-4.2l-7.8-6.1C1 16.8 0 20.3 0 24s1 7.2 2.6 10.3l7.8-6.1z" />
      <path fill="#34A853" d="M24 47.5c6.2 0 11.4-2 15.2-5.5l-7.5-5.8c-2 1.4-4.7 2.3-7.7 2.3-6.4 0-11.7-4.5-13.6-10.3l-7.8 6.1C6.5 42.1 14.6 47.5 24 47.5z" />
    </svg>
  );
}

function OutlookMark() {
  /* The Microsoft four-square: what a person actually recognises as the mark
     on the button they press to reach an Outlook account. */
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <path fill="#F25022" d="M2 2h9.2v9.2H2z" />
      <path fill="#7FBA00" d="M12.8 2H22v9.2h-9.2z" />
      <path fill="#00A4EF" d="M2 12.8h9.2V22H2z" />
      <path fill="#FFB900" d="M12.8 12.8H22V22h-9.2z" />
    </svg>
  );
}

const MARKS: Record<SsoProvider, () => React.JSX.Element> = {
  google: GoogleMark,
  azure: OutlookMark,
};

export function SsoButtons({ onError }: { onError?: (message: string) => void }) {
  const [busy, setBusy] = useState<SsoProvider | null>(null);

  /*
   * Recover when the browser comes back without a session.
   *
   * The happy path leaves this button reading "Opening…" on purpose — the
   * app is about to be replaced by the system browser. But every unhappy
   * path returns here too: the user cancels, the provider errors, or the
   * redirect never makes it back to the app. There was nothing listening
   * for those, so the button said "Opening…" until the app was force
   * quit — the sign-in looked like it was still in progress when it had
   * already failed.
   *
   * A successful return is handled by SsoReturn and arrives on the deep
   * link, which can land a moment after the app resumes, so give it that
   * moment before calling it a failure.
   */
  useEffect(() => {
    if (!busy) return;
    let cancelled = false;
    let remove: (() => void) | undefined;

    void (async () => {
      const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
        .Capacitor;
      if (typeof cap?.isNativePlatform !== "function" || !cap.isNativePlatform()) return;

      const { App } = await import("@capacitor/app");
      const handle = await App.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) return;
        window.setTimeout(async () => {
          if (cancelled) return;
          const email = await currentAuthEmail();
          if (cancelled || email) return;
          setBusy(null);
          onError?.(
            "Sign-in didn't complete. Check your connection and try again.",
          );
        }, 1500);
      });
      if (cancelled) void handle.remove();
      else remove = () => void handle.remove();
    })();

    return () => {
      cancelled = true;
      remove?.();
    };
  }, [busy, onError]);

  const start = async (provider: SsoProvider) => {
    setBusy(provider);
    const res = await signInWithProvider(provider);
    if (!res.ok) {
      onError?.(res.error ?? "Could not start sign-in.");
      setBusy(null);
      return;
    }
    // On success the page is leaving — either a redirect on the web or the
    // system browser on a device — so `busy` is intentionally left set.
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-[var(--wf-line)]" />
        <span className="text-[0.68rem] uppercase tracking-wider text-[var(--wf-faint)]">
          or
        </span>
        <span className="h-px flex-1 bg-[var(--wf-line)]" />
      </div>

      {SSO_PROVIDERS.map((p) => {
        const Mark = MARKS[p.id];
        return (
          <button
            key={p.id}
            className="wf-btn wf-btn-ghost wf-btn-lg"
            disabled={busy !== null || !isLiveBackend}
            onClick={() => void start(p.id)}
          >
            <Mark />
            {busy === p.id ? "Opening…" : p.label}
          </button>
        );
      })}

      {/*
       * Said plainly rather than hidden. In local mode there is no identity
       * provider to talk to, and a button that silently does nothing is
       * worse than one that explains itself.
       */}
      {!isLiveBackend ? (
        <p className="text-center text-[0.7rem] leading-snug text-[var(--wf-faint)]">
          Google and Outlook sign-in need this company to be connected to the
          Workfence backend. Use the mobile code until then.
        </p>
      ) : null}
    </div>
  );
}
