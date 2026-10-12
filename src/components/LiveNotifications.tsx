"use client";

/**
 * Notifications as they happen, not at the next refresh.
 *
 * Every notification row fans out from the database over Realtime Broadcast
 * (supabase/migrations/*_notifications_everywhere.sql) on private channels:
 * one per company and role, one per person. This joins the ones the signed-in
 * person may hear — the same audience rule as the feed (lib/notify isForMe),
 * enforced again by the policy on realtime.messages — and hands each arrival
 * to the store, where the bell, the tray and the browser pick it up like any
 * other.
 *
 * Mounted once at the root, beside the other quiet workers. Without a
 * backend, or in the demonstration, there is nothing to listen to.
 */

import { useEffect } from "react";
import { useWorkforce } from "@/lib/store";
import { isLiveBackend, supabase } from "@/lib/supabase/client";
import { demoActive } from "@/lib/demo/mode";
import type { AppNotification, Role } from "@/lib/types";

/** The topics this member may hear. Kept in step with private.may_receive_topic. */
export function topicsFor(role: Role, orgId: string | undefined, userId: string): string[] {
  const topics = [`notify:u:${userId}`];
  if (orgId) {
    topics.push(`notify:o:${orgId}:${role}`);
    // Administrators also read the managers' feed.
    if (role === "admin" || role === "superadmin") topics.push(`notify:o:${orgId}:manager`);
  }
  return topics;
}

interface Wire {
  id: string;
  org_id: string;
  audience: Role;
  user_id: string | null;
  kind: AppNotification["kind"];
  title: string;
  body: string;
  severity: AppNotification["severity"];
  link: string | null;
  at: string;
}

function fromWire(w: Wire): AppNotification {
  const at = Date.parse(w.at);
  return {
    id: w.id,
    audience: w.audience,
    userId: w.user_id ?? undefined,
    kind: w.kind,
    title: w.title,
    body: w.body,
    severity: w.severity,
    link: w.link ?? undefined,
    at: Number.isFinite(at) ? at : Date.now(),
    read: false,
  };
}

export function LiveNotifications() {
  const { state, currentUser, receiveNotifications } = useWorkforce();
  const role = state?.session?.role;
  const userId = state?.session?.userId;
  const orgId = currentUser?.orgId;

  useEffect(() => {
    // Not before the company is known: every row is checked against it.
    if (!isLiveBackend || demoActive() || !role || !userId || !orgId) return;
    const sb = supabase();
    if (!sb) return;
    let cancelled = false;
    const channels: ReturnType<typeof sb.channel>[] = [];

    void (async () => {
      // Private channels are authorised by the signed-in person's token.
      await sb.realtime.setAuth();
      if (cancelled) return;
      for (const topic of topicsFor(role, orgId, userId)) {
        const ch = sb
          .channel(topic, { config: { private: true } })
          .on("broadcast", { event: "notification" }, (msg) => {
            // A channel being left still hears until the server agrees; after
            // a company switch, those last messages belong to the old one.
            if (cancelled) return;
            const w = msg.payload as Wire | undefined;
            // Only this company's rows join this company's feed. The database
            // already sends nothing else on these topics; this is the second
            // lock on the same door.
            if (w?.id && w.title && w.org_id === orgId) receiveNotifications([fromWire(w)]);
          })
          .subscribe();
        channels.push(ch);
      }
    })();

    return () => {
      cancelled = true;
      for (const ch of channels) void sb.removeChannel(ch);
    };
  }, [role, userId, orgId, receiveNotifications]);

  return null;
}
