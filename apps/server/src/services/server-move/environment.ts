import { statfs } from "node:fs/promises";
import type { AppSurface } from "@bb/config/app-surface";
import type { ServerBindHost } from "@bb/config/server";
import type {
  AppDeps,
  LoggedPendingInteractionWorkSessionDeps,
} from "../../types.js";
import { resumeEnvironmentProvisioningForHost } from "../environments/environment-engine.js";
import { serverAccess } from "../machines/server-access.js";
import type { PluginService } from "../plugins/plugin-service.js";
import { requestQueuedMessageDispatch } from "../threads/queued-message-dispatch.js";
import type {
  ServerMoveEnvironment,
  ServerMoveTimings,
} from "./coordinator.js";
import { exportServerArchive } from "./export.js";
import { createFullBbAppArtifactService } from "./full-artifact.js";
import { CONNECT_PLUGIN_SOURCE, resolveServerMoveMode } from "./mode.js";
import { stopRunningServerWork } from "./stop-work.js";

export const SERVER_MOVE_ALLOW_LOOPBACK_URL_ENV =
  "BB_SERVER_MOVE_ALLOW_LOOPBACK_URL";
export const SERVER_MOVE_TARGET_PORT_ENV = "BB_SERVER_MOVE_TARGET_PORT";
const SERVER_MOVE_ARCHIVE_FILE_NAME = "server.tar.gz";

export const SERVER_MOVE_TIMINGS: ServerMoveTimings = {
  abortTimeoutMs: 60_000,
  activateAttemptTimeoutMs: 15_000,
  activateRetryDelayMs: 1_000,
  activateRetryWindowMs: 60_000,
  inspectTimeoutMs: 30_000,
  pluginShutdownTimeoutMs: 30_000,
  prepareTimeoutMs: 30 * 60_000,
  probeTimeoutMs: 30_000,
  recoveryProbeIntervalMs: 5_000,
  retireDelayMs: 2_000,
  stopWorkTimeoutMs: 5 * 60_000,
};

export interface CreateDefaultServerMoveEnvironmentArgs {
  appSurface: AppSurface;
  bindHost: ServerBindHost | null;
  deps: AppDeps;
  env: NodeJS.ProcessEnv;
  pluginService: PluginService;
  retireProcess(): void;
  serverEntryUrl: string;
}

export async function readDiskFreeBytes(path: string): Promise<number | null> {
  try {
    const stats = await statfs(path);
    const free = Number(stats.bavail) * Number(stats.bsize);
    return Number.isSafeInteger(free) && free >= 0 ? free : null;
  } catch {
    return null;
  }
}

export function allowsLoopbackServerMoveUrl(env: NodeJS.ProcessEnv): boolean {
  return env[SERVER_MOVE_ALLOW_LOOPBACK_URL_ENV] === "1";
}

export function parseServerMoveTargetPort(
  env: NodeJS.ProcessEnv,
): number | null {
  const raw = env[SERVER_MOVE_TARGET_PORT_ENV];
  if (raw === undefined || raw.trim().length === 0) {
    return null;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `${SERVER_MOVE_TARGET_PORT_ENV} must be a port between 1 and 65535`,
    );
  }
  return port;
}

export function resumeServerMoveDeferredWork(
  deps: LoggedPendingInteractionWorkSessionDeps,
): void {
  for (const hostId of deps.hub.listConnectedHostIds()) {
    const daemonSessionId = deps.hub.getDaemonSessionIdForHost(hostId);
    if (daemonSessionId !== null) {
      deps.terminalSessions.reconcileDisconnectedHostTerminals({
        daemonSessionId,
        hostId,
      });
    }
    requestQueuedMessageDispatch(deps, { hostId, kind: "host-connected" });
    void resumeEnvironmentProvisioningForHost(deps, { hostId }).catch(
      (error: unknown) => {
        deps.logger.warn(
          { err: error, hostId },
          "Environment provisioning resume after a server move failed",
        );
      },
    );
  }
}

export function createDefaultServerMoveEnvironment(
  args: CreateDefaultServerMoveEnvironmentArgs,
): ServerMoveEnvironment {
  const { deps, pluginService } = args;
  const targetPortOverride = parseServerMoveTargetPort(args.env);
  return {
    allowLoopbackServerUrl: allowsLoopbackServerMoveUrl(args.env),
    bindHost: args.bindHost,
    deps,
    exportArchive: (exportArgs) =>
      exportServerArchive({
        appVersion: deps.config.appVersion,
        dataDir: deps.config.dataDir,
        db: deps.db,
        fileName: SERVER_MOVE_ARCHIVE_FILE_NAME,
        logger: deps.logger,
        now: Date.now(),
        sourceServerHostId: exportArgs.sourceServerHostId,
        workDir: exportArgs.workDir,
      }),
    fullArtifact: createFullBbAppArtifactService({
      dataDir: deps.config.dataDir,
      serverEntryUrl: args.serverEntryUrl,
    }),
    now: Date.now,
    plugins: {
      resumeSuspended: async () => {
        await pluginService.resumeSuspendedPlugins();
      },
      setSchedulesPaused: (paused) => pluginService.setSchedulesPaused(paused),
      stop: () => pluginService.stop(),
      suspendAllButConnect: async () => {
        await pluginService.suspendPlugins({
          keep: (plugin) => plugin.source === CONNECT_PLUGIN_SOURCE,
        });
      },
    },
    readServerDiskFreeBytes: () => readDiskFreeBytes(deps.config.dataDir),
    resolveMode: () => resolveServerMoveMode(deps, pluginService),
    resolveServerHostGrant: async (hostId, signal) => {
      const grant = await serverAccess.resolve(deps, {
        key: hostId,
        hostId,
        signal,
      });
      return { serverUrl: grant.serverUrl, headers: grant.headers ?? {} };
    },
    resumeDeferredWork: () => resumeServerMoveDeferredWork(deps),
    retireProcess: args.retireProcess,
    serverAppSurface: args.appSurface,
    serverTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    stopRunningWork: (stopArgs) => stopRunningServerWork(deps, stopArgs),
    targetServerPort: () => targetPortOverride ?? deps.config.serverPort,
    timings: SERVER_MOVE_TIMINGS,
  };
}
