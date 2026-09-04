"use client";

/**
 * Write what changed on the platform side to Postgres.
 *
 * The platform store mutates one immutable state object; a mutation replaces
 * the rows it touched and keeps every other row by reference. That makes
 * "what changed" a question of identity: any row in the new state that is
 * not the same object as the row with that id in the previous state was
 * touched, and is written. Audit entries are append-only, so a new id is a
 * new row.
 *
 * One routine for every mutation, rather than a call at each of twenty
 * sites, because the site that forgets to persist is the one that costs a
 * client their plan change.
 */

import type { PlatformState } from "../saas-types";
import {
  insertPlatformAudit,
  savePlatformSettings,
  upsertInvoice,
  upsertOrganization,
  upsertPlan,
  upsertSubscription,
  upsertTicket,
} from "./repository";

function changed<T extends { id: string }>(before: T[], after: T[]): T[] {
  const prior = new Map(before.map((x) => [x.id, x]));
  return after.filter((x) => prior.get(x.id) !== x);
}

export async function syncPlatformChanges(
  prev: PlatformState,
  next: PlatformState,
): Promise<void> {
  const jobs: Array<Promise<void>> = [];
  for (const o of changed(prev.organizations, next.organizations)) jobs.push(upsertOrganization(o));
  for (const p of changed(prev.plans, next.plans)) jobs.push(upsertPlan(p));
  for (const x of changed(prev.subscriptions, next.subscriptions)) jobs.push(upsertSubscription(x));
  for (const i of changed(prev.invoices, next.invoices)) jobs.push(upsertInvoice(i));
  for (const t of changed(prev.tickets, next.tickets)) jobs.push(upsertTicket(t));
  if (prev.platformSettings !== next.platformSettings) {
    jobs.push(savePlatformSettings(next.platformSettings));
  }
  const known = new Set(prev.platformAudit.map((e) => e.id));
  for (const e of next.platformAudit) {
    if (!known.has(e.id)) jobs.push(insertPlatformAudit(e));
  }
  if (jobs.length === 0) return;
  const results = await Promise.allSettled(jobs);
  const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed) throw failed.reason;
}
