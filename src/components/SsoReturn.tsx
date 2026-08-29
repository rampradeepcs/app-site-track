"use client";

/**
 * Catches the deep link a single sign-on comes back on.
 *
 * The device flow leaves the app entirely — the system browser owns the
 * sign-in page — so the only way back in is the custom scheme the provider
 * redirects to. Without something listening for it the browser tab closes,
 * the app is where it was, and the sign-in appears to have silently failed.
 *
 * Mounted once, at the root, because the link can arrive while the user is
 * anywhere: they may have wandered off the sign-in screen while the browser
 * was open, and the session is still theirs.
 */

import { useEffect } from "react";
import { isLiveBackend } from "@/lib/supabase/client";
import { completeOAuthRedirect } from "@/lib/supabase/auth";
import { showToast } from "@/lib/toast";

export function SsoReturn() {
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
        const res = await completeOAuthRedirect(url);
        // Close the browser tab either way — leaving it open on a blank
        // redirect page is the most confusing possible outcome.
        try {
          const { Browser } = await import("@capacitor/browser");
          await Browser.close();
        } catch {
          /* already closed */
        }
        showToast(res.ok ? "Signed in" : (res.error ?? "Sign-in failed"), res.ok ? "success" : "danger");
      });
      if (cancelled) void handle.remove();
      else remove = () => void handle.remove();
    })();

    return () => {
      cancelled = true;
      remove?.();
    };
  }, []);

  return null;
}
