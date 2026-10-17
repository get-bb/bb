import {
  hostStorageResponseSchema,
  hostStorageListResponseSchema,
  hostStorageRemoveOrphansResponseSchema,
  hostStorageRetryWorktreeCleanupResponseSchema,
} from "./storage-types.js";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const daysSchema = z.number().int().min(1).max(3650).nullable();
export const policySchema = z
  .object({
    archiveAfterDays: daysSchema,
    deleteAfterDays: daysSchema,
    deleteStorageOnArchive: z.boolean().default(false),
    deleteDevDataOnCheckoutRemoval: z.boolean().default(false),
  })
  .strict();
export type Policy = z.infer<typeof policySchema>;
export const runSchema = z.object({
  ranAt: z.number(),
  archivedCount: z.number().int().nonnegative(),
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
  deleteCount: z.number().int().nonnegative(),
});
export type Preview = z.infer<typeof previewSchema>;
const machineInput = z.object({ hostId: z.string().min(1) }).strict();
const hostMetadataSchema = z.object({
  machines: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.enum(["connected", "disconnected"]),
      lastSeenAt: z.number().nullable(),
    }),
  ),
  primaryHostId: z.string().nullable(),
});
export type HostMetadata = z.infer<typeof hostMetadataSchema>;
export const storageRpc = defineRpcContract({
  metadata: {
    input: z.null(),
    output: hostMetadataSchema,
    tags: () => ["hosts"],
  },
  startCleanup: {
    invalidates: () => ["hosts", "retention-preview"],
    input: z
      .object({
        hostId: z.string().min(1),
        kind: z.enum(["orphans", "development", "worktrees"]),
      })
      .strict(),
    output: z.null(),
  },
  hosts: {
    tags: () => ["hosts"],
    input: z.null(),
    output: hostStorageListResponseSchema,
  },
  host: {
    tags: () => ["hosts"],
    input: machineInput,
    output: hostStorageResponseSchema,
  },
  scanHost: {
    invalidates: () => ["hosts", "retention-preview"],
    input: machineInput,
    output: hostStorageResponseSchema,
  },
  scanAll: {
    invalidates: () => ["hosts", "retention-preview"],
    input: z.null(),
    output: hostStorageListResponseSchema,
  },
  removeOrphans: {
    invalidates: () => ["hosts", "retention-preview"],
    input: machineInput,
    output: hostStorageRemoveOrphansResponseSchema,
  },
  retryWorktreeCleanup: {
    invalidates: () => ["hosts", "retention-preview"],
    input: machineInput,
    output: hostStorageRetryWorktreeCleanupResponseSchema,
  },
  startClearLargeFiles: {
    invalidates: () => ["hosts", "retention-preview"],
    input: z.object({ hostId: z.string().min(1).nullable() }).strict(),
    output: z.null(),
  },
  clearLargeFiles: {
    invalidates: () => ["hosts", "retention-preview"],
    input: z.object({ hostId: z.string().min(1).nullable() }).strict(),
    output: z.object({
      clearedFiles: z.number().int().nonnegative(),
      clearedBytes: z.number().int().nonnegative(),
    }),
  },
  clearThread: {
    invalidates: () => ["hosts", "retention-preview"],
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z.object({ ok: z.literal(true) }),
  },
  startClearArchivedFiles: {
    invalidates: () => ["hosts", "retention-preview"],
    input: machineInput,
    output: z.null(),
  },
  clearArchivedFiles: {
    invalidates: () => ["hosts", "retention-preview"],
    input: machineInput,
    output: z.object({
      clearedThreads: z.number().int().nonnegative(),
      clearedBytes: z.number().int().nonnegative(),
    }),
  },
  removeDevInstances: {
    invalidates: () => ["hosts", "retention-preview"],
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
  state: { tags: () => ["state"], input: z.null(), output: stateSchema },
  preview: {
    tags: () => ["retention-preview"],
    input: policySchema,
    output: previewSchema,
  },
  configure: {
    invalidates: () => ["state", "retention-preview"],
    input: policySchema,
    output: stateSchema,
  },
});
