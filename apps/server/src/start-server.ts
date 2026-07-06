import { serve } from "@hono/node-server";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerConfig } from "@bb/config/server";
import { toOptionalString } from "@bb/config/strings";
import { createLogger } from "@bb/logger";
import { initDb } from "./db.js";
import { createApp } from "./server.js";
import { PendingInteractionLifecycle } from "./services/interactions/pending-interactions.js";
import { createMachineAuthService } from "./services/machine-auth.js";
import { ConnectTunnelService } from "./services/connect/tunnel-service.js";
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

/**
 * Walk up from the server bundle to find a source checkout — a directory with
 * apps/app/vite.ui.config.ts and packages/. Returns the UI-source seed (the app
 * source + the @bb/* packages) when running inside the repo, else undefined.
 */
function findRepoUiSource(
  startDir: string,
): { appDir: string; packagesSourceDir: string } | undefined {
  let dir = startDir;
  for (let depth = 0; depth < 10; depth += 1) {
    const candidateAppDir = join(dir, "apps", "app");
    if (
      existsSync(join(candidateAppDir, "vite.ui.config.ts")) &&
      existsSync(join(dir, "packages"))
    ) {
      return {
        appDir: candidateAppDir,
        packagesSourceDir: join(dir, "packages"),
      };
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return undefined;
}

const DEFAULT_UI_SOURCE_REPO_URL = "https://github.com/ymichael/bb";

function runProcess(
  command: string,
  args: string[],
): Promise<{ code: number; log: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { env: process.env });
    let log = "";
    const collect = (c: Buffer): void => {
      log += c.toString();
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (e) => resolvePromise({ code: 1, log: log + String(e) }));
    child.on("close", (code) => resolvePromise({ code: code ?? 1, log }));
  });
}

/**
 * Shallow-clone the repo at the release tag so a packaged install (no
 * surrounding repo) has source to seed the editable UI from. Cached by ref.
 */
async function ensureClonedUiSource(args: {
  repoUrl: string;
  ref: string;
  into: string;
}): Promise<{ ok: boolean; log: string }> {
  const markerPath = join(args.into, ".bb-cloned-ref");
  if (existsSync(join(args.into, "apps", "app", "vite.ui.config.ts"))) {
    try {
      if (readFileSync(markerPath, "utf8").trim() === args.ref) {
        return { ok: true, log: "" };
      }
    } catch {
      // Marker unreadable — re-clone.
    }
  }
  rmSync(args.into, { recursive: true, force: true });
  const result = await runProcess("git", [
    "clone",
    "--depth",
    "1",
    "--branch",
    args.ref,
    args.repoUrl,
    args.into,
  ]);
  if (result.code !== 0) {
    return {
      ok: false,
      log: `git clone ${args.repoUrl}@${args.ref} failed:\n${result.log.slice(-1000)}`,
    };
  }
  writeFileSync(markerPath, args.ref);
  return { ok: true, log: result.log };
}

export async function runServer(serverConfig: ServerConfig): Promise<void> {
  const logger = createLogger({
    component: "server",
    dataDir: serverConfig.BB_DATA_DIR,
  });
  const db = initDb(serverConfig.databasePath, { logger });
  const hub = new NotificationHub();
  const watchInterests = new WatchInterestCoordinator({ db, hub });
  const lifecycleDedupers = createLifecycleDedupers();
  const appUrl = toOptionalString(serverConfig.BB_APP_URL);
  const threadStorageRootPath = resolveThreadStorageRootPath({
    dataDir: serverConfig.BB_DATA_DIR,
  });

  const selfDir = dirname(fileURLToPath(import.meta.url));
  const appDir = resolve(selfDir, "../../app");
  const appDistDir = join(appDir, "dist");
  const isProduction = process.env.NODE_ENV === "production";
  const staticDir =
    isProduction && existsSync(appDistDir) ? appDistDir : undefined;
  // Resolve where the editable UI source is seeded from. A source checkout
  // (pnpm dev, or pnpm start from a worktree) uses the repo found by walking up
  // from the bundle. A packaged install (npx bb-app / desktop) clones the
  // matching release tag on first `bb ui apply`. BB_UI_SOURCE_REPO_URL /
  // BB_UI_SOURCE_REF override the repo + ref (and force the clone path).
  const forceRef = process.env.BB_UI_SOURCE_REF?.trim();
  const forceRepoUrl = process.env.BB_UI_SOURCE_REPO_URL?.trim();
  const uiRepoSource =
    forceRef || forceRepoUrl ? undefined : findRepoUiSource(selfDir);
  let uiAppDir: string | undefined;
  let uiPackagesSourceDir: string | undefined;
  let uiEnsureSource:
    | (() => Promise<{ ok: boolean; log: string }>)
    | undefined;
  if (uiRepoSource) {
    uiAppDir = uiRepoSource.appDir;
    uiPackagesSourceDir = uiRepoSource.packagesSourceDir;
  } else {
    const cloneDir = join(serverConfig.BB_DATA_DIR, "ui-source-repo");
    const repoUrl = forceRepoUrl || DEFAULT_UI_SOURCE_REPO_URL;
    const ref = forceRef || `desktop-v${serverConfig.BB_APP_VERSION}`;
    uiAppDir = join(cloneDir, "apps", "app");
    uiPackagesSourceDir = join(cloneDir, "packages");
    uiEnsureSource = () =>
      ensureClonedUiSource({ repoUrl, ref, into: cloneDir });
  }
  const runtimeConfig: ServerRuntimeConfig = {
    appSurface: serverConfig.BB_APP_SURFACE,
    appVersion: serverConfig.BB_APP_VERSION,
    automationsAllowScriptRuns: serverConfig.BB_AUTOMATIONS_ALLOW_SCRIPT_RUNS,
    builtinSkillsRootPath: resolveBuiltinSkillsRootPath(),
    customAcpAgents: [],
    customModels: [],
    dataDir: serverConfig.BB_DATA_DIR,
    featureFlags: serverConfig.featureFlags,
    hostDaemonPort: serverConfig.BB_HOST_DAEMON_PORT,
    inheritedSkillsRootPaths: serverConfig.BB_INHERITED_SKILLS_ROOTS,
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
  // Constructed after runtimeConfig: host_path terminals gate their target
  // host through the Multi-machine experiment, which needs config.dataDir to
  // resolve the primary host.
  const terminalSessions = new TerminalSessionLifecycle({
    config: runtimeConfig,
    db,
    hub,
    logger,
  });
  const bbAppManagedConfig = await createBbAppManagedConfigReloader({
    config: runtimeConfig,
    hub,
    logger,
  });

  // Telemetry only operates in production runs (the bb-app launcher and the
  // desktop app both set NODE_ENV=production); dev/source runs never send.
  const telemetry = await createTelemetryService({
    apiKey: serverConfig.BB_POSTHOG_API_KEY,
    appSurface: serverConfig.BB_APP_SURFACE,
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

  // Server-hosted connect tunnel: proxies relayed requests to this server's own
  // loopback (which serves the SPA + /api + /ws). Started after the socket is
  // listening; it reconnects from a stored credential if the server was paired.
  const connectTunnel = new ConnectTunnelService({
    dataDir: serverConfig.BB_DATA_DIR,
    loopbackBaseUrl: `http://127.0.0.1:${serverConfig.BB_SERVER_PORT}`,
    logger,
  });

  const appVersion = createAppVersionService({
    config: runtimeConfig,
    logger,
  });

  const { app, closeWebSockets, injectWebSocket, pluginService } = createApp(
    {
      appVersion,
      bbAppManagedConfig,
      config: runtimeConfig,
      connectTunnel,
      db,
      hub,
      lifecycleDedupers,
      logger,
      machineAuth,
      pendingInteractions,
      telemetry,
      terminalSessions,
      watchInterests,
    },
    {
      staticDir,
      appDir: uiAppDir,
      packagesSourceDir: uiPackagesSourceDir,
      ensureUiSource: uiEnsureSource,
    },
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
    pluginSchedules: pluginService,
    telemetry,
    terminalSessions,
  };
  await runStartupRecoverySweep(sweepDeps).catch((error) => {
    logger.error({ err: error }, "Startup recovery sweep failed");
  });

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
  telemetry.capture({ name: "app_started" });

  // Reconnect the connect tunnel now that the loopback origin is accepting
  // requests (no-op unless the server was previously paired).
  connectTunnel.start();

  // Plugins load after the listener is up: they are additive, and a slow
  // plugin must not delay serving. Bind the loopback SDK first so bb.sdk is
  // usable from the moment factories run.
  pluginService.bindSdk({
    baseUrl: `http://127.0.0.1:${serverConfig.BB_SERVER_PORT}`,
  });
  void pluginService.start().catch((error: unknown) => {
    logger.error({ err: error }, "Plugin startup failed");
  });

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
      clearInterval(sweepInterval);
      await pluginService.stop().catch((error: unknown) => {
        logger.warn({ err: error }, "Plugin shutdown failed");
      });
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
