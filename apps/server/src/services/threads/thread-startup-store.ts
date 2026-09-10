import { z } from "zod";
import { threads, type DbConnection, type DbTransaction } from "@bb/db";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { persistedThreadProvisionContextSchema } from "./thread-provisioning-context.js";
import type {
  ThreadProvisionContext,
  ThreadProvisionProviderAsk,
} from "./thread-provisioning-context.js";

const providerSchedules = new Map<
  string,
  {
    provisioningId: string;
    environmentProviderId: string;
    runtime: ThreadProvisionProviderAsk["runtime"];
  }
>();

export function saveThreadProvisionContext(entry: {
  db: DbConnection | DbTransaction;
  replace: boolean;
  context: ThreadProvisionContext;
  threadId: string;
}): void {
  const ask = entry.context.state.providerAsk;
  const previous = providerSchedules.get(entry.threadId);
  if (
    !persistThreadProvisionContext(
      entry.db,
      entry.threadId,
      entry.context,
      entry.replace,
    )
  ) {
    if (
      ask !== null &&
      ask.runtime !== previous?.runtime &&
      ask.runtime.nextAskTimer !== null
    )
      clearTimeout(ask.runtime.nextAskTimer);
    return;
  }
  if (previous?.runtime !== ask?.runtime)
    clearThreadProvisionSchedule(entry.threadId);
  if (ask !== null)
    providerSchedules.set(entry.threadId, {
      provisioningId: entry.context.state.provisioningId,
      environmentProviderId: ask.environmentProviderId,
      runtime: ask.runtime,
    });
}

export function clearThreadProvisionSchedule(threadId: string): void {
  const schedule = providerSchedules.get(threadId);
  if (schedule !== undefined) {
    if (schedule.runtime.nextAskTimer !== null)
      clearTimeout(schedule.runtime.nextAskTimer);
    schedule.runtime.nextAskTimer = null;
  }
  providerSchedules.delete(threadId);
}

export function clearAllThreadProvisionSchedules(): void {
  for (const threadId of providerSchedules.keys())
    clearThreadProvisionSchedule(threadId);
}

export function getThreadProvisionContext(
  db: DbConnection | DbTransaction,
  threadId: string,
): ThreadProvisionContext | null {
  const thread = db
    .select({ status: threads.status })
    .from(threads)
    .where(eq(threads.id, threadId))
    .get();
  return thread?.status === "starting" || thread?.status === "stopping"
    ? readThreadProvisionContext(db, threadId)
    : null;
}

export function listThreadProvisionSchedules() {
  return [...providerSchedules].map(([threadId, schedule]) => ({
    threadId,
    ...schedule,
  }));
}

function persistThreadProvisionContext(
  db: DbConnection | DbTransaction,
  threadId: string,
  context: ThreadProvisionContext,
  replace: boolean,
): boolean {
  const persisted = persistedThreadProvisionContextSchema.parse(context);
  return (
    db
      .update(threads)
      .set({
        startupContext: JSON.stringify({ kind: "provisioning", ...persisted }),
      })
      .where(
        and(
          eq(threads.id, threadId),
          eq(threads.status, "starting"),
          replace
            ? undefined
            : or(
                isNull(threads.startupContext),
                sql`json_extract(${threads.startupContext}, '$.kind') = 'provisioning' AND json_extract(${threads.startupContext}, '$.state.provisioningId') = ${context.state.provisioningId}`,
              ),
        ),
      )
      .run().changes > 0
  );
}

export function readThreadProvisionContext(
  db: DbConnection | DbTransaction,
  threadId: string,
): ThreadProvisionContext | null {
  const stored = db
    .select({ value: threads.startupContext })
    .from(threads)
    .where(eq(threads.id, threadId))
    .get()?.value;
  if (stored === null || stored === undefined) return null;
  const value: unknown = JSON.parse(stored);
  const header = z
    .object({ kind: z.enum(["pending", "provisioning", "dispatched"]) })
    .parse(value);
  if (header.kind !== "provisioning") return null;
  const context = persistedThreadProvisionContextSchema.parse(value);
  const schedule = providerSchedules.get(threadId);
  return {
    ...context,
    state: {
      ...context.state,
      providerAsk:
        context.state.providerAsk === null
          ? null
          : {
              ...context.state.providerAsk,
              runtime:
                schedule?.provisioningId === context.state.provisioningId
                  ? schedule.runtime
                  : { nextAskTimer: null, recheckRequested: false },
            },
    },
  };
}
