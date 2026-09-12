import { z } from "zod";
import {
  createThreadProvisioningId,
  getThreadStartupContext,
  threads,
  type DbConnection,
  type DbTransaction,
} from "@bb/db";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import {
  environmentMachineSelectionSchema,
  jsonValueSchema,
  promptInputSchema,
  resolvedThreadExecutionOptionsSchema,
  clientTurnRequestIdSchema,
} from "@bb/domain";

const reuseIntentSchema = z.object({
  type: z.literal("reuse"),
  environmentId: z.string().min(1),
});

const providerIntentSchema = z.object({
  type: z.literal("provider"),
  environmentProviderId: z.string().min(1),
  machine: environmentMachineSelectionSchema,
  inputs: jsonValueSchema.nullable(),
  selectionResolved: z.boolean().default(true),
});

export const threadProvisionEnvironmentIntentSchema = z.discriminatedUnion(
  "type",
  [reuseIntentSchema, providerIntentSchema],
);

export const threadForkDescriptorSchema = z.object({
  sourceProviderThreadId: z.string().min(1),
  sourceProviderCheckpointId: z.string().min(1).optional(),
});

export const threadProvisionCommonPayloadSchema = z.object({
  clientRequestId: clientTurnRequestIdSchema,
  environmentIntent: threadProvisionEnvironmentIntentSchema,
  execution: resolvedThreadExecutionOptionsSchema,
  fork: threadForkDescriptorSchema.nullable().default(null),
  input: z.array(promptInputSchema),
  inputGroups: z.array(z.array(promptInputSchema).min(1)).min(1).optional(),
  titleProvided: z.boolean(),
  seedWithoutRun: z.boolean().default(false),
});

export type ThreadForkDescriptor = z.infer<typeof threadForkDescriptorSchema>;
export type ThreadProvisionEnvironmentIntent = z.infer<
  typeof threadProvisionEnvironmentIntentSchema
>;
type ThreadProvisionOperationPayload = z.infer<
  typeof threadProvisionCommonPayloadSchema
>;

interface ThreadProvisioningState {
  environmentId: string | null;
  provisionEventSequence: number | null;
  provisioningId: string;
  workspaceReadyEventSequence: number | null;
}

export interface ThreadProvisionContext {
  request: ThreadProvisionOperationPayload;
  state: ThreadProvisioningState;
}

export const persistedThreadProvisionContextSchema = z.object({
  request: threadProvisionCommonPayloadSchema,
  state: z.object({
    environmentId: z.string().nullable(),
    provisionEventSequence: z.number().nullable(),
    provisioningId: z.string(),
    workspaceReadyEventSequence: z.number().nullable(),
  }),
});

const providerSchedules = new Map<
  string,
  {
    provisioningId: string;
    environmentProviderId: string;
    timer: NodeJS.Timeout;
  }
>();

export function saveThreadProvisionContext(entry: {
  db: DbConnection | DbTransaction;
  replace: boolean;
  context: ThreadProvisionContext;
  threadId: string;
}): void {
  if (
    !persistThreadProvisionContext(
      entry.db,
      entry.threadId,
      entry.context,
      entry.replace,
    )
  )
    return;
  const existing = providerSchedules.get(entry.threadId);
  if (
    existing !== undefined &&
    (existing.provisioningId !== entry.context.state.provisioningId ||
      entry.context.request.environmentIntent.type === "reuse")
  )
    clearThreadProvisionSchedule(entry.threadId);
}

export function setThreadProvisionSchedule(
  threadId: string,
  schedule: {
    provisioningId: string;
    environmentProviderId: string;
    timer: NodeJS.Timeout;
  },
): void {
  clearThreadProvisionSchedule(threadId);
  providerSchedules.set(threadId, schedule);
}

export function clearThreadProvisionSchedule(threadId: string): void {
  const schedule = providerSchedules.get(threadId);
  if (schedule !== undefined) clearTimeout(schedule.timer);
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

export function readThreadStartupContextOfKind<T>(
  db: DbConnection | DbTransaction,
  threadId: string,
  kind: "pending" | "provisioning",
  schema: z.ZodType<T>,
): T | null {
  const stored = getThreadStartupContext(db, threadId);
  if (stored === null) return null;
  const value: unknown = JSON.parse(stored);
  const header = z
    .object({ kind: z.enum(["pending", "provisioning", "dispatched"]) })
    .parse(value);
  if (header.kind !== kind) return null;
  return schema.parse(value);
}

export function readThreadProvisionContext(
  db: DbConnection | DbTransaction,
  threadId: string,
): ThreadProvisionContext | null {
  return readThreadStartupContextOfKind(
    db,
    threadId,
    "provisioning",
    persistedThreadProvisionContextSchema,
  );
}

export function createThreadStartup(
  request: ThreadProvisionContext["request"],
): ThreadProvisionContext {
  return {
    request: threadProvisionCommonPayloadSchema.parse(request),
    state: {
      environmentId: null,
      provisioningId: createThreadProvisioningId(),
      provisionEventSequence: null,
      workspaceReadyEventSequence: null,
    },
  };
}
