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
  hidden: z.boolean(),
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

const developerEntrySchema = z.object({
  name: z.string(),
  sizeBytes: byteCountSchema,
  sourcePath: z.string().nullable().default(null),
  sourcePathState: z.enum(["exists", "missing", "unknown"]).default("unknown"),
});
export const developerStorageScanSchema = z.object({
  path: z.string(),
  sizeBytes: byteCountSchema,
  entries: z.array(developerEntrySchema),
});
export const developerStorageSchema = developerStorageScanSchema.extend({
  entries: z.array(
    developerEntrySchema.extend({
      threads: z.array(
        z.object({
          threadId: z.string(),
          title: z.string(),
          archived: z.boolean(),
        }),
      ),
    }),
  ),
});

export const hostStorageReportSchema = z.object({
  hostId: z.string(),
  scannedAt: z.number(),
  disk: z
    .object({ totalBytes: byteCountSchema, freeBytes: byteCountSchema })
    .nullable(),
  activeThreadBytes: byteCountSchema,
  archivedThreadBytes: byteCountSchema,
  orphanBytes: byteCountSchema,
  leftoverWorktreeBytes: byteCountSchema,
  threadsWithStorageCount: z.number().int().nonnegative(),
  archivedThreadCount: z.number().int().nonnegative(),
  orphanCount: z.number().int().nonnegative(),
  hiddenThreads: z.object({
    activeCount: z.number().int().nonnegative(),
    activeBytes: byteCountSchema,
    archivedCount: z.number().int().nonnegative(),
    archivedBytes: byteCountSchema,
  }),
  archivedFiles: z.object({
    threadCount: z.number().int().nonnegative(),
    bytes: byteCountSchema,
  }),
  archivedLargeFiles: z.object({
    threadCount: z.number().int().nonnegative(),
    fileCount: z.number().int().nonnegative(),
    bytes: byteCountSchema,
  }),
  largestThreads: z
    .array(hostStorageThreadSchema)
    .max(HOST_STORAGE_LARGEST_THREADS_LIMIT),
  leftoverWorktrees: z.array(hostStorageLeftoverWorktreeSchema),
  projectWorktrees: z.array(
    z.object({
      projectId: z.string(),
      projectName: z.string(),
      worktreeCount: z.number().int().nonnegative(),
      cleanupPendingCount: z.number().int().nonnegative(),
    }),
  ),
  developerStorage: developerStorageSchema.nullable(),
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

export const largeFileCleanupStatusSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("idle") }),
  z.object({ state: z.literal("running"), startedAt: z.number() }),
  z.object({
    state: z.literal("completed"),
    clearedFiles: byteCountSchema,
    clearedBytes: byteCountSchema,
  }),
  z.object({ state: z.literal("failed"), message: z.string() }),
]);
export type LargeFileCleanupStatus = z.infer<
  typeof largeFileCleanupStatusSchema
>;

export const hostStorageResponseSchema = z.object({
  report: hostStorageReportSchema.nullable(),
  scan: hostStorageScanStatusSchema,
  largeFileCleanup: largeFileCleanupStatusSchema,
});
export type HostStorageResponse = z.infer<typeof hostStorageResponseSchema>;

export const hostStorageListResponseSchema = z.object({
  hosts: z.array(
    z.object({
      hostId: z.string(),
      report: hostStorageReportSchema.nullable(),
      scan: hostStorageScanStatusSchema,
      largeFileCleanup: largeFileCleanupStatusSchema,
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
