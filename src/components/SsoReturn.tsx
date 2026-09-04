"use client";

/**
 * Catches the deep link a single sign-on comes back on, and takes them in.
 *
 * The device flow leaves the app entirely — the system browser owns the
 * sign-in page — so the only way back in is the custom scheme the provider
 * redirects to. Without something listening for it the browser tab closes,
 * the app is where it was, and the sign-in appears to have silently failed.
 *
 * Mounted once, at the root, because the link can arrive while the user is
 * anywhere: they may have wandered off the sign-in screen while the browser
 * was open, and the session is still theirs.
 *
 * It also decides what happens next, here, in the same chain of events that
 * established the session. It used to stop at the exchange and leave the
 * rest to whichever screen was listening for the session to appear — and a
 * Microsoft sign-in completed on the server, was issued a session, and then
 * nothing followed: the sign-in screen sat there saying "Opening…" with its
 * buttons disabled until the app was force-quit. A hand-off that depends on
 * somebody else happening to be listening is a hand-off that can be
 * dropped; this one is not handed off.
 */

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { isLiveBackend } from "@/lib/supabase/client";
import { completeOAuthRedirect, currentAppUser } from "@/lib/supabase/auth";
import { showToast } from "@/lib/toast";
import { recordSsoFailure } from "@/lib/sso-status";
import { useWorkforce } from "@/lib/store";
import { landingFor } from "@/lib/routes";
import { describeError } from "@/lib/errors";
import { leaveDemoFor } from "@/lib/demo/mode";

export function SsoReturn() {
  const router = useRouter();
  const { loginAs } = useWorkforce();

  /* The native listener is registered once; it reads the latest sign-in
     function through a ref rather than re-registering on every render. */
  const loginAsRef = useRef(loginAs);
  useEffect(() => {
    loginAsRef.current = loginAs;
  }, [loginAs]);

  useEffect(() => {
    if (!isLiveBackend) return;
    let cancelled = false;
    let remove: (() => void) | undefined;

    void (async () => {
      const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
        .Capacitor;
      if (typeof cap?.isNativePlatform !== "function" || !cap.isNativePlatform()) return;

      const { App } = await import("@capacitor/app");
      const handle = await App.addListener("appUrlOpen", async ({ url }) => {
        if (!url.includes("auth-callback")) return;
        /* Breadcrumbs, readable from logcat on a device, for the next time
           a sign-in stops somewhere between the browser and the app. The
           code is elided: it is single-use, but it is still a credential. */
        console.info("[sso] returned:", url.replace(/code=[^&#]+/, "code=…"));
        const res = await completeOAuthRedirect(url);
        // Close the browser tab either way — leaving it open on a blank
        // redirect page is the most confusing possible outcome.
        try {
          const { Browser } = await import("@capacitor/browser");
          await Browser.close();
        } catch {
          /* already closed */
        }
        if (!res.ok) {
          const reason = res.error ?? "Sign-in failed";
          console.warn("[sso] exchange failed:", reason);
          // Written down as well as shown: the toast fires while the user is
          // still watching the browser close, and is missed more often than not.
          recordSsoFailure(reason);
          showToast(reason, "danger");
          return;
        }
        console.info("[sso] session established");

        /*
         * Same two outcomes as every other way in: the address resolves to a
         * worker record and they go to their home, or it resolves to nobody
         * and they go to found a company. currentAppUser claims a record
         * that carries the address and refreshes it from what the provider
         * just said, so an invited worker's first sign-in lands them on
         * their crew's site, not on a signup form.
         */
        try {
          const user = await currentAppUser();
          if (cancelled) return;
          if (user) {
            console.info("[sso] resolved to", user.employeeCode || user.id, user.role);
            loginAsRef.current(user);
            router.replace(landingFor(user.role));
          } else {
            console.info("[sso] no worker record for this address; onboarding");
            if (!leaveDemoFor("/start")) router.replace("/start");
          }
          showToast("Signed in", "success");
        } catch (e) {
          const reason = describeError(e);
          console.warn("[sso] resolving the account failed:", reason);
          recordSsoFailure(reason);
          showToast(reason, "danger");
        }
      });
      if (cancelled) void handle.remove();
      else remove = () => void handle.remove();
    })();

    return () => {
      cancelled = true;
      remove?.();
    };
    // Registered once for the life of the app; router and the ref are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
