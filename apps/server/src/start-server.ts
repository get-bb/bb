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
import { createAppVersionService } from "./services/system/app-version.js";
import { createBbAppManagedConfigReloader } from "./services/system/bb-app-managed-config.js";
import { startEventLoopStallMonitor } from "./services/system/event-loop-stall-monitor.js";
import { runPeriodicSweeps } from "./services/system/periodic-sweeps.js";
import { TerminalSessionLifecycle } from "./services/terminals/terminal-session-lifecycle.js";
import { resolveThreadStorageRootPath } from "./services/threads/thread-storage.js";
import { createLifecycleDedupers } from "./lifecycle-dedupers.js";
import type { ServerRuntimeConfig } from "./types.js";
import { NotificationHub } from "./ws/hub.js";

export async function runServer(serverConfig: ServerConfig): Promise<void> {
  const logger = createLogger({
    component: "server",
    dataDir: serverConfig.BB_DATA_DIR,
  });
  const db = initDb(serverConfig.databasePath, { logger });
  const hub = new NotificationHub();
  const pendingInteractions = new PendingInteractionLifecycle({
    db,
    hub,
    logger,
  });
  const terminalSessions = new TerminalSessionLifecycle({
    db,
    hub,
    logger,
  });
  pendingInteractions.start();
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

  const machineAuth = await createMachineAuthService({
    dataDir: serverConfig.BB_DATA_DIR,
    db,
    logger,
  });
  await machineAuth.ensureReady();

  const appVersion = createAppVersionService({
    config: runtimeConfig,
    logger,
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
      pendingInteractions,
      terminalSessions,
    },
    { staticDir },
  );
  const eventLoopStallMonitor = startEventLoopStallMonitor({ logger });

  const server = serve({
    port: serverConfig.BB_SERVER_PORT,
    fetch: app.fetch,
  });
  injectWebSocket(server);

  logger.info(
    {
      port: serverConfig.BB_SERVER_PORT,
      dataDir: serverConfig.BB_DATA_DIR,
    },
    "Server listening",
  );

  const sweepInterval = setInterval(() => {
    void runPeriodicSweeps({
      config: runtimeConfig,
      db,
      hub,
      lifecycleDedupers,
      logger,
      machineAuth,
      pendingInteractions,
      terminalSessions,
    });
  }, 10_000);
  sweepInterval.unref();

  let shutdownPromise: Promise<void> | null = null;
  const runShutdown = (): Promise<void> => {
    if (shutdownPromise) {
      return shutdownPromise;
    }
    shutdownPromise = (async () => {
      eventLoopStallMonitor.stop();
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
