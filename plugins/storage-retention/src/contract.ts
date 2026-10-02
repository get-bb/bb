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
export const storageRpc = defineRpcContract({
  hosts: { input: z.null(), output: hostStorageListResponseSchema },
  host: { input: machineInput, output: hostStorageResponseSchema },
  scanHost: { input: machineInput, output: hostStorageResponseSchema },
  scanAll: { input: z.null(), output: hostStorageListResponseSchema },
  removeOrphans: {
    input: machineInput,
    output: hostStorageRemoveOrphansResponseSchema,
  },
  retryWorktreeCleanup: {
    input: machineInput,
    output: hostStorageRetryWorktreeCleanupResponseSchema,
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
  clearArchivedFiles: {
    input: machineInput,
    output: z.object({
      clearedThreads: z.number().int().nonnegative(),
      clearedBytes: z.number().int().nonnegative(),
    }),
  },
  state: { input: z.null(), output: stateSchema },
  preview: { input: policySchema, output: previewSchema },
  configure: { input: policySchema, output: stateSchema },
});
