import { z } from "zod";
import {
  pathsExistRequestSchema,
  pathsExistResponseSchema,
  pickFolderResponseSchema,
  providerCliInstallEventSchema,
  providerCliInstallRequestSchema,
  providerCliStatusResponseSchema,
  type PathsExistRequest,
  type PathsExistResponse,
  type PickFolderResponse,
  type ProviderCliInstallEvent,
  type ProviderCliInstallRequest,
  type ProviderCliStatusResponse,
} from "@bb/host-daemon-contract";

/**
 * Query for `GET /hosts/:id/directory`, the interactive path browser's
 * single-level directory read. `path` is an absolute directory on the host;
 * omitting it lists the host's home directory (the daemon resolves it, since a
 * remote caller cannot know the host's home).
 */
export const hostDirectoryQuerySchema = z.object({
  path: z.string().min(1).optional(),
});
export type HostDirectoryQuery = z.infer<typeof hostDirectoryQuerySchema>;

export const hostDirectoryEntrySchema = z.object({
  kind: z.enum(["file", "directory"]),
  name: z.string(),
  path: z.string(),
});
export type HostDirectoryEntry = z.infer<typeof hostDirectoryEntrySchema>;

export const hostDirectoryListingSchema = z.object({
  // Resolved absolute directory that was listed (symlinks already followed).
  directory: z.string(),
  // Absolute parent directory, or null at the filesystem root.
  parent: z.string().nullable(),
  entries: z.array(hostDirectoryEntrySchema),
});
export type HostDirectoryListing = z.infer<typeof hostDirectoryListingSchema>;

/** Project name is sent so the daemon can derive its host-local checkout path. */
export const hostCloneDefaultPathQuerySchema = z.object({
  projectId: z.string().min(1),
});
export type HostCloneDefaultPathQuery = z.infer<
  typeof hostCloneDefaultPathQuerySchema
>;

export const hostCloneDefaultPathResponseSchema = z
  .object({ path: z.string().min(1) })
  .strict();
export type HostCloneDefaultPathResponse = z.infer<
  typeof hostCloneDefaultPathResponseSchema
>;

// The machine names itself at enroll time (the daemon reports its hostname),
// so minting takes no fields.
export const createHostJoinCodeRequestSchema = z.object({}).strict();
export type CreateHostJoinCodeRequest = z.infer<
  typeof createHostJoinCodeRequestSchema
>;

export const createHostJoinCodeResponseSchema = z.object({
  joinCode: z.string().min(1),
  hostId: z.string().min(1),
  expiresAt: z.number().int().positive(),
});
export type CreateHostJoinCodeResponse = z.infer<
  typeof createHostJoinCodeResponseSchema
>;

export const updateHostRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
  })
  .strict();
export type UpdateHostRequest = z.infer<typeof updateHostRequestSchema>;

export const hostRetryUpdateResponseSchema = z
  .object({ ok: z.literal(true) })
  .strict();
export type HostRetryUpdateResponse = z.infer<
  typeof hostRetryUpdateResponseSchema
>;

export const hostPathsExistRequestSchema = pathsExistRequestSchema;
export type HostPathsExistRequest = PathsExistRequest;

export const hostPathsExistResponseSchema = pathsExistResponseSchema;
export type HostPathsExistResponse = PathsExistResponse;

export const hostPickFolderRequestSchema = z
  .object({
    clientHostId: z.string().min(1),
  })
  .strict();
export type HostPickFolderRequest = z.infer<typeof hostPickFolderRequestSchema>;

export const hostPickFolderResponseSchema = pickFolderResponseSchema;
export type HostPickFolderResponse = PickFolderResponse;

export const hostProviderCliStatusResponseSchema =
  providerCliStatusResponseSchema;
export type HostProviderCliStatusResponse = ProviderCliStatusResponse;

export const hostProviderCliInstallRequestSchema =
  providerCliInstallRequestSchema;
export type HostProviderCliInstallRequest = ProviderCliInstallRequest;

export const hostProviderCliInstallEventSchema = providerCliInstallEventSchema;
export type HostProviderCliInstallEvent = ProviderCliInstallEvent;
