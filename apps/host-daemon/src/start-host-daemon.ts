import { randomUUID } from "node:crypto";
import {
  loadHostDaemonStartConfig,
  type HostDaemonConnectionConfig,
} from "@bb/config/host-daemon";
import { resolveAppsRootPath } from "@bb/config/app-storage-paths";
import type { HostType, ToolCallRequest, ToolCallResponse } from "@bb/domain";
import { createHostWatcher, type HostWatcher } from "@bb/host-watcher";
import { createLogger } from "@bb/logger";
import { type CreateHostDaemonAppOptions, createHostDaemonApp } from "./app.js";
import {
  readHostAuthState,
  resolveServerUrl,
  writeHostAuthState,
} from "./auth-state.js";
import type { HostDaemon } from "./daemon.js";
import { enrollDaemonHost } from "./enroll.js";
import { loadHostIdentity, persistHostId } from "./identity.js";
import { acquireDaemonLock } from "./lock.js";
import {
  resolveHostDaemonLocalApiConfig,
  type HostDaemonLocalApiOverrides,
} from "./local-api-config.js";
import {
  prepareRuntimeShellEnv,
  resolveLocalBbExecutableDirectory,
} from "./runtime-shell-env.js";
import type { HostDaemonLogger } from "./logger.js";
import type { CreateReconnectingWebSocket } from "./server-connection.js";

export interface StartHostDaemonOptions {
  dataDir?: string;
  serverUrl?: string;
  hostDaemonPort?: number;
  enrollKey?: string;
  hostId?: string;
  hostName?: string;
  bbExecutableDirectory?: string;
  bridgeBundleDir?: string;
  hostType?: HostType;
  enableLocalApi?: boolean;
  localApi?: HostDaemonLocalApiOverrides;
  logger?: HostDaemonLogger;
  createInstanceId?: () => string;
  acquireLock?: typeof acquireDaemonLock;
  loadIdentity?: typeof loadHostIdentity;
  createRuntime?: CreateHostDaemonAppOptions["createRuntime"];
  hostWatcher?: HostWatcher;
  onToolCall?: (request: ToolCallRequest) => Promise<ToolCallResponse>;
  pickFolder?: () => Promise<string | null>;
  fetchFn?: typeof fetch;
  createWebSocket?: CreateReconnectingWebSocket;
}

function requireHostDaemonConfig(
  config: HostDaemonConnectionConfig | undefined,
): HostDaemonConnectionConfig {
  if (config === undefined) {
    throw new Error("Host daemon config is required");
  }

  return config;
}

export async function startHostDaemon(
  options: StartHostDaemonOptions = {},
): Promise<HostDaemon> {
  const enableLocalApi = options.enableLocalApi ?? true;
  const resolvedConfig = loadHostDaemonStartConfig({
    dataDir: options.dataDir,
    enableLocalApi,
    hostDaemonPort: options.hostDaemonPort ?? options.localApi?.port,
    serverUrl: options.serverUrl,
  });
  const dataDir = resolvedConfig.dataDir;
  const hostDaemonConfig = resolvedConfig.connectionConfig;
  if (dataDir === undefined) {
    throw new Error("Host daemon data directory is required");
  }
  const releaseLock = await (options.acquireLock ?? acquireDaemonLock)(dataDir);

  let app: Awaited<ReturnType<typeof createHostDaemonApp>> | undefined;
  try {
    const persistedAuth = await readHostAuthState(dataDir);
    const identity = await (options.loadIdentity ?? loadHostIdentity)({
      dataDir,
      providedHostId: options.hostId,
      providedHostName: options.hostName,
    });
    const instanceId = (options.createInstanceId ?? randomUUID)();
    const serverUrl = resolveServerUrl({
      providedServerUrl: options.serverUrl ?? hostDaemonConfig?.BB_SERVER_URL,
    });
    if (!serverUrl) {
      throw new Error("Host daemon server URL is required");
    }

    const hostType =
      persistedAuth?.hostType ?? options.hostType ?? "persistent";
    if (
      persistedAuth &&
      options.hostType &&
      persistedAuth.hostType !== options.hostType
    ) {
      throw new Error(
        `Configured host type ${options.hostType} does not match persisted auth state ${persistedAuth.hostType}`,
      );
    }

    if (persistedAuth && persistedAuth.hostId !== identity.hostId) {
      throw new Error(
        `Resolved host ID ${identity.hostId} does not match persisted auth state ${persistedAuth.hostId}`,
      );
    }

    const hostKey =
      persistedAuth?.hostKey ??
      (
        await enrollDaemonHost({
          fetchFn: options.fetchFn,
          hostId: identity.hostId,
          hostName: identity.hostName,
          hostType,
          serverUrl,
          token:
            options.enrollKey ??
            (() => {
              throw new Error(
                `Missing host bootstrap material. Provide BB_HOST_ENROLL_KEY or populate ${dataDir}/auth.json first.`,
              );
            })(),
        })
      ).hostKey;

    if (!persistedAuth) {
      await persistHostId({ dataDir, hostId: identity.hostId });
      await writeHostAuthState(dataDir, {
        hostId: identity.hostId,
        hostKey,
        hostType,
      });
    }

    const localApiConfig = enableLocalApi
      ? resolveHostDaemonLocalApiConfig({
          hostDaemonPort:
            options.hostDaemonPort ??
            requireHostDaemonConfig(hostDaemonConfig).BB_HOST_DAEMON_PORT,
          hostType,
          localApi: options.localApi,
        })
      : null;
    const bbExecutableDirectory =
      options.bbExecutableDirectory ??
      (await resolveLocalBbExecutableDirectory());
    const hostWatcher =
      options.hostWatcher ??
      (await createHostWatcher({
        hostType,
      }));
    const runtimeShellEnv = prepareRuntimeShellEnv({
      appsRootPath: resolveAppsRootPath(dataDir),
      bbExecutableDirectory,
      hostDaemonPort: localApiConfig?.port,
      serverUrl,
    });
    app = await createHostDaemonApp({
      dataDir,
      serverUrl,
      hostKey,
      bridgeBundleDir: options.bridgeBundleDir,
      hostType,
      hostId: identity.hostId,
      hostName: identity.hostName,
      instanceId,
      appUrl:
        hostDaemonConfig?.BB_APP_URL === ""
          ? undefined
          : hostDaemonConfig?.BB_APP_URL,
      devAppPort: hostDaemonConfig?.BB_DEV_APP_PORT,
      devReplayCapture: hostDaemonConfig?.BB_DEV_REPLAY_CAPTURE ?? false,
      logger:
        options.logger ??
        createLogger({
          component: "host-daemon",
          base: { serverUrl },
          dataDir,
          transportMode: "worker",
        }),
      releaseLock,
      localApiConfig,
      createRuntime: options.createRuntime,
      runtimeShellEnv,
      hostWatcher,
      onToolCall: options.onToolCall,
      pickFolder: options.pickFolder,
      fetchFn: options.fetchFn,
      createWebSocket: options.createWebSocket,
    });
    await app.daemon.start();
    return app.daemon;
  } catch (error) {
    await app?.localApi?.close().catch(() => undefined);
    await releaseLock().catch(() => undefined);
    throw error;
  }
}
