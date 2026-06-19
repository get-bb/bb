import { serve } from "@hono/node-server";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerConfig } from "@bb/config/server";
import { toOptionalString } from "@bb/config/strings";
import { createLogger } from "@bb/logger";
import { initDb } from "./db.js";
import { createApp } from "./server.js";
import { PendingInteractionLifecycle } from "./services/interactions/pending-interactions.js";
import { createMachineAuthService } from "./services/machine-auth.js";
import { PeerShareService } from "./services/peer-share/peer-share-service.js";
import { resolveBuiltinSkillsRootPath } from "./services/skills/builtin-skills-copy.js";
import { createAppVersionService } from "./services/system/app-version.js";
import { createBbAppManagedConfigReloader } from "./services/system/bb-app-managed-config.js";
import { startEventLoopStallMonitor } from "./services/system/event-loop-stall-monitor.js";
import {
  runPeriodicSweeps,
  runStartupRecoverySweep,
} from "./services/system/periodic-sweeps.js";
import { createTelemetryService } from "./services/system/telemetry.js";
import { TerminalSessionLifecycle } from "./services/terminals/terminal-session-lifecycle.js";
import { resolveThreadStorageRootPath } from "./services/threads/thread-storage.js";
import { createLifecycleDedupers } from "./lifecycle-dedupers.js";
import type { ServerRuntimeConfig } from "./types.js";
import { NotificationHub } from "./ws/hub.js";
import { WatchInterestCoordinator } from "./ws/watch-interests.js";

export async function runServer(serverConfig: ServerConfig): Promise<void> {
  const logger = createLogger({
    component: "server",
    dataDir: serverConfig.BB_DATA_DIR,
  });
  const db = initDb(serverConfig.databasePath, { logger });
  const hub = new NotificationHub();
  const watchInterests = new WatchInterestCoordinator({ db, hub });
  const terminalSessions = new TerminalSessionLifecycle({
    db,
    hub,
    logger,
  });
  const lifecycleDedupers = createLifecycleDedupers();
  const appUrl = toOptionalString(serverConfig.BB_APP_URL);
  const threadStorageRootPath = resolveThreadStorageRootPath({
    dataDir: serverConfig.BB_DATA_DIR,
  });

  const selfDir = dirname(fileURLToPath(import.meta.url));
  const appDistDir = resolve(selfDir, "../../app/dist");
  const isProduction = process.env.NODE_ENV === "production";
  const staticDir =
    isProduction && existsSync(appDistDir) ? appDistDir : undefined;
  const runtimeConfig: ServerRuntimeConfig = {
    appVersion: serverConfig.BB_APP_VERSION,
    automationsAllowScriptRuns: serverConfig.BB_AUTOMATIONS_ALLOW_SCRIPT_RUNS,
    builtinSkillsRootPath: resolveBuiltinSkillsRootPath(),
    customModels: [],
    dataDir: serverConfig.BB_DATA_DIR,
    featureFlags: serverConfig.featureFlags,
    hostDaemonPort: serverConfig.BB_HOST_DAEMON_PORT,
    inferenceModel: serverConfig.BB_INFERENCE,
    isDevelopment: !isProduction,
    openAiApiKey: serverConfig.OPENAI_API_KEY,
    serverPort: serverConfig.BB_SERVER_PORT,
    threadStorageRootPath,
    transcriptionModel: serverConfig.BB_TRANSCRIPTION,
  };

  if (appUrl !== undefined) {
    runtimeConfig.appUrl = appUrl;
  }
  if (serverConfig.BB_DEV_APP_PORT !== undefined) {
    runtimeConfig.devAppPort = serverConfig.BB_DEV_APP_PORT;
  }
  const bbAppManagedConfig = await createBbAppManagedConfigReloader({
    config: runtimeConfig,
    hub,
    logger,
  });

  // Telemetry only operates in production runs (the bb-app launcher and the
  // desktop app both set NODE_ENV=production); dev/source runs never send.
  const telemetry = await createTelemetryService({
    apiKey: serverConfig.BB_POSTHOG_API_KEY,
    appVersion: serverConfig.BB_APP_VERSION,
    dataDir: serverConfig.BB_DATA_DIR,
    enabled: serverConfig.BB_TELEMETRY && isProduction,
    logger,
  });

  const machineAuth = await createMachineAuthService({
    dataDir: serverConfig.BB_DATA_DIR,
    db,
    logger,
  });
  await machineAuth.ensureReady();
  const pendingInteractions = new PendingInteractionLifecycle({
    config: runtimeConfig,
    db,
    hub,
    lifecycleDedupers,
    logger,
    machineAuth,
    telemetry,
    terminalSessions,
  });
  pendingInteractions.start();

  const appVersion = createAppVersionService({
    config: runtimeConfig,
    logger,
  });

  // "AirDrop for threads": opt-in LAN exposure via BB_LAN_SHARE. When enabled,
  // bind the HTTP server to all interfaces so peers can reach the offer
  // endpoint; otherwise keep the default (loopback) binding.
  const lanShareEnabled =
    process.env.BB_LAN_SHARE === "1" || process.env.BB_LAN_SHARE === "true";
  const peerShare = new PeerShareService({
    db,
    hub,
    logger,
    dataDir: serverConfig.BB_DATA_DIR,
    apiPort: serverConfig.BB_SERVER_PORT,
    lanReachable: lanShareEnabled,
  });

  const { app, closeWebSockets, injectWebSocket } = createApp(
    {
      appVersion,
      bbAppManagedConfig,
      config: runtimeConfig,
      db,
      hub,
      lifecycleDedupers,
      logger,
      machineAuth,
      peerShare,
      pendingInteractions,
      telemetry,
      terminalSessions,
      watchInterests,
    },
    { staticDir },
  );
  const eventLoopStallMonitor = startEventLoopStallMonitor({ logger });

  const sweepDeps = {
    config: runtimeConfig,
    db,
    hub,
    lifecycleDedupers,
    logger,
    machineAuth,
    pendingInteractions,
    telemetry,
    terminalSessions,
  };
  await runStartupRecoverySweep(sweepDeps).catch((error) => {
    logger.error({ err: error }, "Startup recovery sweep failed");
  });

  const server = serve({
    port: serverConfig.BB_SERVER_PORT,
    ...(lanShareEnabled ? { hostname: "0.0.0.0" } : {}),
    fetch: app.fetch,
  });
  injectWebSocket(server);
  peerShare.start();

  logger.info(
    {
      port: serverConfig.BB_SERVER_PORT,
      dataDir: serverConfig.BB_DATA_DIR,
    },
    "Server listening",
  );
  telemetry.capture({ name: "app_started" });

  const sweepInterval = setInterval(() => {
    void runPeriodicSweeps(sweepDeps);
  }, 10_000);
  sweepInterval.unref();

  let shutdownPromise: Promise<void> | null = null;
  const runShutdown = (): Promise<void> => {
    if (shutdownPromise) {
      return shutdownPromise;
    }
    shutdownPromise = (async () => {
      eventLoopStallMonitor.stop();
      peerShare.stop();
      clearInterval(sweepInterval);
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
      await closeServer;
    })();
    return shutdownPromise;
  };

  process.once("SIGINT", () => {
    void runShutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void runShutdown().finally(() => process.exit(0));
  });
}
