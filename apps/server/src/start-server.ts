import { createDesktopAppUpdateService } from "./services/system/desktop-app-update.js";
import { createDesktopUpdateChannel } from "./services/system/desktop-update-channel.js";
import { serve } from "@hono/node-server";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerConfig } from "@bb/config/server";
import { isLoopbackHostname } from "@bb/config/loopback";
import { toOptionalString } from "@bb/config/strings";
import { createLogger } from "@bb/logger";
import { z } from "zod";
import {
  getAppSettings,
  getDisabledProviderIds,
  listRunningThreads,
  setAppSettings,
} from "@bb/db";
import { initDb } from "./db.js";
import { createApp } from "./server.js";
import { PendingInteractionLifecycle } from "./services/interactions/pending-interactions.js";
import { createMachineAuthService } from "./services/machine-auth.js";
import { resolveBuiltinSkillsRootPath } from "./services/skills/builtin-skills-copy.js";
import { SkillTreeRegistry } from "./services/skills/injected-skills.js";
import { PluginHostArtifactRegistry } from "./services/plugins/plugin-host-artifact-registry.js";
import { createProviderNativeRootsCache } from "./services/providers/native-roots.js";
import { createAiServiceRegistry } from "./services/ai/ai-service-registry.js";
import { createAppUpdateService } from "./services/system/app-update.js";
import {
  createCliCommandService,
  createWindowsUserPath,
} from "./services/system/cli-command.js";
import { createAppVersionService } from "./services/system/app-version.js";
import { createLauncherChannel } from "./services/system/launcher-channel.js";
import { createBbAppManagedConfigReloader } from "./services/system/bb-app-managed-config.js";
import { startGatedPerformanceDiagnostics } from "./services/system/performance-diagnostics.js";
import { startEventLoopStallMonitor } from "./services/system/event-loop-stall-monitor.js";
import {
  runPeriodicSweeps,
  runStartupRecoverySweep,
} from "./services/system/periodic-sweeps.js";
import { installProviderModelCatalogPrewarm } from "./services/providers/provider-model-catalog-prewarm.js";
import {
  createProviderRegistryService,
  type ProviderRegistryService,
} from "./services/providers/provider-registry.js";
import type { PluginService } from "./services/plugins/plugin-service.js";
import {
  appInstallFromServerConfig,
  createTelemetryService,
} from "./services/system/telemetry.js";
import { TerminalSessionLifecycle } from "./services/terminals/terminal-session-lifecycle.js";
import { RelayTerminalDataPlane } from "./services/terminals/terminal-data-plane-relay.js";
import { TerminalRelaySupervisor } from "./terminal-relay/terminal-relay-supervisor.js";
import type { TerminalRelayToMainMessage } from "./terminal-relay/terminal-relay-ipc.js";
import { installUpgradeDispatcher } from "./ws/upgrade-dispatcher.js";
import {
  isServerMoveSnapshotFenced,
  onServerMoveSnapshotFence,
} from "./services/server-move/freeze-state.js";
import { createLifecycleDedupers } from "./lifecycle-dedupers.js";
import type { ServerLogger, ServerRuntimeConfig } from "./types.js";
import { NotificationHub } from "./ws/hub.js";
import { startDaemonLivenessChecks } from "./ws/daemon-protocol.js";
import { WatchInterestCoordinator } from "./ws/watch-interests.js";
import { WorkspaceReadCaches } from "./services/environments/workspace-read-cache.js";
import { HostSharedPortCoordinator } from "./ws/host-shared-ports.js";
import { disconnectImportedDaemonSessions } from "./internal/session-owner-side-effects.js";
import {
  applyServerImportAtBoot,
  refuseInterruptedServerImport,
  repairLastServerMoveHostName,
} from "./services/server-move/pending-boot.js";
import { createConnectHold } from "./services/server-move/connect-hold.js";
import { isServerMoveFrozen } from "./services/server-move/freeze-state.js";
import { reconcileServerMoveRunAtBoot } from "./services/server-move/reconcile.js";
import {
  retireServerProcess as retireProcessWithDeadline,
  SERVER_RETIRE_FORCE_EXIT_MS,
} from "./services/server-move/retire.js";
import {
  PluginToolCallRegistry,
  setPluginToolCallRegistry,
} from "./services/plugins/plugin-tool-calls.js";

interface StartHttpListenerArgs {
  fetch: Parameters<typeof serve>[0]["fetch"];
  serverConfig: Pick<ServerConfig, "BB_SERVER_BIND_HOST" | "BB_SERVER_PORT">;
}

export function startHttpListener(args: StartHttpListenerArgs) {
  return serve({
    hostname: args.serverConfig.BB_SERVER_BIND_HOST,
    port: args.serverConfig.BB_SERVER_PORT,
    fetch: args.fetch,
  });
}

export interface StartServerPluginsArgs {
  dataDir: string;
  logger: Pick<ServerLogger, "error" | "warn">;
  pluginService: Pick<PluginService, "start" | "startPeriodicUpdateChecks">;
  providerRegistry: Pick<ProviderRegistryService, "markRegistrationsSettled">;
}

export function startServerPlugins(
  args: StartServerPluginsArgs,
): Promise<void> {
  return args.pluginService
    .start({
      hold: createConnectHold({ dataDir: args.dataDir, logger: args.logger }),
    })
    .catch((error: unknown) => {
      args.logger.error({ err: error }, "Plugin startup failed");
    })
    .finally(() => {
      args.providerRegistry.markRegistrationsSettled();
      args.pluginService.startPeriodicUpdateChecks();
    });
}

export async function runServer(serverConfig: ServerConfig): Promise<void> {
  const logger = createLogger({
    component: "server",
    dataDir: serverConfig.BB_DATA_DIR,
  });
  await refuseInterruptedServerImport({
    dataDir: serverConfig.BB_DATA_DIR,
    logger,
  });
  let diagnosticsEnabled = () => false;
  const db = initDb(serverConfig.databasePath, {
    slowQueryThresholdMs: () => (diagnosticsEnabled() ? 25 : 100),
    slowQueryDiagnosticsEnabled: () => diagnosticsEnabled(),
    dataDir: serverConfig.BB_DATA_DIR,
    logger,
  });
  const serverImport = await applyServerImportAtBoot({
    dataDir: serverConfig.BB_DATA_DIR,
    db,
    logger,
    now: Date.now(),
  });
  const pendingServerMove = serverImport.pendingMove;
  if (pendingServerMove === null) {
    await repairLastServerMoveHostName({
      dataDir: serverConfig.BB_DATA_DIR,
      db,
      logger,
    });
  }
  if (serverConfig.BB_SKIP_ONBOARDING) {
    const settings = getAppSettings(db);
    if (settings.onboardingCompletedAt === null) {
      setAppSettings(db, {
        ...settings,
        onboardingCompletedAt: new Date().toISOString(),
      });
    }
  }
  const serverMoveRun =
    pendingServerMove === null
      ? await reconcileServerMoveRunAtBoot({
          dataDir: serverConfig.BB_DATA_DIR,
          logger,
          now: Date.now(),
        })
      : null;
  const hub = new NotificationHub();
  const watchInterests = new WatchInterestCoordinator({ db, hub });
  const sharedPorts = new HostSharedPortCoordinator({ db, hub });
  const workspaceReadCaches = new WorkspaceReadCaches({ hub });
  const lifecycleDedupers = createLifecycleDedupers();
  const appUrl = toOptionalString(serverConfig.BB_APP_URL);

  const selfDir = dirname(fileURLToPath(import.meta.url));
  const appDir = resolve(selfDir, "../../app");
  const appDistDir = join(appDir, "dist");
  const isProduction = process.env.NODE_ENV === "production";
  const staticDir =
    isProduction && existsSync(appDistDir) ? appDistDir : undefined;
  const runtimeConfig: ServerRuntimeConfig = {
    appVersion: serverConfig.BB_APP_VERSION,
    builtinSkillsRootPath: resolveBuiltinSkillsRootPath(),
    marketplaceUrl: serverConfig.BB_MARKETPLACE_URL,
    customModels: [],
    dataDir: serverConfig.BB_DATA_DIR,
    featureFlags: serverConfig.featureFlags,
    hostDaemonPort: serverConfig.BB_HOST_DAEMON_PORT,
    inheritedSkillsRootPaths: serverConfig.BB_INHERITED_SKILLS_ROOTS,
    isDevelopment: !isProduction,
    performanceDiagnosticsAvailable: serverConfig.BB_PERF_DIAGNOSTICS,
    serverPort: serverConfig.BB_SERVER_PORT,
    sharedSkillRoots: { user: [], project: [] },
  };

  const providerRegistry = createProviderRegistryService({
    deferRegistrationsSettled: true,
    readUserProviderPreferences: () => {
      const settings = getAppSettings(db);
      return {
        providerOrder: settings.providerOrder,
        disabledProviderIds: getDisabledProviderIds(db),
        defaultProviderId: settings.defaultProviderId,
      };
    },
  });

  if (appUrl !== undefined) {
    runtimeConfig.appUrl = appUrl;
  }
  if (serverConfig.BB_DEV_APP_PORT !== undefined) {
    runtimeConfig.devAppPort = serverConfig.BB_DEV_APP_PORT;
  }
  if (serverConfig.BB_SERVER_LAUNCH_ID !== undefined) {
    runtimeConfig.launchId = serverConfig.BB_SERVER_LAUNCH_ID;
  }
  const relayEnabled =
    z.enum(["on", "off"]).optional().parse(process.env.BB_TERMINAL_RELAY) !==
    "off";
  let relayPlane: RelayTerminalDataPlane | null = null;
  let terminalSessions: TerminalSessionLifecycle;
  const relay = relayEnabled
    ? new TerminalRelaySupervisor({
        entryPath:
          extname(fileURLToPath(import.meta.url)) === ".ts"
            ? join(selfDir, "terminal-relay", "terminal-relay-main.ts")
            : join(selfDir, "terminal-relay.js"),
        env: { ...process.env, BB_DATA_DIR: serverConfig.BB_DATA_DIR },
        execArgv: process.execArgv,
        execPath: process.execPath,
        logger,
        onRestart: () => {
          relayPlane?.reset();
          terminalSessions.resendRelayState();
          relay?.send({
            type: "move-fence",
            pending:
              pendingServerMove !== null || isServerMoveSnapshotFenced(db),
          });
        },
        onMessage: (message: TerminalRelayToMainMessage) => {
          if (message.type === "log") {
            logger.warn(
              { ...message.details, source: "terminal-relay" },
              message.message,
            );
            return;
          }
          if (!relayPlane) return;
          try {
            switch (message.type) {
              case "attach-requested": {
                const decision = terminalSessions.decideRelayAttach(
                  message.terminalId,
                );
                relay?.send({
                  type: "attach-decision",
                  socketId: message.socketId,
                  ...decision,
                });
                return;
              }
              case "browser-input":
                terminalSessions.onRelayBrowserInput({
                  terminalId: message.terminalId,
                  dataBase64: message.dataBase64,
                  socket: relayPlane.socketForId(message.socketId),
                });
                return;
              case "browser-resize":
                terminalSessions.onRelayBrowserResize({
                  terminalId: message.terminalId,
                  cols: message.cols,
                  rows: message.rows,
                  socket: relayPlane.socketForId(message.socketId),
                });
                return;
              case "terminal-exited":
                terminalSessions.onTerminalExited(message);
                return;
              case "attach-error":
                terminalSessions.onAttachError({ ...message });
                return;
              case "replay":
                terminalSessions.onReplay({
                  daemonSessionId: message.daemonSessionId,
                  message: {
                    type: "terminal.replay",
                    terminalId: message.terminalId,
                    requestId: message.requestId,
                    chunks: message.chunks,
                    replayStartSeq: message.replayStartSeq,
                    nextSeq: message.nextSeq,
                  },
                });
                return;
              case "daemon-data-socket-opened":
                relayPlane.daemonOpened(message.sessionId);
                terminalSessions.onDaemonDataSocketOpened(message.sessionId);
                return;
              case "daemon-data-socket-closed":
                relayPlane.daemonClosed(message.sessionId);
                terminalSessions.onDaemonDataSocketClosed(message.sessionId);
                return;
              case "daemon-send-failed":
                terminalSessions.onDaemonSendFailed(message.sessionId);
                return;
              case "metrics":
                relayPlane.updateClients(message.clients);
                return;
              case "ready":
                logger.info({ pid: message.pid }, "Terminal relay ready");
                return;
            }
          } catch (error) {
            logger.error(
              { err: error, messageType: message.type },
              "Terminal relay message failed",
            );
            if (message.type === "attach-requested") {
              relay?.send({
                type: "send-socket-message",
                socketId: message.socketId,
                message: {
                  type: "error",
                  code: "terminal_socket_error",
                  message: "Terminal session could not be attached",
                },
              });
              relay?.send({
                type: "close-socket",
                socketId: message.socketId,
                code: 1008,
                reason: "terminal_socket_error",
              });
            }
          }
        },
      })
    : null;
  const stopRelayFence = relay
    ? onServerMoveSnapshotFence(db, (pending) => {
        relay.send({ type: "move-fence", pending });
      })
    : null;
  terminalSessions = new TerminalSessionLifecycle({
    config: runtimeConfig,
    db,
    hub,
    logger,
    ...(relay === null
      ? {}
      : {
          sendRelayDaemonDataMessage: (daemonSessionId, message) =>
            relayPlane?.sendDaemonDataMessage(daemonSessionId, message) ??
            false,
          dataPlane: () => {
            relayPlane = new RelayTerminalDataPlane(relay);
            return relayPlane;
          },
        }),
  });
  const bbAppManagedConfig = await createBbAppManagedConfigReloader({
    config: runtimeConfig,
    hub,
    logger,
  });

  const telemetry = await createTelemetryService({
    apiKey: serverConfig.BB_POSTHOG_API_KEY,
    appInstall: appInstallFromServerConfig(serverConfig),
    appSurface: serverConfig.BB_APP_SURFACE,
    appVersion: serverConfig.BB_APP_VERSION,
    dataDir: serverConfig.BB_DATA_DIR,
    enabled:
      serverConfig.BB_TELEMETRY && isProduction && pendingServerMove === null,
    telemetryEnabled: getAppSettings(db).telemetryEnabled,
    logger,
  });

  const machineAuth = await createMachineAuthService({
    dataDir: serverConfig.BB_DATA_DIR,
    db,
    logger,
  });
  await machineAuth.ensureReady();
  const skillTreeRegistry = new SkillTreeRegistry();
  const pluginHostArtifacts = new PluginHostArtifactRegistry();
  const providerNativeRoots = createProviderNativeRootsCache();
  const aiServices = createAiServiceRegistry({
    onStatusChange: () => hub.notifySystem(["config-changed"]),
  });
  const pendingInteractions = new PendingInteractionLifecycle({
    config: runtimeConfig,
    db,
    hub,
    lifecycleDedupers,
    logger,
    machineAuth,
    providerRegistry,
    pluginHostArtifacts,
    aiServices,
    skillTreeRegistry,
    telemetry,
    terminalSessions,
  });
  pendingInteractions.start();
  setPluginToolCallRegistry(new PluginToolCallRegistry({ logger }));

  const appVersion = createAppVersionService({
    installKind: serverConfig.BB_APP_INSTALL_KIND ?? null,
    sourceCommit: serverConfig.BB_APP_SOURCE_COMMIT ?? null,
    config: runtimeConfig,
    logger,
  });
  const appUpdateMode = serverConfig.BB_APP_UPDATE_MODE ?? null;
  const desktopUpdateChannel =
    serverConfig.BB_APP_SURFACE === "desktop"
      ? createDesktopUpdateChannel(process)
      : null;
  const appUpdate =
    desktopUpdateChannel === null
      ? createAppUpdateService({
          currentCommit:
            serverConfig.BB_APP_INSTALL_KIND === "source"
              ? (serverConfig.BB_APP_SOURCE_COMMIT ?? null)
              : null,
          appSurface: serverConfig.BB_APP_SURFACE,
          appVersion,
          config: runtimeConfig,
          countRunningThreads: () => listRunningThreads(db).length,
          launcher:
            appUpdateMode === null ? null : createLauncherChannel(process),
          logger,
          mode: appUpdateMode,
          notifyChanged: () => hub.notifySystem(["app-update-changed"]),
        })
      : createDesktopAppUpdateService({
          channel: desktopUpdateChannel,
          currentVersion: runtimeConfig.appVersion,
          dataDir: serverConfig.BB_DATA_DIR,
          countRunningThreads: () => listRunningThreads(db).length,
          notifyChanged: () => hub.notifySystem(["app-update-changed"]),
          logger,
        });
  const cliCommand = createCliCommandService({
    env: process.env,
    homeDir: homedir(),
    launcherPath: serverConfig.BB_CLI_LAUNCHER ?? null,
    platform: process.platform,
    windowsUserPath: createWindowsUserPath(process.env),
  });
  const {
    app,
    closeWebSockets,
    injectWebSocket,
    pluginCatalogService,
    pluginService,
    serverMove,
  } = createApp(
    {
      appUpdate,
      appVersion,
      bbAppManagedConfig,
      cliCommand,
      config: runtimeConfig,
      db,
      hub,
      lifecycleDedupers,
      logger,
      machineAuth,
      pendingInteractions,
      providerRegistry,
      pluginHostArtifacts,
      providerNativeRoots,
      aiServices,
      skillTreeRegistry,
      telemetry,
      terminalSessions,
      watchInterests,
      sharedPorts,
      workspaceReadCaches,
    },
    {
      serverMove: {
        appSurface: serverConfig.BB_APP_SURFACE,
        bindHost: serverConfig.BB_SERVER_BIND_HOST,
        manualImportPending: serverImport.manualImportPending,
        pending: pendingServerMove,
        restoredRun: serverMoveRun,
        retireProcess: retireServerProcess,
      },
      staticDir,
      performanceDiagnosticsEnabled: () => diagnosticsEnabled(),
      terminalRelay: relay !== null,
    },
  );
  if (relay) void relay.start();
  disconnectImportedDaemonSessions(
    {
      config: runtimeConfig,
      db,
      hub,
      lifecycleDedupers,
      logger,
      machineAuth,
      pendingInteractions,
      providerRegistry,
      pluginHostArtifacts,
      aiServices,
      skillTreeRegistry,
      telemetry,
      terminalSessions,
    },
    { sessions: serverImport.importedDaemonSessions },
  );
  const performanceDiagnostics = await startGatedPerformanceDiagnostics({
    allowed: serverConfig.BB_PERF_DIAGNOSTICS,
    dataDir: serverConfig.BB_DATA_DIR,
    db,
    hub,
    logger,
  });
  diagnosticsEnabled = performanceDiagnostics.isEnabled;
  const eventLoopStallMonitor = startEventLoopStallMonitor({
    logger,
    thresholdMs: () => (diagnosticsEnabled() ? 100 : 500),
  });
  const stopDaemonLivenessChecks = startDaemonLivenessChecks({
    config: runtimeConfig,
    db,
    hub,
    lifecycleDedupers,
    logger,
    machineAuth,
    pendingInteractions,
    providerRegistry,
    pluginHostArtifacts,
    aiServices,
    sharedPorts,
    skillTreeRegistry,
    telemetry,
    terminalSessions,
  });

  const sweepDeps = {
    config: runtimeConfig,
    db,
    hub,
    lifecycleDedupers,
    logger,
    machineAuth,
    pendingInteractions,
    providerRegistry,
    pluginHostArtifacts,
    aiServices,
    skillTreeRegistry,
    pluginSchedules: pluginService,
    plugins: pluginService,
    telemetry,
    terminalSessions,
  };
  const providerModelCatalogPrewarm =
    pendingServerMove === null
      ? installProviderModelCatalogPrewarm(sweepDeps)
      : null;
  if (pendingServerMove === null) {
    await runStartupRecoverySweep(sweepDeps).catch((error) => {
      logger.error({ err: error }, "Startup recovery sweep failed");
    });
  }

  if (!isLoopbackHostname(serverConfig.BB_SERVER_BIND_HOST)) {
    logger.warn(
      { bindHost: serverConfig.BB_SERVER_BIND_HOST },
      "SECURITY WARNING: The public API is unauthenticated and permits command execution and file reads. Wildcard server binding must only be used behind a trusted network boundary.",
    );
  }

  const server = startHttpListener({
    fetch: app.fetch,
    serverConfig,
  });
  injectWebSocket(server);
  if (relay) {
    installUpgradeDispatcher(server, {
      app,
      logger,
      onTerminalUpgrade: ({ grant, head, request }) => {
        if (!relay.isReady()) return false;
        if (isServerMoveSnapshotFenced(db)) {
          relay.send({ type: "move-fence", pending: true });
          return false;
        }
        const headers = Object.fromEntries(
          Object.entries(request.headers)
            .filter(
              (entry): entry is [string, string | string[]] =>
                entry[1] !== undefined,
            )
            .map(([key, value]) => [
              key,
              Array.isArray(value) ? value.join(", ") : value,
            ]),
        );
        request.socket.pause();
        const details = {
          head: head.toString("base64"),
          headers,
          method: request.method ?? "GET",
          url: request.url ?? "/",
        };
        return grant.kind === "browser"
          ? relay.send(
              { type: "accept-browser", grant, ...details },
              request.socket,
            )
          : relay.send(
              { type: "accept-daemon-data", grant, ...details },
              request.socket,
            );
      },
    });
  }

  logger.info(
    {
      bindHost: serverConfig.BB_SERVER_BIND_HOST,
      port: serverConfig.BB_SERVER_PORT,
      dataDir: serverConfig.BB_DATA_DIR,
    },
    "Server listening",
  );
  pluginService.bindSdk({
    baseUrl: `http://127.0.0.1:${serverConfig.BB_SERVER_PORT}`,
  });
  let sweepInterval: ReturnType<typeof setInterval> | null = null;
  if (pendingServerMove === null) {
    telemetry.capture({ name: "app_started" });
    if (serverMoveRun?.kind === "completed") {
      logger.info(
        { moveId: serverMoveRun.run.status.moveId },
        "This server already moved before it restarted; retiring without starting plugins",
      );
      providerRegistry.markRegistrationsSettled();
    } else {
      void startServerPlugins({
        dataDir: serverConfig.BB_DATA_DIR,
        logger,
        pluginService,
        providerRegistry,
      }).finally(() => {
        void serverMove.handlePluginsStarted();
      });
    }
    pluginCatalogService.startPeriodicRefresh();
    sweepInterval = setInterval(() => {
      if (!isServerMoveFrozen(db)) {
        void runPeriodicSweeps(sweepDeps);
      }
    }, 10_000);
    sweepInterval.unref();
  } else {
    logger.info(
      { moveId: pendingServerMove.moveId },
      "Server started in pending move mode; waiting for the target machine to activate it",
    );
  }

  let shutdownPromise: Promise<void> | null = null;
  const runShutdown = (): Promise<void> => {
    if (shutdownPromise) {
      return shutdownPromise;
    }
    shutdownPromise = (async () => {
      stopRelayFence?.();
      serverMove.dispose();
      appUpdate.dispose();
      providerModelCatalogPrewarm?.stop();
      eventLoopStallMonitor.stop();
      await performanceDiagnostics.stop();
      stopDaemonLivenessChecks();
      if (sweepInterval !== null) {
        clearInterval(sweepInterval);
      }
      pluginCatalogService.stopPeriodicRefresh();
      await pluginService.stopPeriodicUpdateChecks();
      if (pendingServerMove === null) {
        await pluginService.stop().catch((error: unknown) => {
          logger.warn({ err: error }, "Plugin shutdown failed");
        });
      }
      const closeServer = new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      await closeWebSockets();
      await relay?.stop();
      await closeServer;
    })();
    return shutdownPromise;
  };

  function retireServerProcess(): void {
    logger.info({}, "Server moved to another machine; shutting down");
    retireProcessWithDeadline({
      exit: (code) => process.exit(code),
      forceExitAfterMs: SERVER_RETIRE_FORCE_EXIT_MS,
      shutdown: runShutdown,
    });
  }

  process.on("uncaughtException", (error: unknown) => {
    if (pluginService.handleUncaughtException(error)) return;
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });

  process.once("SIGINT", () => {
    void runShutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void runShutdown().finally(() => process.exit(0));
  });
}
