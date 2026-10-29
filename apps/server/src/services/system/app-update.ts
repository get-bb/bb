import {
  isNightlyAppVersion,
  sourceUpdateCheckSchema,
  type AppRevision,
  type AppUpdateActivity,
  type AppUpdateLauncherRequest,
  type AppUpdateMode,
  type AppUpdateResult,
  type AppUpdateTarget,
  type LauncherAppUpdateStatus,
  type SourceUpdateCheck,
} from "@bb/config/app-update";
import type { AppSurface } from "@bb/config/app-surface";
import type {
  SystemAppUpdateActivity,
  SystemAppUpdateAvailable,
  SystemAppUpdateResult,
  SystemAppUpdateRevision,
  SystemAppUpdateStatus,
  SystemAppUpdateSupport,
} from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import type { ServerLogger, ServerRuntimeConfig } from "../../types.js";
import type { AppVersionService } from "./app-version.js";
import type { LauncherChannel } from "./launcher-channel.js";

const SOURCE_CHECK_TTL_MS = 60 * 60 * 1000;
const FIRST_STATUS_WAIT_MS = 1_000;

export type AppUpdateServiceStatus = Omit<SystemAppUpdateStatus, "scheduled">;

export type RunningThreadsPolicy =
  | { kind: "refuse" }
  | { kind: "interrupt" }
  | { kind: "wait"; shouldDefer: (runningThreadCount: number) => boolean };

export interface AppUpdateService {
  acknowledgeResult(args: { id: string }): Promise<AppUpdateServiceStatus>;
  apply(args: {
    runningThreads: RunningThreadsPolicy;
  }): Promise<AppUpdateServiceStatus>;
  dispose(): void;
  getStatus(args: { forceRefresh: boolean }): Promise<AppUpdateServiceStatus>;
}

export function runningThreadsError(count: number): ApiError {
  return new ApiError(
    409,
    "threads_running",
    `${String(count)} thread${count === 1 ? " is" : "s are"} running. Updating restarts bb and interrupts ${count === 1 ? "it" : "them"}.`,
    { details: { runningThreadCount: count } },
  );
}

export function threadsStartedMessage(count: number): string {
  return `${String(count)} thread${count === 1 ? "" : "s"} started while bb was downloading the update. Update again to restart.`;
}

interface CreateAppUpdateServiceArgs {
  currentCommit: string | null;
  appSurface: AppSurface;
  appVersion: AppVersionService;
  config: Pick<ServerRuntimeConfig, "appVersion" | "isDevelopment">;
  countRunningThreads: () => number;
  launcher: LauncherChannel | null;
  logger: ServerLogger;
  mode: AppUpdateMode | null;
  notifyChanged: () => void;
  now?: () => number;
  sourceCheckTtlMs?: number;
}

function toPublicRevision(revision: AppRevision): SystemAppUpdateRevision {
  return revision.kind === "npm"
    ? { commit: null, version: revision.version }
    : { commit: revision.commit, version: revision.version };
}

function toPublicActivity(
  activity: AppUpdateActivity,
): SystemAppUpdateActivity {
  switch (activity.phase) {
    case "idle":
      return { phase: "idle" };
    case "ready":
      return {
        output: [],
        phase: "preparing",
        startedAt: activity.startedAt,
        step: "Ready to restart",
        targetVersion: activity.targetVersion,
      };
    case "preparing":
      return {
        output: activity.output,
        phase: "preparing",
        startedAt: activity.startedAt,
        step: activity.step,
        targetVersion: activity.targetVersion,
      };
    case "restarting":
      return {
        phase: "restarting",
        startedAt: activity.startedAt,
        targetCommit:
          activity.target.kind === "source" ? activity.target.commit : null,
        targetVersion: activity.targetVersion,
      };
  }
}

function toPublicResult(result: AppUpdateResult): SystemAppUpdateResult {
  return {
    acknowledged: result.acknowledged,
    finishedAt: result.finishedAt,
    from: toPublicRevision(result.from),
    id: result.id,
    logTail: result.logTail,
    message: result.message,
    outcome: result.outcome,
    phase: result.phase,
    to: toPublicRevision(result.to),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unsupportedMessage(support: SystemAppUpdateSupport): string {
  if (support.kind === "supported") return "";
  switch (support.reason) {
    case "development":
      return "In-app updates are unavailable in development mode.";
    case "desktop":
      return "The desktop app updates itself; use its update controls.";
    case "unmanaged":
      return "In-app updates are off. Start bb with `npx bb-app start` or `pnpm start`, without `--no-in-app-updates`, to turn them on.";
  }
}

export function createAppUpdateService(
  args: CreateAppUpdateServiceArgs,
): AppUpdateService {
  const now = args.now ?? Date.now;
  const sourceCheckTtlMs = args.sourceCheckTtlMs ?? SOURCE_CHECK_TTL_MS;
  let launcherStatus: LauncherAppUpdateStatus | null = null;
  let resolveFirstStatus: (() => void) | null = null;
  const firstStatus = new Promise<void>((resolvePromise) => {
    resolveFirstStatus = resolvePromise;
  });
  let sourceCheck: SourceUpdateCheck | null = null;
  let lastSourceCheckAttemptAt: number | null = null;
  let sourceCheckInflight: Promise<SourceUpdateCheck | null> | null = null;
  let launcherConnected = args.launcher !== null;
  let runningThreadsPolicy: RunningThreadsPolicy = { kind: "refuse" };
  let decidedReadyAt: string | null = null;

  const decideRestart = (launcher: LauncherChannel, readyAt: string): void => {
    if (decidedReadyAt === readyAt) return;
    decidedReadyAt = readyAt;
    const runningThreadCount = args.countRunningThreads();
    const policy = runningThreadsPolicy;
    const request: AppUpdateLauncherRequest =
      policy.kind === "wait"
        ? policy.shouldDefer(runningThreadCount)
          ? { type: "defer" }
          : { type: "restart" }
        : runningThreadCount === 0 || policy.kind === "interrupt"
          ? { type: "restart" }
          : {
              message: threadsStartedMessage(runningThreadCount),
              type: "cancel",
            };
    void launcher.request(request).catch((error: unknown) => {
      args.logger.warn(
        { error: errorMessage(error), request: request.type },
        "Launcher did not accept the restart decision",
      );
    });
  };

  const unsubscribeStatus =
    args.launcher?.onStatus((status) => {
      launcherStatus = status;
      resolveFirstStatus?.();
      resolveFirstStatus = null;
      if (status.activity.phase === "ready" && args.launcher !== null) {
        decideRestart(args.launcher, status.activity.startedAt);
      }
      args.notifyChanged();
    }) ?? (() => undefined);
  const unsubscribeDisconnect =
    args.launcher?.onDisconnect(() => {
      launcherConnected = false;
      launcherStatus = null;
      args.notifyChanged();
    }) ?? (() => undefined);

  const resolveSupport = (): SystemAppUpdateSupport => {
    if (args.appSurface === "desktop") {
      return { kind: "unsupported", reason: "desktop" };
    }
    if (args.config.isDevelopment) {
      return { kind: "unsupported", reason: "development" };
    }
    if (args.mode === null || args.launcher === null || !launcherConnected) {
      return { kind: "unsupported", reason: "unmanaged" };
    }
    return { kind: "supported", mode: args.mode };
  };

  const refreshSourceCheck = (
    launcher: LauncherChannel,
  ): Promise<SourceUpdateCheck | null> => {
    if (sourceCheckInflight !== null) return sourceCheckInflight;
    lastSourceCheckAttemptAt = now();
    const request = (async () => {
      try {
        const parsed = sourceUpdateCheckSchema.safeParse(
          await launcher.request({ type: "check-source" }),
        );
        if (!parsed.success) {
          args.logger.warn(
            { issue: parsed.error.message },
            "Launcher returned an invalid source update check",
          );
          return sourceCheck;
        }
        sourceCheck = parsed.data;
        return parsed.data;
      } catch (error) {
        args.logger.warn(
          { error: errorMessage(error) },
          "Source update check failed",
        );
        return sourceCheck;
      }
    })();
    sourceCheckInflight = request;
    void request.finally(() => {
      if (sourceCheckInflight === request) sourceCheckInflight = null;
    });
    return request;
  };

  const readSourceCheck = async (
    launcher: LauncherChannel,
    forceRefresh: boolean,
  ): Promise<SourceUpdateCheck | null> => {
    if (forceRefresh) {
      return refreshSourceCheck(launcher);
    }
    if (
      lastSourceCheckAttemptAt === null ||
      now() - lastSourceCheckAttemptAt >= sourceCheckTtlMs
    ) {
      void refreshSourceCheck(launcher).then(() => args.notifyChanged());
    }
    return sourceCheck;
  };

  const readAvailability = async (
    support: SystemAppUpdateSupport,
    forceRefresh: boolean,
  ): Promise<{
    available: SystemAppUpdateAvailable | null;
    blocked: SystemAppUpdateStatus["blocked"];
  }> => {
    if (support.kind !== "supported" || args.launcher === null) {
      return { available: null, blocked: null };
    }
    if (support.mode === "npm") {
      const version = await args.appVersion.getSystemVersion({ forceRefresh });
      if (version.latestVersion === null) {
        return {
          available: null,
          blocked: {
            reason: "fetch-failed",
            message: "Couldn't check for a newer bb release.",
          },
        };
      }
      if (!version.updateAvailable) {
        return { available: null, blocked: null };
      }
      return {
        available: {
          channel: isNightlyAppVersion(version.latestVersion)
            ? "nightly"
            : "latest",
          commit: null,
          commitCount: null,
          subjects: [],
          version: version.latestVersion,
        },
        blocked: null,
      };
    }
    const check = await readSourceCheck(args.launcher, forceRefresh);
    if (check === null)
      return {
        available: null,
        blocked: {
          reason: "fetch-failed",
          message: "Source update status is not available yet.",
        },
      };
    return {
      available:
        check.incoming === null
          ? null
          : {
              channel: "main",
              commit: check.incoming.commit,
              commitCount: check.incoming.commitCount,
              subjects: check.incoming.subjects,
              version: check.incoming.version,
            },
      blocked: check.blocked,
    };
  };

  const getStatus = async ({
    forceRefresh,
  }: {
    forceRefresh: boolean;
  }): Promise<AppUpdateServiceStatus> => {
    const support = resolveSupport();
    if (support.kind === "supported" && launcherStatus === null) {
      await Promise.race([
        firstStatus,
        new Promise((resolvePromise) =>
          setTimeout(resolvePromise, FIRST_STATUS_WAIT_MS),
        ),
      ]);
    }
    const { available, blocked } = await readAvailability(
      support,
      forceRefresh,
    );
    const status = launcherStatus;
    return {
      activity:
        status === null ? { phase: "idle" } : toPublicActivity(status.activity),
      available,
      blocked,
      current:
        status === null
          ? { commit: args.currentCommit, version: args.config.appVersion }
          : toPublicRevision(status.current),
      lastResult:
        status?.lastResult === null || status?.lastResult === undefined
          ? null
          : toPublicResult(status.lastResult),
      runningThreadCount: args.countRunningThreads(),
      support,
    };
  };

  const requireLauncher = (): LauncherChannel => {
    const support = resolveSupport();
    if (support.kind !== "supported" || args.launcher === null) {
      throw new ApiError(
        409,
        "app_update_unsupported",
        unsupportedMessage(support),
      );
    }
    return args.launcher;
  };

  return {
    async acknowledgeResult({ id }) {
      const launcher = requireLauncher();
      try {
        await launcher.request({ id, type: "acknowledge-result" });
      } catch (error) {
        throw new ApiError(409, "app_update_rejected", errorMessage(error));
      }
      return getStatus({ forceRefresh: false });
    },
    async apply({ runningThreads }) {
      const launcher = requireLauncher();
      if (launcherStatus !== null && launcherStatus.activity.phase !== "idle") {
        throw new ApiError(
          409,
          "app_update_in_progress",
          "An update is already in progress.",
        );
      }
      const support = resolveSupport();
      const status = await getStatus({
        forceRefresh: support.kind === "supported" && support.mode === "source",
      });
      if (status.blocked !== null) {
        throw new ApiError(409, "app_update_blocked", status.blocked.message);
      }
      const available = status.available;
      if (available === null) {
        throw new ApiError(
          409,
          "app_update_unavailable",
          "bb is already up to date.",
        );
      }
      if (runningThreads.kind === "wait") {
        if (runningThreads.shouldDefer(status.runningThreadCount)) {
          return status;
        }
      } else if (
        runningThreads.kind === "refuse" &&
        status.runningThreadCount > 0
      ) {
        throw runningThreadsError(status.runningThreadCount);
      }
      const target: AppUpdateTarget | null =
        status.support.kind === "supported" && status.support.mode === "npm"
          ? { kind: "npm", version: available.version }
          : available.commit === null
            ? null
            : { commit: available.commit, kind: "source" };
      if (target === null) {
        throw new ApiError(
          409,
          "app_update_unavailable",
          "bb is already up to date.",
        );
      }
      runningThreadsPolicy = runningThreads;
      try {
        await launcher.request({
          target,
          targetVersion: available.version,
          type: "apply",
        });
      } catch (error) {
        throw new ApiError(409, "app_update_rejected", errorMessage(error));
      }
      args.logger.info(
        { targetVersion: available.version, targetCommit: available.commit },
        "In-app bb update requested",
      );
      return getStatus({ forceRefresh: false });
    },
    dispose() {
      unsubscribeStatus();
      unsubscribeDisconnect();
      args.launcher?.dispose();
    },
    getStatus,
  };
}
