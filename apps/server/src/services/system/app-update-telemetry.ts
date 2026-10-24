import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ServerLogger } from "../../types.js";
import { reportedProviderId } from "./provider-telemetry.js";
import type {
  AppUpdateEntry,
  AppUpdateMode,
  AppUpdateRestartReason,
  AppUpdateSaveResult,
  AppUpdateStopMethod,
  TelemetryService,
} from "./telemetry.js";

const MAX_COUNT = 50;
const MAX_SECONDS = 600;
const FLUSH_TIMEOUT_MS = 2_000;
const RESTART_MARKER_FILE_NAME = "bb-app-update-restart.json";

const restartMarkerSchema = z.object({
  restartStartedAt: z.number().int().nonnegative(),
  targetRevision: z.string().min(1),
});

export interface AppUpdateSettledThread {
  providerId: string;
  saveResult: AppUpdateSaveResult;
  stopMethod: AppUpdateStopMethod;
}

export interface AppUpdateTelemetry {
  restarting(args: {
    reason: AppUpdateRestartReason;
    targetRevision: string;
    threads: readonly AppUpdateSettledThread[];
    waitMs: number;
  }): Promise<void>;
  reportFinished(args: { threadsResumed: number }): Promise<void>;
  started(args: {
    entry: AppUpdateEntry;
    mode: AppUpdateMode;
    runningThreads: number;
  }): void;
}

function count(value: number): number {
  return Math.min(Math.max(0, Math.floor(value)), MAX_COUNT);
}

function seconds(ms: number): number {
  return Math.min(Math.max(0, Math.round(ms / 1000)), MAX_SECONDS);
}

export function createAppUpdateTelemetry(args: {
  currentRevision: string;
  dataDir: string;
  enabled: () => boolean;
  logger: ServerLogger;
  now?: () => number;
  telemetry: TelemetryService;
}): AppUpdateTelemetry {
  const now = args.now ?? Date.now;
  const markerPath = join(args.dataDir, RESTART_MARKER_FILE_NAME);

  const readMarker = async (): Promise<z.infer<
    typeof restartMarkerSchema
  > | null> => {
    try {
      return restartMarkerSchema.parse(
        JSON.parse(await readFile(markerPath, "utf8")),
      );
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      ) {
        args.logger.warn({ error }, "Ignoring an unreadable app update marker");
      }
      return null;
    }
  };

  return {
    started({ entry, mode, runningThreads }) {
      if (!args.enabled()) return;
      args.telemetry.capture({
        name: "app_update_started",
        properties: { running_threads: count(runningThreads), mode, entry },
      });
    },

    async restarting({ reason, targetRevision, threads, waitMs }) {
      try {
        await writeFile(
          markerPath,
          JSON.stringify({ restartStartedAt: now(), targetRevision }),
        );
      } catch (error) {
        args.logger.warn({ error }, "Could not record the app update restart");
      }
      if (!args.enabled()) return;
      for (const thread of threads) {
        args.telemetry.capture({
          name: "app_update_thread_settled",
          properties: {
            provider: reportedProviderId(thread.providerId),
            save_result: thread.saveResult,
            stop_method: thread.stopMethod,
          },
        });
      }
      args.telemetry.capture({
        name: "app_update_restart_started",
        properties: {
          threads_stopped: count(threads.length),
          threads_saved: count(
            threads.filter((thread) => thread.saveResult === "saved").length,
          ),
          threads_forced: count(
            threads.filter((thread) => thread.saveResult === "forced").length,
          ),
          wait_seconds: seconds(waitMs),
          reason,
        },
      });
      await args.telemetry.flush(FLUSH_TIMEOUT_MS);
    },

    async reportFinished({ threadsResumed }) {
      const marker = await readMarker();
      if (marker === null) return;
      await rm(markerPath, { force: true });
      if (!args.enabled()) return;
      args.telemetry.capture({
        name: "app_update_finished",
        properties: {
          threads_resumed: count(threadsResumed),
          offline_seconds: seconds(now() - marker.restartStartedAt),
          outcome:
            marker.targetRevision === args.currentRevision
              ? "succeeded"
              : "failed",
        },
      });
    },
  };
}
