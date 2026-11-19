import {
  hostStorageResponseSchema,
  hostStorageListResponseSchema,
  hostStorageRemoveOrphansResponseSchema,
  hostStorageRetryWorktreeCleanupResponseSchema,
  hostStorageRemoveExternalWorktreesResponseSchema,
  externalWorktreeSkipReasonSchema,
  cleanupInputSchema,
  entryCleanupInputSchema,
} from "./storage-types.js";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const daysSchema = z.number().int().min(1).max(3650).nullable();
export const policySchema = z
  .object({
    archiveAfterDays: daysSchema,
    coldStoreAfterDays: daysSchema.default(null),
    deleteAfterDays: daysSchema,
    deleteStorageOnArchive: z.boolean().default(false),
    deleteDevDataOnCheckoutRemoval: z.boolean().default(false),
  })
  .strict();
export type Policy = z.infer<typeof policySchema>;
export const runSchema = z.object({
  ranAt: z.number(),
  archivedCount: z.number().int().nonnegative(),
  coldStoredCount: z.number().int().nonnegative().default(0),
  deletedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
});
export type Run = z.infer<typeof runSchema>;
export const stateSchema = z.object({
  policy: policySchema,
  lastRun: runSchema.nullable(),
});
export type State = z.infer<typeof stateSchema>;
export const previewSchema = z.object({
  archiveCount: z.number().int().nonnegative(),
  coldStoreCount: z.number().int().nonnegative(),
  deleteCount: z.number().int().nonnegative(),
});
export type Preview = z.infer<typeof previewSchema>;
export const coldThreadSchema = z.object({
  threadId: z.string(),
  projectId: z.string(),
  title: z.string().nullable(),
  providerId: z.string(),
  threadCreatedAt: z.number(),
  archivedAt: z.number().nullable(),
  state: z.enum(["moving", "stored"]),
  storedAt: z.number().nullable(),
  fileBytes: z.number().int().nonnegative(),
});
export type ColdThread = z.infer<typeof coldThreadSchema>;
export const coldThreadListSchema = z.object({
  threads: z.array(coldThreadSchema),
  hasMore: z.boolean(),
  totalCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  movingCount: z.number().int().nonnegative(),
  lastStoredAt: z.number().nullable(),
});
export type ColdThreadList = z.infer<typeof coldThreadListSchema>;
export const coldThreadCursorSchema = z
  .object({ storedAt: z.number().nullable(), threadId: z.string().min(1) })
  .strict();
export type ColdThreadCursor = z.infer<typeof coldThreadCursorSchema>;
export const COLD_THREAD_LIST_MAX = 200;
const coldThreadInput = z.object({ threadId: z.string().min(1) }).strict();
const machineInput = z.object({ hostId: z.string().min(1) }).strict();
export const storageRpc = defineRpcContract({
  startEntryCleanup: {
    input: entryCleanupInputSchema,
    output: z.object({ id: z.string() }),
  },
  startCleanup: {
    input: cleanupInputSchema,
    output: z.null(),
  },
  hosts: { input: z.null(), output: hostStorageListResponseSchema },
  host: { input: machineInput, output: hostStorageResponseSchema },
  scanHost: { input: machineInput, output: hostStorageResponseSchema },
  scanAll: { input: z.null(), output: hostStorageListResponseSchema },
  removeOrphans: {
    input: machineInput,
    output: hostStorageRemoveOrphansResponseSchema,
  },
  retryWorktreeCleanup: {
    input: z
      .object({
        hostId: z.string().min(1),
        includeUncommitted: z.boolean(),
      })
      .strict(),
    output: hostStorageRetryWorktreeCleanupResponseSchema,
  },
  removeExternalWorktrees: {
    input: z.union([
      z.object({ hostId: z.string().min(1), paths: z.null() }).strict(),
      z
        .object({
          hostId: z.string().min(1),
          paths: z.array(z.string().min(1)).min(1).max(500),
          force: z.boolean(),
        })
        .strict(),
    ]),
    output: hostStorageRemoveExternalWorktreesResponseSchema,
  },
  startRemoveExternalWorktree: {
    input: z
      .object({
        hostId: z.string().min(1),
        path: z.string().min(1),
        force: z.boolean(),
      })
      .strict(),
    output: z.discriminatedUnion("state", [
      z.object({ state: z.literal("started") }),
      z.object({
        state: z.literal("skipped"),
        reasons: z.array(externalWorktreeSkipReasonSchema).min(1),
      }),
    ]),
  },
  startClearLargeFiles: {
    input: z.object({ hostId: z.string().min(1).nullable() }).strict(),
    output: z.null(),
  },
  clearLargeFiles: {
    input: z.object({ hostId: z.string().min(1).nullable() }).strict(),
    output: z.object({
      clearedFiles: z.number().int().nonnegative(),
      clearedBytes: z.number().int().nonnegative(),
    }),
  },
  clearThread: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z.object({ ok: z.literal(true) }),
  },
  startClearArchivedFiles: { input: machineInput, output: z.null() },
  clearArchivedFiles: {
    input: machineInput,
    output: z.object({
      clearedThreads: z.number().int().nonnegative(),
      clearedBytes: z.number().int().nonnegative(),
    }),
  },
  removeDevInstances: {
    input: z.union([
      z.object({ hostId: z.string().min(1), names: z.null() }).strict(),
      z
        .object({
          hostId: z.string().min(1),
          names: z.array(z.string().min(1)).min(1).max(500),
          stopRunning: z.boolean(),
        })
        .strict(),
    ]),
    output: z.object({
      running: z.array(z.string()),
      removedCount: z.number().int().nonnegative(),
      removedBytes: z.number().int().nonnegative(),
      skippedCount: z.number().int().nonnegative(),
      stoppedProcessCount: z.number().int().nonnegative(),
    }),
  },
  coldThreads: {
    input: z
      .object({
        projectId: z.string().min(1).nullable(),
        search: z.string().min(1).nullable(),
        limit: z.number().int().min(1).max(COLD_THREAD_LIST_MAX),
        after: coldThreadCursorSchema.nullable(),
      })
      .strict(),
    output: coldThreadListSchema,
  },
  restoreColdThread: {
    input: coldThreadInput,
    output: z.object({
      threadId: z.string(),
      restoredThreadIds: z.array(z.string()),
    }),
  },
  deleteColdThread: {
    input: coldThreadInput,
    output: z.object({ ok: z.literal(true) }),
  },
  state: { input: z.null(), output: stateSchema },
  preview: { input: policySchema, output: previewSchema },
  configure: { input: policySchema, output: stateSchema },
});
