import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { isNightlyAppVersion } from "@bb/config/app-update";
import type { DesktopAppUpdateInfo } from "@bb/config/desktop-app-update";
import { mutateManagedJsonFile } from "@bb/config/managed-json-file";
import {
  systemAppUpdateResultSchema,
  type SystemAppUpdateActivity,
  type SystemAppUpdateStatus,
} from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import type { ServerLogger } from "../../types.js";
import type { AppUpdateService } from "./app-update.js";
import type { DesktopUpdateChannel } from "./desktop-update-channel.js";

const stateSchema = z
  .object({
    schemaVersion: z.literal(1),
    pending: systemAppUpdateResultSchema.nullable(),
    lastResult: systemAppUpdateResultSchema.nullable(),
  })
  .passthrough();

export function createDesktopAppUpdateService(args: {
  channel: DesktopUpdateChannel;
  currentVersion: string;
  dataDir: string;
  countRunningThreads: () => number;
  notifyChanged: () => void;
  logger: ServerLogger;
}): AppUpdateService {
  const path = join(args.dataDir, "bb-desktop-app-update.json");
  let info: DesktopAppUpdateInfo | null = null;
  let updaterUnavailable = false;
  let activity: SystemAppUpdateActivity = { phase: "idle" };
  let applying = false;
  const abort = new AbortController();
  const readState = async (): Promise<z.infer<typeof stateSchema>> => {
    try {
      return stateSchema.parse(JSON.parse(await readFile(path, "utf8")));
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return { schemaVersion: 1, pending: null, lastResult: null };
      }
      throw error;
    }
  };
  let lastResult: SystemAppUpdateStatus["lastResult"] = null;
  const initialized = mutateManagedJsonFile({
    path,
    read: readState,
    mutate: (state) => {
      if (state.pending === null) return state;
      const updated = state.pending.to.version === args.currentVersion;
      return {
        ...state,
        pending: null,
        lastResult: {
          ...state.pending,
          finishedAt: new Date().toISOString(),
          message: updated
            ? null
            : `bb started ${args.currentVersion} instead of ${state.pending.to.version}.`,
          outcome: updated ? ("updated" as const) : ("failed" as const),
          phase: updated ? null : ("startup" as const),
        },
      };
    },
  }).then((state) => {
    lastResult = state.lastResult;
  });
  void initialized.catch((error: unknown) => {
    args.logger.warn({ error }, "Could not read desktop update state");
  });
  const unsubscribe = args.channel.subscribe((next) => {
    updaterUnavailable = next === null;
    if (next !== null) info = next;
    args.notifyChanged();
  });

  const refresh = async (forceRefresh: boolean): Promise<void> => {
    if (info !== null && !forceRefresh) return;
    try {
      info = await args.channel.request(forceRefresh ? "check" : "status");
      updaterUnavailable = false;
    } catch (error) {
      updaterUnavailable = true;
      args.logger.warn(
        { error },
        "Could not read the hosting desktop's updater",
      );
    }
  };
  const getStatus = async ({
    forceRefresh,
  }: {
    forceRefresh: boolean;
  }): Promise<SystemAppUpdateStatus> => {
    await initialized;
    await refresh(forceRefresh);
    const version = info?.pendingVersion ?? info?.latestVersion ?? null;
    return {
      ...(info?.supported === true
        ? { desktopUpdateSupported: true as const }
        : {}),
      support: { kind: "unsupported", reason: "desktop" },
      current: { commit: null, version: args.currentVersion },
      available:
        info?.updateAvailable === true && version !== null
          ? {
              channel: isNightlyAppVersion(version) ? "nightly" : "latest",
              commit: null,
              commitCount: null,
              subjects: [],
              version,
            }
          : null,
      blocked:
        info?.supported === true && (updaterUnavailable || version === null)
          ? {
              reason: "fetch-failed",
              message: "Couldn't check for a newer bb release.",
            }
          : null,
      activity,
      lastResult,
      runningThreadCount: args.countRunningThreads(),
    };
  };
  const waitForDownload = async (version: string): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      const finish = (error: Error | null): void => {
        clearTimeout(timer);
        stop();
        abort.signal.removeEventListener("abort", onAbort);
        if (error === null) resolve();
        else reject(error);
      };
      const check = (next: DesktopAppUpdateInfo | null): void => {
        if (next === null || !next.supported) {
          finish(new Error("The desktop app disconnected."));
        } else if (next.downloadState === "failed") {
          finish(new Error("Download failed. Update again to retry."));
        } else if (next.updateDownloaded) {
          finish(
            next.pendingVersion === version
              ? null
              : new Error(
                  "The available update changed. Update again to retry.",
                ),
          );
        }
      };
      const stop = args.channel.subscribe(check);
      const onAbort = (): void =>
        finish(new Error("The server is shutting down."));
      const timer = setTimeout(
        () =>
          finish(
            new Error("The update download timed out. Update again to retry."),
          ),
        15 * 60 * 1000,
      );
      abort.signal.addEventListener("abort", onAbort, { once: true });
      if (abort.signal.aborted) onAbort();
      else check(info);
    });
  };
  const runUpdate = async (
    version: string,
    confirmed: boolean,
  ): Promise<void> => {
    const result = {
      acknowledged: false,
      finishedAt: new Date().toISOString(),
      from: { commit: null, version: args.currentVersion },
      id: randomUUID(),
      logTail: [],
      message: null,
      outcome: "failed" as const,
      phase: "prepare" as const,
      to: { commit: null, version },
    };
    try {
      await waitForDownload(version);
      const count = args.countRunningThreads();
      if (count > 0 && !confirmed) {
        throw new Error(
          `${String(count)} thread${count === 1 ? "" : "s"} started while bb was downloading the update. Update again to restart.`,
        );
      }
      abort.signal.throwIfAborted();
      await mutateManagedJsonFile({
        path,
        read: readState,
        mutate: (state) => ({ ...state, pending: result }),
      });
      activity = {
        phase: "restarting",
        startedAt: new Date().toISOString(),
        targetCommit: null,
        targetVersion: version,
      };
      args.notifyChanged();
      await delay(1_500, undefined, { signal: abort.signal });
      await args.channel.request("install");
    } catch (error) {
      if (abort.signal.aborted) return;
      const failure: SystemAppUpdateStatus["lastResult"] = {
        ...result,
        finishedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : String(error),
        phase: activity.phase === "restarting" ? "install" : "prepare",
      };
      await mutateManagedJsonFile({
        path,
        read: readState,
        mutate: (state) => ({ ...state, pending: null, lastResult: failure }),
      });
      lastResult = failure;
      activity = { phase: "idle" };
      applying = false;
      args.notifyChanged();
    }
  };

  return {
    getStatus,
    async apply({ confirmInterruptingThreads }) {
      if (applying)
        throw new ApiError(
          409,
          "app_update_in_progress",
          "An update is already in progress.",
        );
      applying = true;
      try {
        const status = await getStatus({ forceRefresh: true });
        if (status.desktopUpdateSupported !== true)
          throw new ApiError(
            409,
            "app_update_unsupported",
            "The desktop app cannot install this update.",
          );
        if (status.blocked !== null)
          throw new ApiError(409, "app_update_blocked", status.blocked.message);
        if (status.available === null)
          throw new ApiError(
            409,
            "app_update_unavailable",
            "bb is already up to date.",
          );
        if (status.runningThreadCount > 0 && !confirmInterruptingThreads) {
          const count = status.runningThreadCount;
          throw new ApiError(
            409,
            "threads_running",
            `${String(count)} thread${count === 1 ? " is" : "s are"} running. Updating restarts bb and interrupts ${count === 1 ? "it" : "them"}.`,
            { details: { runningThreadCount: count } },
          );
        }
        activity = {
          phase: "preparing",
          output: [],
          startedAt: new Date().toISOString(),
          step: `Downloading bb-app ${status.available.version}`,
          targetVersion: status.available.version,
        };
        args.notifyChanged();
        void runUpdate(
          status.available.version,
          confirmInterruptingThreads,
        ).catch((error: unknown) => {
          args.logger.error(
            { error },
            "Could not record the desktop update result",
          );
          applying = false;
          activity = { phase: "idle" };
          args.notifyChanged();
        });
        return getStatus({ forceRefresh: false });
      } catch (error) {
        applying = false;
        throw error;
      }
    },
    async acknowledgeResult({ id }) {
      await initialized;
      const state = await mutateManagedJsonFile({
        path,
        read: readState,
        mutate: (state) => ({
          ...state,
          lastResult:
            state.lastResult?.id === id
              ? { ...state.lastResult, acknowledged: true }
              : state.lastResult,
        }),
      });
      lastResult = state.lastResult;
      args.notifyChanged();
      return getStatus({ forceRefresh: false });
    },
    dispose() {
      abort.abort();
      unsubscribe();
      args.channel.dispose();
    },
  };
}
