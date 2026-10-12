"use client";

/**
 * Notifications, in Settings — the same panel for every role.
 *
 * Two halves, because they are two different decisions. "This device" is
 * whether this phone or browser may show anything at all, and it lives on the
 * device: silencing a shared site tablet must not silence a supervisor's own
 * phone. "What to tell me about" is per kind of event and per place it lands,
 * and it lives on the person, so it follows them to every device and the push
 * server reads the same answer.
 *
 * Permission is asked from the switch and nowhere else. A browser that has
 * been told no keeps saying no, so the prompt is only worth spending when
 * somebody has just asked for it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Chip, SectionTitle, Toggle } from "@/components/ui";
import { IBell } from "@/components/WfIcons";
import {
  CATEGORIES,
  setPref,
  useNotificationPrefs,
  type NotificationCategory,
  type NotificationChannel,
} from "@/lib/notification-prefs";
import {
  deviceState,
  disableDevice,
  enableDevice,
  isNativeApp,
  needsHomeScreen,
  pushState,
  refreshDeviceRegistration,
  showTestNotification,
  type DeviceState,
} from "@/lib/device-notifications";
import { showToast } from "@/lib/toast";

type Push = "on" | "off" | "unavailable";

export function NotificationSettings() {
  const prefs = useNotificationPrefs();
  const [device, setDevice] = useState<DeviceState | null>(null);
  const [push, setPush] = useState<Push>("unavailable");
  const [busy, setBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  const seen = useRef<DeviceState | null>(null);
  const refresh = useCallback(async () => {
    const [d, p] = await Promise.all([deviceState(), pushState()]);
    seen.current = d;
    setDevice(d);
    setPush(p);
  }, []);

  // Read on arrival, and again on coming back: the panel tells a blocked
  // person to allow notifications in settings and return, so returning has
  // to show the answer without a reload.
  useEffect(() => {
    let alive = true;
    const read = () => {
      void (async () => {
        const d = await deviceState();
        // Allowed just now in the browser's or phone's settings, outside the
        // app: register for push here, or nothing would until the next launch.
        if (d === "on" && (seen.current === "blocked" || seen.current === "off")) {
          await refreshDeviceRegistration();
        }
        seen.current = d;
        const p = await pushState();
        if (!alive) return;
        setDevice(d);
        setPush(p);
      })();
    };
    read();
    const onShow = () => {
      if (document.visibilityState === "visible") read();
    };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    let status: PermissionStatus | null = null;
    void navigator.permissions
      ?.query({ name: "notifications" as PermissionName })
      .then((st) => {
        if (!alive) return;
        status = st;
        st.addEventListener("change", read);
      })
      .catch(() => {});
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", onShow);
      status?.removeEventListener("change", read);
    };
  }, []);

  const flip = async (on: boolean) => {
    if (busy) return;
    setBusy(true);
    setPushError(null);
    try {
      if (on) {
        const r = await enableDevice();
        if (r.error) setPushError(r.error);
        if (r.state === "on") showToast("Notifications turned on for this device");
        else if (r.state === "blocked") showToast("Notifications are blocked — allow them in settings", "danger");
      } else {
        await disableDevice();
        showToast("Notifications turned off for this device", "info");
      }
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  const test = async () => {
    const shown = await showTestNotification();
    if (!shown) showToast("Couldn't show one — check this device's notification settings", "danger");
  };

  const toggle = (category: NotificationCategory, channel: NotificationChannel, value: boolean) => {
    setPref(category, channel, value).catch(() =>
      showToast("Couldn't save that — check your connection and try again", "danger"),
    );
  };

  const where = isNativeApp() ? "phone" : "browser";

  return (
    <div className="wf-card flex flex-col gap-4 p-4">
      <SectionTitle>Notifications</SectionTitle>

      {/* this device */}
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--wf-fill-2)] text-[var(--wf-amber)]">
          <IBell size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            On this {where}
            {device === "on" ? (
              <Chip tone="green">On</Chip>
            ) : device === "blocked" ? (
              <Chip tone="red">Blocked</Chip>
            ) : device === "unsupported" ? (
              <Chip tone="neutral">Not available</Chip>
            ) : null}
          </p>
          <p className="mt-0.5 text-[0.72rem] leading-snug text-[var(--wf-muted)]">
            {deviceLine(device, push, where)}
          </p>
          {pushError ? (
            <p className="mt-1 text-[0.72rem] leading-snug text-[var(--wf-red)]">
              Shown while Workfence is open, but not when it&apos;s closed: {pushError}
            </p>
          ) : null}
          {device === "on" ? (
            <button
              type="button"
              className="wf-btn wf-btn-ghost mt-2 min-h-0 px-3 py-1.5 text-[0.78rem]"
              onClick={() => void test()}
            >
              Send a test notification
            </button>
          ) : null}
        </div>
        {device === "on" || device === "off" ? (
          <Toggle
            checked={device === "on"}
            onChange={(v) => void flip(v)}
            label={`Notifications on this ${where}`}
          />
        ) : null}
      </div>

      {/* what, and where */}
      <div>
        <div className="mb-1 grid grid-cols-[1fr_3.5rem_3.5rem] items-end gap-x-1 border-b border-[var(--wf-line)] pb-1.5">
          <p className="text-[0.68rem] font-bold uppercase tracking-wider text-[var(--wf-muted)]">
            Tell me about
          </p>
          <p className="text-center text-[0.66rem] font-semibold text-[var(--wf-muted)]">In app</p>
          <p className="text-center text-[0.66rem] font-semibold text-[var(--wf-muted)]">Devices</p>
        </div>
        {CATEGORIES.map((c) => (
          <div key={c.id} className="grid grid-cols-[1fr_3.5rem_3.5rem] items-center gap-x-1 py-1">
            <div className="min-w-0">
              <p className="text-[0.86rem] font-semibold leading-tight">{c.label}</p>
              <p className="text-[0.7rem] leading-snug text-[var(--wf-muted)]">{c.hint}</p>
            </div>
            <div className="grid place-items-center">
              <Toggle
                checked={prefs.categories[c.id].inApp}
                onChange={(v) => toggle(c.id, "inApp", v)}
                label={`${c.label} in the app`}
              />
            </div>
            <div className="grid place-items-center">
              <Toggle
                checked={prefs.categories[c.id].device}
                onChange={(v) => toggle(c.id, "device", v)}
                label={`${c.label} on your devices`}
              />
            </div>
          </div>
        ))}
        <p className="mt-2 text-[0.7rem] leading-snug text-[var(--wf-faint)]">
          In app is the list under the bell. Devices is your phone and browsers, with
          Workfence closed too. These choices follow you to every device you sign in on.
        </p>
      </div>
    </div>
  );
}

function deviceLine(device: DeviceState | null, push: Push, where: "phone" | "browser"): string {
  switch (device) {
    case null:
      return "Checking…";
    case "unsupported":
      return needsHomeScreen()
        ? "On iPhone and iPad, add Workfence to your Home Screen (Share → Add to Home Screen) and open it from there to turn these on."
        : `This ${where} can't show notifications.`;
    case "blocked":
      return where === "phone"
        ? "Blocked in your phone's settings. Allow notifications for Workfence there, then come back."
        : "Blocked for this site. Allow notifications in the browser's site settings, then come back.";
    case "off":
      return `Turn on to see alerts on this ${where} as they happen.`;
    case "on":
      return push === "on"
        ? "Alerts arrive even when Workfence is closed."
        : "Alerts show while Workfence is open or running in the background.";
  }
}
