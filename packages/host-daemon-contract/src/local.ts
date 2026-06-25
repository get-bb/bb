import type { Hono } from "hono";
import { hc } from "hono/client";
import { z } from "zod";
import type { EmptyInput, Endpoint } from "./common.js";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const DEFAULT_HOST_DAEMON_LOCAL_HEALTH_PATH = "/health";
export const DEFAULT_HOST_DAEMON_LOCAL_BIND_HOST = "127.0.0.1";
export const DEFAULT_HOST_DAEMON_LOCAL_HEALTH_VALUE = "ok";

export const workspaceOpenTargetIdSchema = z.string().trim().min(1).max(200);
export type WorkspaceOpenTargetId = z.infer<typeof workspaceOpenTargetIdSchema>;

export const workspaceOpenTargetCapabilitiesSchema = z.object({
  openDirectory: z.boolean(),
  openFile: z.boolean(),
  openFileAtLine: z.boolean(),
  openFileAtColumn: z.boolean().optional(),
});
export type WorkspaceOpenTargetCapabilities = z.infer<
  typeof workspaceOpenTargetCapabilitiesSchema
>;

export const workspaceOpenTargetKindValues = [
  "editor",
  "file-manager",
  "terminal",
  "default-app",
  "native-app",
] as const;
export const workspaceOpenTargetKindSchema = z.enum(
  workspaceOpenTargetKindValues,
);
export type WorkspaceOpenTargetKind = z.infer<
  typeof workspaceOpenTargetKindSchema
>;

export const WORKSPACE_OPEN_TARGET_ICON_DATA_URL_MAX_LENGTH = 200_000;

export const workspaceOpenTargetIconSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("builtin"),
      name: z.string().trim().min(1).max(100),
    })
    .strict(),
  z
    .object({
      kind: z.literal("data-url"),
      dataUrl: z
        .string()
        .trim()
        .startsWith("data:image/")
        .max(WORKSPACE_OPEN_TARGET_ICON_DATA_URL_MAX_LENGTH),
    })
    .strict(),
  z
    .object({
      kind: z.literal("symbol"),
      name: z.enum(["default-app", "file-manager", "terminal", "app"]),
    })
    .strict(),
]);
export type WorkspaceOpenTargetIcon = z.infer<
  typeof workspaceOpenTargetIconSchema
>;

export const workspaceOpenTargetSchema = z.object({
  id: workspaceOpenTargetIdSchema,
  label: z.string().min(1),
  kind: workspaceOpenTargetKindSchema.optional(),
  icon: workspaceOpenTargetIconSchema.optional(),
  capabilities: workspaceOpenTargetCapabilitiesSchema,
  remoteSshCapabilities: workspaceOpenTargetCapabilitiesSchema.optional(),
});
export type WorkspaceOpenTarget = z.infer<typeof workspaceOpenTargetSchema>;

export const workspaceOpenTargetsResponseSchema = z.object({
  targets: z.array(workspaceOpenTargetSchema),
});
export type WorkspaceOpenTargetsResponse = z.infer<
  typeof workspaceOpenTargetsResponseSchema
>;

export const workspaceOpenTargetsQuerySchema = z.object({
  path: z.string().min(1).optional(),
});
export type WorkspaceOpenTargetsQuery = z.infer<
  typeof workspaceOpenTargetsQuerySchema
>;

const openTargetPathSchema = z.string().min(1);
const openTargetLineNumberSchema = z.number().int().positive().nullable();
const openTargetColumnNumberSchema = z.number().int().positive().nullable();

export const openInTargetLocalContextSchema = z
  .object({
    kind: z.literal("local"),
  })
  .strict();

export const openInTargetRemoteSshContextSchema = z
  .object({
    kind: z.literal("remote-ssh"),
    serverOrigin: z.string().url(),
    hostId: z.string().min(1),
  })
  .strict();

export const openInTargetContextSchema = z.discriminatedUnion("kind", [
  openInTargetLocalContextSchema,
  openInTargetRemoteSshContextSchema,
]);
export type OpenInTargetContext = z.infer<typeof openInTargetContextSchema>;

export const openInTargetRequestSchema = z.object({
  context: openInTargetContextSchema.default({ kind: "local" }),
  columnNumber: openTargetColumnNumberSchema.default(null),
  lineNumber: openTargetLineNumberSchema,
  path: openTargetPathSchema,
  targetId: workspaceOpenTargetIdSchema,
});
export type OpenInTargetRequest = z.infer<typeof openInTargetRequestSchema>;

export const pickFolderResponseSchema = z.object({
  path: z.string().nullable(),
});
export type PickFolderResponse = z.infer<typeof pickFolderResponseSchema>;

export const PATHS_EXIST_MAX_PATHS = 200;

export const pathsExistRequestSchema = z.object({
  paths: z
    .array(z.string().min(1))
    .min(1)
    .max(PATHS_EXIST_MAX_PATHS)
    .transform((paths) => Array.from(new Set(paths))),
});
export type PathsExistRequest = z.infer<typeof pathsExistRequestSchema>;

export const pathsExistResponseSchema = z.object({
  existence: z.record(z.string(), z.boolean()),
});
export type PathsExistResponse = z.infer<typeof pathsExistResponseSchema>;

export const hostPlatformSchema = z.enum(["darwin", "linux", "wsl", "unknown"]);
export type HostPlatform = z.infer<typeof hostPlatformSchema>;

export const statusResponseSchema = z.object({
  hostId: z.string().min(1),
  connected: z.boolean(),
  // Informational local-daemon protocol marker. Dev restart tooling uses it
  // to detect stale host-daemons; product UI must not gate behavior on it.
  protocolVersion: z.number().int().positive(),
  serverUrl: z.string(),
  supportsNativeFolderPicker: z.boolean(),
  platform: hostPlatformSchema,
});
export type StatusResponse = z.infer<typeof statusResponseSchema>;

export const healthResponseSchema = z.string().min(1);
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const providerCliKeyValues = ["codex", "claudeCode", "cursor"] as const;
export const providerCliKeySchema = z.enum(providerCliKeyValues);
export type ProviderCliKey = z.infer<typeof providerCliKeySchema>;

export const providerCliInstallOutputStreamValues = [
  "stdout",
  "stderr",
] as const;
export const providerCliInstallOutputStreamSchema = z.enum(
  providerCliInstallOutputStreamValues,
);

export const providerCliInstallSourceValues = [
  "notInstalled",
  "npmGlobal",
  "external",
] as const;
export const providerCliInstallSourceSchema = z.enum(
  providerCliInstallSourceValues,
);
export type ProviderCliInstallSource = z.infer<
  typeof providerCliInstallSourceSchema
>;

export const providerCliInstallActionKindValues = [
  "install",
  "update",
] as const;
export const providerCliInstallActionKindSchema = z.enum(
  providerCliInstallActionKindValues,
);
export type ProviderCliInstallActionKind = z.infer<
  typeof providerCliInstallActionKindSchema
>;

export const providerCliInstallCommandKindValues = ["exec", "shell"] as const;
export const providerCliInstallCommandKindSchema = z.enum(
  providerCliInstallCommandKindValues,
);

export const providerCliInstallActionSchema = z.object({
  kind: providerCliInstallActionKindSchema,
  label: z.enum(["Install", "Update"]),
  commandKind: providerCliInstallCommandKindSchema,
  command: z.string().min(1),
});
export type ProviderCliInstallAction = z.infer<
  typeof providerCliInstallActionSchema
>;

export const providerCliStatusSchema = z.object({
  displayName: z.string().min(1),
  executableName: z.string().min(1),
  executablePath: z.string().min(1).nullable(),
  installed: z.boolean(),
  installSource: providerCliInstallSourceSchema,
  currentVersion: z.string().min(1).nullable(),
  latestVersion: z.string().min(1).nullable(),
  minimumSupportedVersion: z.string().min(1).nullable(),
  npmPackageName: z.string().min(1).nullable(),
  npmGlobalPackageVersion: z.string().min(1).nullable(),
  installAction: providerCliInstallActionSchema.nullable(),
  needsUpdate: z.boolean(),
  versionUnsupported: z.boolean(),
});
export type ProviderCliStatus = z.infer<typeof providerCliStatusSchema>;

export const providerCliStatusResponseSchema = z.record(
  providerCliKeySchema,
  providerCliStatusSchema,
);
export type ProviderCliStatusResponse = z.infer<
  typeof providerCliStatusResponseSchema
>;

export const providerCliInstallRequestSchema = z.object({
  provider: providerCliKeySchema,
  actionKind: providerCliInstallActionKindSchema,
});
export type ProviderCliInstallRequest = z.infer<
  typeof providerCliInstallRequestSchema
>;

export const providerCliInstallStartedEventSchema = z.object({
  type: z.literal("started"),
  provider: providerCliKeySchema,
  command: z.string().min(1),
});

export const providerCliInstallOutputEventSchema = z.object({
  type: z.literal("output"),
  provider: providerCliKeySchema,
  stream: providerCliInstallOutputStreamSchema,
  text: z.string(),
});

export const providerCliInstallCompletedEventSchema = z.object({
  type: z.literal("completed"),
  provider: providerCliKeySchema,
  exitCode: z.number().int().nullable(),
  signal: z.string().min(1).nullable(),
  success: z.boolean(),
});
export type ProviderCliInstallCompletedEvent = z.infer<
  typeof providerCliInstallCompletedEventSchema
>;

export const providerCliInstallErrorEventSchema = z.object({
  type: z.literal("error"),
  provider: providerCliKeySchema,
  message: z.string().min(1),
});

export const providerCliInstallEventSchema = z.discriminatedUnion("type", [
  providerCliInstallStartedEventSchema,
  providerCliInstallOutputEventSchema,
  providerCliInstallCompletedEventSchema,
  providerCliInstallErrorEventSchema,
]);
export type ProviderCliInstallEvent = z.infer<
  typeof providerCliInstallEventSchema
>;

// ---------------------------------------------------------------------------
// Route type definition for Hono typed client
// ---------------------------------------------------------------------------

/**
 * Local daemon HTTP API.
 *
 * This API predates remote-client support and currently mixes two ownership
 * classes:
 *
 * - client-machine-local routes: actions about the machine showing the UI, such as
 *   local editor discovery and launch
 * - work-host routes: actions about the machine running bb work, such as path
 *   checks and provider CLI health
 *
 * Keep the ownership comments below accurate while the API is split or routed
 * through server-backed work-host commands.
 */
export type HostDaemonLocalSchema = {
  [DEFAULT_HOST_DAEMON_LOCAL_HEALTH_PATH]: {
    $get: Endpoint<EmptyInput, HealthResponse>;
  };
  /** client-machine-local: discover editor/app launch targets on the UI machine. */
  "/workspace-open-targets": {
    $get: Endpoint<
      { query?: WorkspaceOpenTargetsQuery },
      WorkspaceOpenTargetsResponse
    >;
  };
  /** client-machine-local: open a path in an editor/app on the UI machine. */
  "/open-in-target": {
    $post: Endpoint<{ json: OpenInTargetRequest }, Record<string, never>>;
  };
  /**
   * work-host, same-machine only; deprecated for direct app/browser callers.
   * The canonical app path should be a server route that gates same-machine
   * access before asking the work host daemon to show a native folder picker.
   */
  "/pick-folder": {
    $post: Endpoint<EmptyInput, PickFolderResponse>;
  };
  /** work-host; deprecated for direct app/browser callers. */
  "/paths/exist": {
    $post: Endpoint<{ json: PathsExistRequest }, PathsExistResponse>;
  };
  /** mixed: helper reachability plus connected work-host/session identity. */
  "/status": {
    $get: Endpoint<EmptyInput, StatusResponse>;
  };
  /** work-host; deprecated for direct app/browser callers. */
  "/provider-clis/status": {
    $get: Endpoint<EmptyInput, ProviderCliStatusResponse>;
  };
  /**
   * work-host; deprecated for direct app/browser callers.
   * Installs or updates provider CLIs on the machine that runs agents.
   */
  "/provider-clis/install": {
    /** Streams `npm install -g <provider package>@latest` progress as newline-delimited JSON events. */
    $post: Endpoint<
      { json: ProviderCliInstallRequest },
      ProviderCliInstallEvent,
      200,
      "text"
    >;
  };
};

export type HostDaemonLocalRoutes = Hono<{}, HostDaemonLocalSchema, "/">;

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

/**
 * Create a typed Hono client for the daemon's local API.
 *
 * No auth — the local API is bound to 127.0.0.1 only.
 */
export function createHostDaemonLocalClient(baseUrl: string) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  return hc<HostDaemonLocalRoutes>(normalizedBaseUrl);
}
