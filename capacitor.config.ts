import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor wrapper for the Workfence employee app.
 *
 * The Next.js app is exported statically into `out/` and served from the
 * device, so the shell works offline — which matters here: a worker on a
 * site with no signal still needs to check in, and the outbox syncs later.
 */
const config: CapacitorConfig = {
  appId: "app.workfence.workforce",
  appName: "Workfence",
  webDir: "out",
  // The web layer talks to Supabase over HTTPS; nothing is served cleartext.
  android: {
    allowMixedContent: false,
  },
  plugins: {
    Geolocation: {
      // Matches the in-app sampling default; the platform owner can lower it
      // per client from Platform Settings.
      enableHighAccuracy: true,
    },
    PushNotifications: {
      // A push that lands while the app is open is shown by the app itself,
      // from the live feed, so the OS must not show a second copy.
      presentationOptions: [],
    },
  },
};

export default config;
