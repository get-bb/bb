import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { mutateManagedJsonFile } from "./managed-json-file.js";

export const APP_UPDATE_SHIM_PROTOCOL_ENV_NAME = "BB_APP_UPDATE_SHIM_PROTOCOL";
export const APP_UPDATE_SHIM_PROTOCOL_VERSION = 1;
export const APP_UPDATE_MODE_ENV_NAME = "BB_APP_UPDATE_MODE";
export const APP_UPDATE_RESTART_EXIT_CODE = 75;
export const APP_UPDATE_PROBATION_FAILED_EXIT_CODE = 76;
export const APP_UPDATE_STATE_FILE_NAME = "bb-app-update.json";
export const APP_UPDATE_SHIM_LOCK_FILE_NAME = "bb-app-update-shim.json";
export const APP_UPDATE_VERSIONS_DIR_NAME = "app-versions";
export const APP_UPDATE_BACKUPS_DIR_NAME = "app-update-backups";
export const APP_UPDATE_PASSIVE_MODE = "passive";
export const APP_UPDATE_STATE_SCHEMA_VERSION = 1;
export const APP_UPDATE_LOG_TAIL_LINES = 40;

export const appUpdateModeSchema = z.enum(["npm", "source"]);
export type AppUpdateMode = z.infer<typeof appUpdateModeSchema>;

const gitCommitSchema = z.string().regex(/^[0-9a-f]{40}$/u);

export const npmAppRevisionSchema = z
  .object({
    kind: z.literal("npm"),
    packageRoot: z.string().min(1),
    version: z.string().min(1),
  })
  .passthrough();
export type NpmAppRevision = z.infer<typeof npmAppRevisionSchema>;

export const sourceAppRevisionSchema = z
  .object({
    commit: gitCommitSchema,
    kind: z.literal("source"),
    version: z.string().min(1),
  })
  .passthrough();
export type SourceAppRevision = z.infer<typeof sourceAppRevisionSchema>;

export const appRevisionSchema = z.discriminatedUnion("kind", [
  npmAppRevisionSchema,
  sourceAppRevisionSchema,
]);
export type AppRevision = z.infer<typeof appRevisionSchema>;

export const appUpdateFailurePhaseSchema = z.enum([
  "prepare",
  "install",
  "startup",
  "probation",
  "rollback",
]);
export type AppUpdateFailurePhase = z.infer<typeof appUpdateFailurePhaseSchema>;

export const appUpdatePendingSchema = z
  .object({
    databaseBackupDir: z.string().min(1).nullable(),
    failure: z
      .object({
        message: z.string(),
        phase: appUpdateFailurePhaseSchema,
      })
      .passthrough()
      .nullable(),
    from: appRevisionSchema,
    healthyAt: z.string().min(1).nullable(),
    id: z.string().min(1),
    requestedAt: z.string().min(1),
    rollbackStartedAt: z.string().min(1).nullable(),
    to: appRevisionSchema,
  })
  .passthrough();
export type AppUpdatePending = z.infer<typeof appUpdatePendingSchema>;

export const appUpdateOutcomeSchema = z.enum([
  "updated",
  "failed",
  "rolled-back",
  "rollback-failed",
]);
export type AppUpdateOutcome = z.infer<typeof appUpdateOutcomeSchema>;

export const appUpdateResultSchema = z
  .object({
    acknowledged: z.boolean(),
    finishedAt: z.string().min(1),
    from: appRevisionSchema,
    id: z.string().min(1),
    logTail: z.array(z.string()),
    message: z.string().nullable(),
    outcome: appUpdateOutcomeSchema,
    phase: appUpdateFailurePhaseSchema.nullable(),
    to: appRevisionSchema,
  })
  .passthrough();
export type AppUpdateResult = z.infer<typeof appUpdateResultSchema>;

export const installedNpmAppRevisionSchema = npmAppRevisionSchema
  .extend({ nodeAbi: z.string().min(1) })
  .passthrough();
export type InstalledNpmAppRevision = z.infer<
  typeof installedNpmAppRevisionSchema
>;

export const appUpdateStateSchema = z
  .object({
    current: installedNpmAppRevisionSchema.nullable(),
    lastResult: appUpdateResultSchema.nullable(),
    pending: appUpdatePendingSchema.nullable(),
    schemaVersion: z.literal(APP_UPDATE_STATE_SCHEMA_VERSION),
  })
  .passthrough();
export type AppUpdateState = z.infer<typeof appUpdateStateSchema>;

export const EMPTY_APP_UPDATE_STATE: AppUpdateState = {
  current: null,
  lastResult: null,
  pending: null,
  schemaVersion: APP_UPDATE_STATE_SCHEMA_VERSION,
};

export function formatAppUpdateStatePath(dataDir: string): string {
  return join(dataDir, APP_UPDATE_STATE_FILE_NAME);
}

export function formatAppUpdateVersionsDir(dataDir: string): string {
  return join(dataDir, APP_UPDATE_VERSIONS_DIR_NAME);
}

export function formatAppUpdateBackupsDir(dataDir: string): string {
  return join(dataDir, APP_UPDATE_BACKUPS_DIR_NAME);
}

export function formatAppUpdateShimLockPath(dataDir: string): string {
  return join(dataDir, APP_UPDATE_SHIM_LOCK_FILE_NAME);
}

export class AppUpdateStateUnreadableError extends Error {
  constructor(path: string) {
    super(
      `${path} was written by a newer or incompatible bb; in-app updates are paused until a matching bb-app runs.`,
    );
  }
}

export async function readAppUpdateStateFile(
  dataDir: string,
): Promise<AppUpdateState | null> {
  let raw: string;
  try {
    raw = await readFile(formatAppUpdateStatePath(dataDir), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return EMPTY_APP_UPDATE_STATE;
    }
    return null;
  }
  try {
    const parsed = appUpdateStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function readAppUpdateState(
  dataDir: string,
): Promise<AppUpdateState> {
  return (await readAppUpdateStateFile(dataDir)) ?? EMPTY_APP_UPDATE_STATE;
}

export function mutateAppUpdateState(
  dataDir: string,
  mutate: (current: AppUpdateState) => AppUpdateState,
): Promise<AppUpdateState> {
  return mutateManagedJsonFile({
    mutate,
    path: formatAppUpdateStatePath(dataDir),
    read: async () => {
      const state = await readAppUpdateStateFile(dataDir);
      if (state === null) {
        throw new AppUpdateStateUnreadableError(
          formatAppUpdateStatePath(dataDir),
        );
      }
      return state;
    },
  });
}

export function isNightlyAppVersion(version: string): boolean {
  return /-nightly\.\d+\.\d+$/u.test(version);
}

export const appUpdateTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("npm"), version: z.string().min(1) }),
  z.object({ commit: gitCommitSchema, kind: z.literal("source") }),
]);
export type AppUpdateTarget = z.infer<typeof appUpdateTargetSchema>;

export const appUpdateBlockReasonSchema = z.enum([
  "detached-head",
  "not-on-main",
  "uncommitted-changes",
  "diverged",
  "fetch-failed",
]);
export type AppUpdateBlockReason = z.infer<typeof appUpdateBlockReasonSchema>;

export const sourceUpdateCheckSchema = z.object({
  blocked: z
    .object({
      message: z.string(),
      reason: appUpdateBlockReasonSchema,
    })
    .nullable(),
  current: sourceAppRevisionSchema,
  incoming: z
    .object({
      commit: gitCommitSchema,
      commitCount: z.number().int().nonnegative(),
      subjects: z.array(z.string()),
      version: z.string().min(1),
    })
    .nullable(),
});
export type SourceUpdateCheck = z.infer<typeof sourceUpdateCheckSchema>;

export const appUpdateActivitySchema = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("idle") }),
  z.object({
    output: z.array(z.string()),
    phase: z.literal("preparing"),
    startedAt: z.string().min(1),
    step: z.string().min(1),
    target: appUpdateTargetSchema,
    targetVersion: z.string().min(1),
  }),
  z.object({
    phase: z.literal("ready"),
    startedAt: z.string().min(1),
    target: appUpdateTargetSchema,
    targetVersion: z.string().min(1),
  }),
  z.object({
    phase: z.literal("restarting"),
    startedAt: z.string().min(1),
    target: appUpdateTargetSchema,
    targetVersion: z.string().min(1),
  }),
]);
export type AppUpdateActivity = z.infer<typeof appUpdateActivitySchema>;

export const launcherAppUpdateStatusSchema = z.object({
  activity: appUpdateActivitySchema,
  current: appRevisionSchema,
  lastResult: appUpdateResultSchema.nullable(),
  mode: appUpdateModeSchema,
  probation: z.boolean(),
});
export type LauncherAppUpdateStatus = z.infer<
  typeof launcherAppUpdateStatusSchema
>;

export const appUpdateLauncherRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("check-source") }),
  z.object({
    target: appUpdateTargetSchema,
    targetVersion: z.string().min(1),
    type: z.literal("apply"),
  }),
  z.object({ id: z.string().min(1), type: z.literal("acknowledge-result") }),
  z.object({ type: z.literal("restart") }),
  z.object({ message: z.string().min(1), type: z.literal("cancel") }),
]);
export type AppUpdateLauncherRequest = z.infer<
  typeof appUpdateLauncherRequestSchema
>;

export const serverToLauncherMessageSchema = z.discriminatedUnion("channel", [
  z.object({
    channel: z.literal("bb-app-update/request"),
    request: appUpdateLauncherRequestSchema,
    requestId: z.string().min(1),
  }),
  z.object({ channel: z.literal("bb-app-update/hello") }),
]);
export type ServerToLauncherMessage = z.infer<
  typeof serverToLauncherMessageSchema
>;

export const launcherToServerMessageSchema = z.discriminatedUnion("channel", [
  z.object({
    channel: z.literal("bb-app-update/response"),
    error: z.string().nullable(),
    requestId: z.string().min(1),
    result: z.unknown(),
  }),
  z.object({
    channel: z.literal("bb-app-update/status"),
    status: launcherAppUpdateStatusSchema,
  }),
]);
export type LauncherToServerMessage = z.infer<
  typeof launcherToServerMessageSchema
>;
