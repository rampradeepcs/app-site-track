"use client";

/**
 * This device, as somewhere notifications arrive.
 *
 * Three kinds of device, one switch each:
 *
 *   * A browser shows them through the service worker — while the site is
 *     open, in a background tab, and, once subscribed to Web Push, with the
 *     site closed altogether.
 *   * The Android and iOS apps post them to the tray while running (that
 *     part is lib/notify.ts) and, with Firebase and Apple Push set up, are
 *     woken by a push when closed. That needs project credentials this repo
 *     does not have, so it stays off until NEXT_PUBLIC_NATIVE_PUSH=1 is set
 *     at build time — registering without them crashes an Android app at
 *     launch rather than merely failing.
 *
 * The switch is per device and kept on the device: turning notifications off
 * on a shared site tablet should not silence the supervisor's own phone.
 * What each kind of event does is the person's choice, kept on the person —
 * see notification-prefs.ts.
 *
 * Permission is only ever asked from a tap: the switch, or — in the phone
 * apps — the person's own check-in raising their first notification. A
 * prompt that appears because somebody opened a screen, or because a
 * colleague did something elsewhere, is a prompt they decline, and a browser
 * or an iPhone remembers a decline for good.
 */

import { Capacitor } from "@capacitor/core";
import type { AppNotification } from "./types";
import { isLiveBackend, supabase } from "./supabase/client";
import { demoActive } from "./demo/mode";
import { askNotificationPermission, isAppLink, postNative, prepareChannels } from "./notify";

export type DeviceState = "unsupported" | "blocked" | "off" | "on";

/** Closed-app push on the phones: off until Firebase / Apple Push exist. */
export const NATIVE_PUSH = process.env.NEXT_PUBLIC_NATIVE_PUSH === "1";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const SWITCH_KEY = "workfence.device-notifications";

const live = () => isLiveBackend && !demoActive();

export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/* ------------------------------------------------------ the switch ---- */

/** Off only when somebody turned it off here; on by default. */
function switchedOn(): boolean {
  try {
    return localStorage.getItem(SWITCH_KEY) !== "off";
  } catch {
    return true;
  }
}

function setSwitch(on: boolean): void {
  try {
    localStorage.setItem(SWITCH_KEY, on ? "on" : "off");
  } catch {
    /* without storage the default (on) applies */
  }
}

/* ------------------------------------------------- the service worker -- */

/**
 * The one worker: map tiles and notifications. Registered under the site's
 * base path, so a build served from a sub-path (GitHub Pages) finds it.
 */
let registration: Promise<ServiceWorkerRegistration | null> | null = null;

export function serviceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (registration) return registration;
  registration = (async () => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
    // A worker needs a secure context: https anywhere, or localhost.
    if (!window.isSecureContext) return null;
    try {
      await navigator.serviceWorker.register(`${BASE}/sw.js`, { scope: `${BASE}/` });
      const reg = await navigator.serviceWorker.ready;
      // Known from the browser alone, with no server: this device's push
      // address, for marking what it raises (thisDeviceEndpoint).
      try {
        webEndpoint = (await reg.pushManager?.getSubscription())?.endpoint ?? null;
      } catch {
        /* no push here */
      }
      return reg;
    } catch {
      return null;
    }
  })();
  return registration;
}

function webSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    window.isSecureContext
  );
}

function webPushSupported(): boolean {
  return webSupported() && "PushManager" in window;
}

/* ------------------------------------------------------------ state ---- */

export async function deviceState(): Promise<DeviceState> {
  if (isNativeApp()) {
    try {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      const p = await LocalNotifications.checkPermissions();
      if (p.display === "denied") return "blocked";
      if (p.display !== "granted") return "off";
      return switchedOn() ? "on" : "off";
    } catch {
      return "unsupported";
    }
  }
  if (!webSupported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission !== "granted") return "off";
  return switchedOn() ? "on" : "off";
}

/**
 * Whether this device hears about things with the app closed: "on" once it is
 * registered for push, "off" when it could be, "unavailable" when this build
 * or browser cannot be pushed to at all.
 */
export async function pushState(): Promise<"on" | "off" | "unavailable"> {
  if (!live()) return "unavailable";
  if (isNativeApp()) {
    if (!NATIVE_PUSH) return "unavailable";
    const platform = Capacitor.getPlatform() === "ios" ? "apns" : "fcm";
    return nativeToken && nativeServed?.[platform] ? "on" : "off";
  }
  if (!webPushSupported()) return "unavailable";
  try {
    const reg = await serviceWorker();
    if (!reg) return "unavailable";
    const sub = await reg.pushManager.getSubscription();
    webEndpoint = sub?.endpoint ?? null;
    return sub ? "on" : "off";
  } catch {
    return "unavailable";
  }
}

/** iPhone Safari outside a Home Screen app has no notifications at all. */
export function needsHomeScreen(): boolean {
  if (typeof navigator === "undefined" || isNativeApp()) return false;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches;
  return ios && !standalone;
}

/** Whether to show a notification here right now — synchronous, for the poster. */
export function deviceMayShow(): boolean {
  if (!switchedOn()) return false;
  if (isNativeApp()) return true; // notify.ts asks the OS itself
  return webSupported() && Notification.permission === "granted";
}

/* --------------------------------------------------------- on and off -- */

/**
 * Turn this device on: ask permission (this must be called from a tap),
 * then register for push so it hears with the app closed too. Push is best
 * effort — a device that can show notifications but not receive pushes
 * still gets them while open, and the answer says which.
 */
export async function enableDevice(): Promise<{ state: DeviceState; push: boolean; error?: string }> {
  setSwitch(true);
  if (isNativeApp()) {
    const ok = await askNotificationPermission();
    if (!ok) return { state: await deviceState(), push: false };
    if (!NATIVE_PUSH || !live()) return { state: "on", push: false };
    const push = await registerNativePush();
    return { state: "on", push: push.ok, error: push.error };
  }
  if (!webSupported()) return { state: "unsupported", push: false };
  const answer = await Notification.requestPermission();
  if (answer !== "granted") return { state: await deviceState(), push: false };
  if (!live() || !webPushSupported()) return { state: "on", push: false };
  try {
    await subscribeWebPush();
    return { state: "on", push: true };
  } catch (e) {
    return { state: "on", push: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function disableDevice(): Promise<DeviceState> {
  setSwitch(false);
  try {
    if (isNativeApp()) {
      if (NATIVE_PUSH) await unregisterNativePush();
    } else if (webPushSupported()) {
      const reg = await serviceWorker();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await unregisterEndpoint(sub.endpoint);
        await sub.unsubscribe();
        webEndpoint = null;
      }
    }
  } catch {
    /* the switch is off either way; the server forgets a dead endpoint itself */
  }
  return deviceState();
}

/**
 * This device stops hearing about the person signing out.
 *
 * Signing out ("signout", while the session is still valid) removes the
 * server's record of this device for them, and keeps the browser's own
 * subscription, so the next person to sign in is registered without a new
 * permission prompt — Safari will not subscribe again without a tap. A
 * session that ended by itself ("ended": expired or revoked, so the server
 * will not take the call) instead drops the subscription here; the push
 * service then refuses the next push and the server forgets the device.
 *
 * Bounded in time either way: a phone at a gate with no signal must still be
 * able to sign out.
 */
/*
 * When a sign-out last finished releasing this device. Kept in storage, not
 * only here: every open tab hears the sign-out as its session ending, and a
 * tab that did not do the sign-out must not tear down what it kept.
 */
const RELEASED_KEY = "workfence.device-released-at";
let releasedAt = 0;

function releasedRecently(): boolean {
  let stored = 0;
  try {
    stored = Number(localStorage.getItem(RELEASED_KEY)) || 0;
  } catch {
    /* this tab's own record still counts */
  }
  return Date.now() - Math.max(releasedAt, stored) < 60_000;
}

export async function forgetThisDevice(how: "signout" | "ended"): Promise<void> {
  if (!live()) return;
  // The ending that follows a sign-out is that sign-out, already handled —
  // but only if it was: a sign-out that could not finish leaves this to the
  // ending, which then drops the subscription here.
  if (how === "ended" && releasedRecently()) return;
  // Work abandoned at the time limit must not act later on somebody else's
  // registration, so it works on the addresses as they were at the start and
  // stops at the first step after it was given up on.
  let abandoned = false;
  const token = deviceToken;
  const work = (async (): Promise<boolean> => {
    try {
      if (isNativeApp()) {
        if (!NATIVE_PUSH) return true;
        // Asking the server first keeps the token for the next person; when
        // the server cannot be reached, or the token was never learned this
        // launch, the phone gives the token up instead.
        const told = how === "signout" && token !== null && (await unregisterEndpoint(token));
        if (abandoned) return false;
        if (!told) {
          const { PushNotifications } = await import("@capacitor/push-notifications");
          if (abandoned) return false;
          await PushNotifications.unregister();
        }
        if (deviceToken === token) {
          deviceToken = null;
          nativeToken = null;
        }
        return true;
      }
      if (!webPushSupported()) return true;
      const reg = await serviceWorker();
      const sub = await reg?.pushManager.getSubscription();
      if (!sub) return true;
      if (abandoned) return false;
      const told = how === "signout" && (await unregisterEndpoint(sub.endpoint));
      if (abandoned) return false;
      if (!told) await sub.unsubscribe();
      if (webEndpoint === sub.endpoint) webEndpoint = null;
      return true;
    } catch {
      return false;
    }
  })();
  const done = await Promise.race([
    work,
    new Promise<boolean>((r) =>
      setTimeout(() => {
        abandoned = true;
        r(false);
      }, 3000),
    ),
  ]);
  if (how === "signout" && done) {
    releasedAt = Date.now();
    try {
      localStorage.setItem(RELEASED_KEY, String(releasedAt));
    } catch {
      /* this tab's own record still counts */
    }
  }
}

/**
 * This device's push address, sent with every notification it raises so the
 * server does not push that one back here — the device already showed it.
 */
let webEndpoint: string | null = null;

export function thisDeviceEndpoint(): string | null {
  return isNativeApp() ? deviceToken : webEndpoint;
}

/**
 * On every sign-in with the switch on and permission given, make sure this
 * device is registered to the person now signed in. Endpoints change (a
 * browser rotates them; a phone gets a new token after a reinstall), and a
 * shared device must push to whoever is using it now.
 */
let registrationFailed = false;

export async function refreshDeviceRegistration(): Promise<void> {
  if (!live() || !switchedOn()) return;
  try {
    if (isNativeApp()) {
      if (NATIVE_PUSH && (await deviceState()) === "on") {
        const r = await registerNativePush();
        registrationFailed = !r.ok && r.error !== "The server can't push to this phone yet.";
      }
      return;
    }
    if (webPushSupported() && Notification.permission === "granted") await subscribeWebPush();
    registrationFailed = false;
  } catch {
    // The previous registration stays in place; try again when the
    // connection comes back (retryDeviceRegistration).
    registrationFailed = true;
  }
}

/** A launch-time registration that failed — offline at the gate — once back online. */
export function retryDeviceRegistration(): void {
  if (registrationFailed) void refreshDeviceRegistration();
}

/* ----------------------------------------------------------- browsers -- */

let vapidKey: Promise<string> | null = null;
/** Whether the server can push to Android and to iOS — from the push function. */
let nativeServed: { fcm: boolean; apns: boolean } | null = null;

async function askServer(): Promise<{ publicKey: string; native?: { fcm: boolean; apns: boolean } }> {
  const sb = supabase();
  if (!sb) throw new Error("No backend to push from.");
  const res = await sb.functions.invoke<{
    publicKey: string;
    native?: { fcm: boolean; apns: boolean };
  }>("push", { method: "GET" });
  if (res.error || !res.data?.publicKey) throw new Error("Push isn't set up on the server yet.");
  if (res.data.native) nativeServed = res.data.native;
  return res.data;
}

/** The server's public signing key, which a browser subscribes with. */
function serverKey(): Promise<string> {
  vapidKey ??= (async () => {
    const sb = supabase();
    if (!sb) throw new Error("No backend to push from.");
    const { data } = await sb.rpc("push_vapid_public_key");
    if (typeof data === "string" && data) return data;
    // Not made yet: the push function makes it on first request.
    return (await askServer()).publicKey;
  })().catch((e) => {
    vapidKey = null;
    throw e;
  });
  return vapidKey;
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const bin = atob(b64url.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function subscribeWebPush(): Promise<void> {
  const reg = await serviceWorker();
  if (!reg) throw new Error("This browser can't receive push.");
  const key = await serverKey();
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with another key (the server's was replaced) cannot
  // be pushed to; start again.
  if (sub) {
    const current = sub.options.applicationServerKey;
    const same =
      current &&
      btoa(String.fromCharCode(...new Uint8Array(current)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "") === key;
    if (!same) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  sub ??= await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(key),
  });
  webEndpoint = sub.endpoint;
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  const sb = supabase();
  if (!sb || !json.endpoint) throw new Error("This browser can't receive push.");
  const { error } = await sb.rpc("register_push_subscription", {
    p_platform: "web",
    p_endpoint: json.endpoint,
    p_p256dh: json.keys?.p256dh ?? null,
    p_auth: json.keys?.auth ?? null,
    p_user_agent: navigator.userAgent,
  });
  if (error) throw error;
}

/** Whether the server confirmed it; a failed request resolves, it does not throw. */
async function unregisterEndpoint(endpoint: string): Promise<boolean> {
  const sb = supabase();
  if (!sb || !live()) return false;
  const { error } = await sb.rpc("unregister_push_subscription", { p_endpoint: endpoint });
  return !error;
}

/**
 * Show these as browser notifications. Tagged with the notification's id, so
 * the copy that arrives by push and the copy posted here are one
 * notification, never two.
 */
export async function showInBrowser(items: readonly AppNotification[]): Promise<number> {
  if (isNativeApp() || !deviceMayShow() || items.length === 0) return 0;
  const reg = await serviceWorker();
  if (!reg) return 0;
  let shown = 0;
  for (const n of items) {
    try {
      await reg.showNotification(n.title, {
        body: n.body,
        tag: n.id,
        icon: `${BASE}/icon.svg`,
        data: { link: n.link ?? null },
      });
      shown++;
    } catch {
      /* one that will not show must not stop the rest */
    }
  }
  return shown;
}

/**
 * One notification to show the switch works, posted the way real ones are.
 * Not in the feed and not pushed: it proves this device, nothing else.
 */
export async function showTestNotification(): Promise<boolean> {
  const n: AppNotification = {
    id: `test-${Date.now()}`,
    audience: "employee",
    kind: "sync",
    title: "Notifications are on",
    body: "This is how Workfence will tell you when something needs you.",
    at: Date.now(),
    read: true,
    severity: "info",
  };
  // A tap on the test button is somebody asking, so it may prompt.
  if (isNativeApp()) return (await postNative([n], Date.now(), undefined, true)) > 0;
  return (await showInBrowser([n])) > 0;
}

/* -------------------------------------------------------------- phones -- */

/** The token the phone gave — this device's address, server or no server. */
let deviceToken: string | null = null;
/** The same token, once the server has it: something that can be pushed to. */
let nativeToken: string | null = null;

/**
 * Ask the OS for a push token and hand it to the server. Firebase on
 * Android, Apple Push on iOS; the token arrives through a listener, so the
 * answer is awaited from it.
 */
async function registerNativePush(): Promise<{ ok: boolean; error?: string }> {
  const { PushNotifications } = await import("@capacitor/push-notifications");
  const perm = await PushNotifications.requestPermissions();
  if (perm.receive !== "granted") return { ok: false, error: "Permission was not given." };
  // The channels a push names have to exist before the first one arrives.
  await prepareChannels();
  const handles: { remove: () => Promise<void> }[] = [];
  let token: string;
  try {
    token = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("No push token from the phone.")), 15_000);
      void PushNotifications.addListener("registration", (t) => {
        clearTimeout(timer);
        resolve(t.value);
      }).then((h) => handles.push(h));
      void PushNotifications.addListener("registrationError", (e) => {
        clearTimeout(timer);
        reject(new Error(e.error));
      }).then((h) => handles.push(h));
      void PushNotifications.register();
    });
  } finally {
    // One registration, one pair of listeners — not a pair per sign-in.
    for (const h of handles) void h.remove();
  }
  deviceToken = token;
  const sb = supabase();
  if (!sb) return { ok: false };
  const platform = Capacitor.getPlatform() === "ios" ? "apns" : "fcm";
  const { error } = await sb.rpc("register_push_subscription", {
    p_platform: platform,
    p_endpoint: token,
    p_user_agent: `${Capacitor.getPlatform()} app`,
  });
  if (error) return { ok: false, error: error.message };
  // Only now is this phone something the server can push to — and only if
  // the server has this platform's credentials, which it says when asked.
  nativeToken = token;
  try {
    await askServer();
  } catch {
    nativeServed = null;
  }
  return nativeServed?.[platform]
    ? { ok: true }
    : { ok: false, error: "The server can't push to this phone yet." };
}

async function unregisterNativePush(): Promise<void> {
  const token = deviceToken;
  if (token) await unregisterEndpoint(token);
  const { PushNotifications } = await import("@capacitor/push-notifications");
  await PushNotifications.unregister();
  if (deviceToken === token) {
    deviceToken = null;
    nativeToken = null;
  }
}

/**
 * Whether a push will already show this on a phone, so the app should not
 * post its own copy. A browser merges the two by tag; Android and iOS cannot,
 * so the phone picks one: its own copy while the app is in front (the OS
 * holds pushes back then), the push once the app is in the background.
 */
export function pushWillShow(): boolean {
  if (!isNativeApp() || !NATIVE_PUSH || nativeToken === null || !nativeServed) return false;
  const platform = Capacitor.getPlatform() === "ios" ? "apns" : "fcm";
  return (
    nativeServed[platform] &&
    typeof document !== "undefined" &&
    document.visibilityState !== "visible"
  );
}

/**
 * Where tapping a pushed notification goes, once the app is open. Only when
 * native push is on; the tray's own taps are lib/notify.ts.
 */
export async function onPushTap(go: (link: string) => void): Promise<() => void> {
  if (!isNativeApp() || !NATIVE_PUSH) return () => {};
  const { PushNotifications } = await import("@capacitor/push-notifications");
  const handle = await PushNotifications.addListener("pushNotificationActionPerformed", (a) => {
    const link = (a.notification.data as { link?: string } | undefined)?.link;
    if (isAppLink(link)) go(link);
  });
  return () => void handle.remove();
}

/**
 * A push that lands while the app is open. The OS does not show it then —
 * the app is expected to have it already, live — so one that the app does
 * not have (it is for another of this person's companies, or the live
 * connection was down) is handed over to be posted like any other.
 */
export async function onPushReceived(
  take: (n: AppNotification) => void,
): Promise<() => void> {
  if (!isNativeApp() || !NATIVE_PUSH) return () => {};
  const { PushNotifications } = await import("@capacitor/push-notifications");
  const handle = await PushNotifications.addListener("pushNotificationReceived", (p) => {
    const data = (p.data ?? {}) as { id?: string; link?: string; kind?: string; severity?: string };
    if (!data.id) return;
    const severities = ["info", "success", "warning", "critical"] as const;
    take({
      id: data.id,
      audience: "employee",
      kind: (data.kind ?? "sync") as AppNotification["kind"],
      title: p.title ?? "Workfence",
      body: p.body ?? "",
      at: Date.now(),
      read: false,
      severity: severities.find((v) => v === data.severity) ?? "info",
      link: isAppLink(data.link) ? data.link : undefined,
    });
  });
  return () => void handle.remove();
}
