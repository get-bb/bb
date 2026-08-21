import { z } from "zod";
import { FILE_LIST_LIMIT_MAX } from "@bb/domain";
import type { HostDaemonOnlineRpcResultByType } from "@bb/host-daemon-contract";

/**
 * Host file read/write API (`POST /files/*`). Unlike the preview-oriented
 * thread file routes, these are host-scoped primitives for callers (plugins,
 * editors) that do read-modify-write against files on a connected host.
 *
 * `hostId` omission has real semantics: the server resolves it to the primary
 * (local) host once at the route boundary. `rootPath`, when set, confines the
 * resolved target beneath that absolute root on the daemon side.
 */
export const hostFileReadRequestSchema = z
  .object({
    hostId: z.string().min(1).optional(),
    path: z.string().min(1),
    rootPath: z.string().min(1).optional(),
  })
  .strict();
export type HostFileReadRequest = z.infer<typeof hostFileReadRequestSchema>;

export const hostFileWriteRequestSchema = z
  .object({
    hostId: z.string().min(1).optional(),
    path: z.string().min(1),
    rootPath: z.string().min(1).optional(),
    content: z.string(),
    contentEncoding: z.enum(["utf8", "base64"]).optional(),
    createParents: z.boolean().optional(),
    // Omitted → unconditional write; hash → compare-and-swap against the
    // current content; null → create-only (fail if the file exists).
    expectedSha256: z.string().nullable().optional(),
    mode: z.number().int().min(0).max(0o777).optional(),
  })
  .strict();
export type HostFileWriteRequest = z.infer<typeof hostFileWriteRequestSchema>;

export const hostFileListRequestSchema = z
  .object({
    hostId: z.string().min(1).optional(),
    path: z.string().min(1),
    query: z.string().optional(),
    limit: z.number().int().positive().max(FILE_LIST_LIMIT_MAX).optional(),
  })
  .strict();
export type HostFileListRequest = z.infer<typeof hostFileListRequestSchema>;

export const hostPathListRequestSchema = z
  .object({
    hostId: z.string().min(1).optional(),
    path: z.string().min(1),
    query: z.string().optional(),
    limit: z.number().int().positive().max(FILE_LIST_LIMIT_MAX).optional(),
    includeFiles: z.boolean(),
    includeDirectories: z.boolean(),
  })
  .strict();
export type HostPathListRequest = z.infer<typeof hostPathListRequestSchema>;

export const hostMkdirRequestSchema = z
  .object({
    hostId: z.string().min(1).optional(),
    path: z.string().min(1),
    rootPath: z.string().min(1).optional(),
    recursive: z.boolean().optional(),
  })
  .strict();
export type HostMkdirRequest = z.infer<typeof hostMkdirRequestSchema>;

export const hostMovePathRequestSchema = z
  .object({
    hostId: z.string().min(1).optional(),
    sourcePath: z.string().min(1),
    destinationPath: z.string().min(1),
    rootPath: z.string().min(1).optional(),
  })
  .strict();
export type HostMovePathRequest = z.infer<typeof hostMovePathRequestSchema>;

export const hostRemovePathRequestSchema = z
  .object({
    hostId: z.string().min(1).optional(),
    path: z.string().min(1),
    rootPath: z.string().min(1).optional(),
    recursive: z.boolean().optional(),
  })
  .strict();
export type HostRemovePathRequest = z.infer<typeof hostRemovePathRequestSchema>;

export const createFilePreviewRequestSchema = z
  .object({
    hostId: z.string().min(1).optional(),
    rootPath: z.string().min(1),
    ttlMs: z.number().int().min(60_000).max(3_600_000).optional(),
  })
  .strict();
export type CreateFilePreviewRequest = z.infer<
  typeof createFilePreviewRequestSchema
>;
export interface CreateFilePreviewResponse {
  baseUrl: string;
  expiresAtMs: number;
}

export type HostFileReadResponse =
  HostDaemonOnlineRpcResultByType["host.read_file"];
export type HostFileWriteResponse =
  HostDaemonOnlineRpcResultByType["host.write_file"];
export type HostFileListResponse =
  HostDaemonOnlineRpcResultByType["host.list_files"];
export type HostPathListResponse =
  HostDaemonOnlineRpcResultByType["host.list_paths"];
export type HostMkdirResponse = HostDaemonOnlineRpcResultByType["host.mkdir"];
export type HostMovePathResponse =
  HostDaemonOnlineRpcResultByType["host.move_path"];
export type HostRemovePathResponse =
  HostDaemonOnlineRpcResultByType["host.remove_path"];
