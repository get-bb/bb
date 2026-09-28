import { z } from "zod";

export const HOST_STORAGE_LARGEST_THREADS_LIMIT = 20;

const byteCountSchema = z.number().int().nonnegative();

export const hostStorageThreadSchema = z.object({
  threadId: z.string(),
  projectId: z.string(),
  title: z.string(),
  archivedAt: z.number().nullable(),
  updatedAt: z.number(),
  running: z.boolean(),
  sizeBytes: byteCountSchema,
});
export type HostStorageThread = z.infer<typeof hostStorageThreadSchema>;

export const hostStorageLeftoverWorktreeSchema = z.object({
  environmentId: z.string(),
  projectId: z.string(),
  path: z.string(),
  sizeBytes: byteCountSchema,
  teardownMessage: z.string().nullable(),
});
export type HostStorageLeftoverWorktree = z.infer<
  typeof hostStorageLeftoverWorktreeSchema
>;

export const hostStorageReportSchema = z.object({
  hostId: z.string(),
  scannedAt: z.number(),
  activeThreadBytes: byteCountSchema,
  archivedThreadBytes: byteCountSchema,
  orphanBytes: byteCountSchema,
  leftoverWorktreeBytes: byteCountSchema,
  threadsWithStorageCount: z.number().int().nonnegative(),
  archivedThreadCount: z.number().int().nonnegative(),
  orphanCount: z.number().int().nonnegative(),
  largestThreads: z
    .array(hostStorageThreadSchema)
    .max(HOST_STORAGE_LARGEST_THREADS_LIMIT),
  leftoverWorktrees: z.array(hostStorageLeftoverWorktreeSchema),
});
export type HostStorageReport = z.infer<typeof hostStorageReportSchema>;

export const hostStorageScanStatusSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("idle") }),
  z.object({ state: z.literal("scanning"), startedAt: z.number() }),
  z.object({
    state: z.literal("failed"),
    failedAt: z.number(),
    message: z.string(),
  }),
]);
export type HostStorageScanStatus = z.infer<typeof hostStorageScanStatusSchema>;

export const hostStorageResponseSchema = z.object({
  report: hostStorageReportSchema.nullable(),
  scan: hostStorageScanStatusSchema,
});
export type HostStorageResponse = z.infer<typeof hostStorageResponseSchema>;

export const hostStorageListResponseSchema = z.object({
  hosts: z.array(
    z.object({
      hostId: z.string(),
      report: hostStorageReportSchema.nullable(),
      scan: hostStorageScanStatusSchema,
    }),
  ),
});
export type HostStorageListResponse = z.infer<
  typeof hostStorageListResponseSchema
>;

export const hostStorageRemoveOrphansResponseSchema = z.object({
  removedCount: z.number().int().nonnegative(),
  removedBytes: byteCountSchema,
  report: hostStorageReportSchema,
});
export type HostStorageRemoveOrphansResponse = z.infer<
  typeof hostStorageRemoveOrphansResponseSchema
>;

export const hostStorageRetryWorktreeCleanupResponseSchema = z.object({
  retriedCount: z.number().int().nonnegative(),
});
export type HostStorageRetryWorktreeCleanupResponse = z.infer<
  typeof hostStorageRetryWorktreeCleanupResponseSchema
>;
