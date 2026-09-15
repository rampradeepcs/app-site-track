"use client";

/**
 * The phone's half of the watch.
 *
 * Capacitor carries this: a small native plugin on each platform publishes
 * the snapshot to the paired watch and forwards what the watch asks back.
 * On the web, and on a device with no watch, every call here is a no-op —
 * the plugin is simply absent, and nothing above needs to know.
 *
 * Deliberately one-way plus commands, rather than a shared store. A watch is
 * a screen at the end of a Bluetooth link that is often not there; the only
 * design that survives that is "here is the state, ask me if you want
 * something", which is what this is.
 */

import { registerPlugin } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";
import {
  WATCH_PROTOCOL,
  emptySnapshot,
  type WatchCommand,
  type WatchReply,
  type WatchSnapshot,
} from "./contract";

export interface WatchPlugin {
  /** Is a watch paired and reachable? Cheap enough to ask on every publish. */
  isReachable(): Promise<{ reachable: boolean }>;
  /** Replace the snapshot the watch holds. Last write wins. */
  publish(options: { snapshot: string }): Promise<void>;
  /** A command from the wrist. */
  addListener(
    event: "command",
    fn: (data: { command: WatchCommand; id: string }) => void,
  ): Promise<PluginListenerHandle>;
  /** Answer a command by the id it arrived with. */
  reply(options: { id: string; ok: boolean; reason?: string }): Promise<void>;
}

/*
 * `registerPlugin` never throws: on a platform with no implementation it
 * hands back a proxy whose calls reject. That is the right shape here — the
 * caller checks once and stops asking.
 */
const Watch = registerPlugin<WatchPlugin>("Watch");

let available: boolean | null = null;

/** Is there a native watch bridge on this build at all? Asked once. */
export async function watchAvailable(): Promise<boolean> {
  if (available !== null) return available;
  try {
    await Watch.isReachable();
    available = true;
  } catch {
    // Web, or a device build without the plugin. Both mean: do nothing.
    available = false;
  }
  return available;
}

/**
 * Hand the watch a new snapshot.
 *
 * Serialised here rather than passed as an object because the bridge carries
 * strings across to both platforms, and one encoder on this side is easier
 * to keep in step with two decoders than three shapes are.
 */
export async function publishToWatch(snapshot: WatchSnapshot): Promise<void> {
  if (!(await watchAvailable())) return;
  try {
    await Watch.publish({ snapshot: JSON.stringify({ ...snapshot, v: WATCH_PROTOCOL }) });
  } catch {
    /* A watch that is not listening is the normal case, not an error. */
  }
}

/**
 * Listen for what the wrist asks for.
 *
 * The handler answers with a WatchReply, and that answer is what the watch
 * shows — so it is written for a small screen by whoever knows the rule that
 * refused, not turned into a generic failure here.
 */
export async function onWatchCommand(
  handler: (command: WatchCommand) => Promise<WatchReply> | WatchReply,
): Promise<() => void> {
  if (!(await watchAvailable())) return () => {};
  let handle: PluginListenerHandle | null = null;
  try {
    handle = await Watch.addListener("command", async ({ command, id }) => {
      let reply: WatchReply;
      try {
        reply = await handler(command);
      } catch {
        reply = { ok: false, reason: "Couldn't do that. Open the app." };
      }
      try {
        await Watch.reply({ id, ok: reply.ok, reason: reply.reason });
      } catch {
        /* The watch went away mid-answer. It will ask again on wake. */
      }
    });
  } catch {
    return () => {};
  }
  return () => void handle?.remove();
}

export { emptySnapshot };
