import { sweepProviderLifecycles } from "../../../apps/server/src/services/environments/environment-engine.js";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import {
  ensurePersonalProject,
  getAppSettings,
  getAutoAppUpdate,
  getSkippedAppUpdate,
  setAutoAppUpdate,
  setExperiments,
  setSkippedAppUpdate,
  listRunningThreads,
  startWalCheckpointer,
  type DbConnection,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import { defaultFeatureFlags, type ExperimentUpdates } from "@bb/domain";
import {
  acquireDaemonLock,
  createHostDaemonApp,
  loadHostIdentity,
  persistHostId,
  persistServerRoutes,
  readPersistedServerRoutes,
  ServerRouteResolver,
  type HostDaemon,
  type HostDaemonApp,
} from "@bb/host-daemon/test";
import { createLifecycleDedupers } from "../../../apps/server/src/lifecycle-dedupers.js";
import { createApp } from "../../../apps/server/src/server.js";
import { createAiServiceRegistry } from "../../../apps/server/src/services/ai/ai-service-registry.js";
import { PendingInteractionLifecycle } from "../../../apps/server/src/services/interactions/pending-interactions.js";
import { createMachineAuthService } from "../../../apps/server/src/services/machine-auth.js";
import {
  createProviderRegistryService,
  type ProviderRegistryService,
} from "../../../apps/server/src/services/providers/provider-registry.js";
import {
  recordFirstPartyProviderBridgeArtifacts,
  registerFakeProviders,
  registerFirstPartyProviders,
} from "../../../apps/server/test/helpers/provider-registry.js";
import {
  copyBuiltinSkills,
  resolveBuiltinSkillsRootPath,
} from "../../../apps/server/src/services/skills/builtin-skills-copy.js";
import { SkillTreeRegistry } from "../../../apps/server/src/services/skills/injected-skills.js";
import { PluginHostArtifactRegistry } from "../../../apps/server/src/services/plugins/plugin-host-artifact-registry.js";
import { createAppUpdateService } from "../../../apps/server/src/services/system/app-update.js";
import { createScheduledAppUpdateService } from "../../../apps/server/src/services/system/app-update-schedule.js";
import { createAppUpdateSendHold } from "../../../apps/server/src/services/system/app-update-send-hold.js";
import { createCliCommandService } from "../../../apps/server/src/services/system/cli-command.js";
import { createAppVersionService } from "../../../apps/server/src/services/system/app-version.js";
import { createProviderNativeRootsCache } from "../../../apps/server/src/services/providers/native-roots.js";
import { createProviderLiveCommandsCache } from "../../../apps/server/src/services/providers/provider-live-commands.js";
import { createBbAppManagedConfigReloader } from "../../../apps/server/src/services/system/bb-app-managed-config.js";
import { createNoopTelemetryService } from "../../../apps/server/src/services/system/telemetry.js";
import { TerminalSessionLifecycle } from "../../../apps/server/src/services/terminals/terminal-session-lifecycle.js";
import type {
  ServerLogger,
  ServerRuntimeConfig,
} from "../../../apps/server/src/types.js";
import { HostSharedPortCoordinator } from "../../../apps/server/src/ws/host-shared-ports.js";
import { NotificationHub } from "../../../apps/server/src/ws/hub.js";
import { WatchInterestCoordinator } from "../../../apps/server/src/ws/watch-interests.js";
import { createPublicApiClient } from "@bb/server-contract";
import {
  killProcessesReferencingPath,
  resolveProjectEnvCandidates,
} from "@bb/test-helpers";
import { waitForHostConnected } from "./assertions.js";
import { createIntegrationFetch } from "./fetch.js";
import { isNodeError, removePathWithRetry } from "./remove-path.js";
import { createTestGitRepo } from "./seed.js";
import {
  copyBuiltinHostBuildRecords,
  INTEGRATION_APP_VERSION,
  INTEGRATION_BUILTIN_PLUGINS,
} from "./builtin-plugin-fixture.js";

export { PROJECT_CHECKOUT_BUILTIN_PLUGIN } from "./builtin-plugin-fixture.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const HARNESS_DAEMON_START_RETRY_DELAY_MS = 50;
const HARNESS_DAEMON_START_MAX_ATTEMPTS = 2;
const TEST_SERVER_HOST = "127.0.0.1";

let loadedProjectEnvPath: string | null | undefined;

type PublicApiClient = ReturnType<typeof createPublicApiClient>;

const testLogger: ServerLogger = {
  debug(): void {},
  error(): void {},
  info(): void {},
  warn(): void {},
};

export interface RunningTestServer {
  sweepEnvironments(): Promise<void>;
  baseUrl: string;
  close(): Promise<void>;
  config: ServerRuntimeConfig;
  db: DbConnection;
  hub: NotificationHub;
  machineAuth: Awaited<ReturnType<typeof createMachineAuthService>>;
  pendingInteractions: PendingInteractionLifecycle;
  providerRegistry: ProviderRegistryService;
}

export interface IntegrationHarness {
  api: PublicApiClient;
  cleanup(): Promise<void>;
  crashDaemon(): Promise<void>;
  daemonApp: HostDaemonApp;
  dropDaemonConnections(): number;
  db: DbConnection;
  hostId: string;
  hub: NotificationHub;
  repoDir: string;
  restartDaemon(reason?: string): Promise<void>;
  server: RunningTestServer;
  serverUrl: string;
  shutdownDaemon(reason?: string): Promise<void>;
  startDaemon(): Promise<void>;
}

interface CreateHarnessOptions {
  experiments?: ExperimentUpdates;
  proxyDaemonConnection?: boolean;
  serverPort?: number;
  bindHost?: "127.0.0.1" | "0.0.0.0";
  staticDir?: string;
  builtinPlugins?: readonly string[];
}

export type WithHarnessCallback<T> = (
  harness: IntegrationHarness,
) => Promise<T>;
type WithHarnessInvocation<T> = CreateHarnessOptions | WithHarnessCallback<T>;

interface HarnessDaemonResources {
  daemon: HostDaemon;
  daemonApp: HostDaemonApp;
  hostId: string;
  releaseLock: () => Promise<void>;
}

interface ListeningAddress {
  port: number;
}

function requireListeningAddress(
  address: ListeningAddress | null,
): ListeningAddress {
  if (!address) {
    throw new Error("Server address was not assigned");
  }
  return address;
}

function isRetryableSessionOpenFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.startsWith("Failed to open session: 401 Unauthorized")
  );
}

export async function loadProjectEnvFile(): Promise<string | null> {
  if (loadedProjectEnvPath !== undefined) {
    return loadedProjectEnvPath;
  }

  for (const candidate of await resolveProjectEnvCandidates(repoRoot)) {
    try {
      await fs.access(candidate);
      process.loadEnvFile(candidate);
      loadedProjectEnvPath = candidate;
      return candidate;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }

  loadedProjectEnvPath = null;
  return loadedProjectEnvPath;
}

async function startIntegrationServer(
  tmpRoot: string,
  options: CreateHarnessOptions,
): Promise<RunningTestServer> {
  const serverDataDir = path.join(tmpRoot, "server-data");
  await fs.mkdir(serverDataDir, { recursive: true });
  await copyBuiltinHostBuildRecords(serverDataDir);
  const builtinSkillsRootPath = path.join(serverDataDir, "builtin-skills");
  await copyBuiltinSkills({
    skillsRootPath: resolveBuiltinSkillsRootPath(),
    targetPath: builtinSkillsRootPath,
  });

  const db = createMigratedConnection();
  const walCheckpointer = startWalCheckpointer({ logger: testLogger });
  ensurePersonalProject(db);
  if (options.experiments !== undefined) {
    setExperiments(db, options.experiments);
  }
  const hub = new NotificationHub();
  const sharedPorts = new HostSharedPortCoordinator({ db, hub });
  const watchInterests = new WatchInterestCoordinator({ db, hub });
  const config: ServerRuntimeConfig = {
    appVersion: INTEGRATION_APP_VERSION,
    builtinSkillsRootPath,
    customModels: [],
    dataDir: serverDataDir,
    featureFlags: defaultFeatureFlags,
    hostDaemonPort: 3001,
    inheritedSkillsRootPaths: [],
    marketplaceUrl: "https://marketplace.invalid/marketplace.json",
    appUrl: "https://bb.example.test",
    serverPort: 0,
    sharedSkillRoots: { user: [], project: [] },
    isDevelopment: false,
    performanceDiagnosticsAvailable: false,
  };
  const terminalSessions = new TerminalSessionLifecycle({
    attachTimeoutMs: 50,
    config,
    db,
    hub,
    logger: testLogger,
    openTimeoutMs: 50,
  });
  const machineAuth = await createMachineAuthService({
    dataDir: serverDataDir,
    db,
    logger: testLogger,
  });
  await machineAuth.ensureReady();
  const lifecycleDedupers = createLifecycleDedupers();
  const bbAppManagedConfig = await createBbAppManagedConfigReloader({
    config,
    hub,
    logger: testLogger,
  });
  const telemetry = createNoopTelemetryService();
  const skillTreeRegistry = new SkillTreeRegistry();
  const providerRegistry = createProviderRegistryService({});
  await registerFirstPartyProviders(providerRegistry);
  const pluginHostArtifacts = new PluginHostArtifactRegistry();
  await registerFakeProviders(providerRegistry, pluginHostArtifacts);
  await recordFirstPartyProviderBridgeArtifacts(pluginHostArtifacts);
  const aiServices = createAiServiceRegistry();
  const pendingInteractions = new PendingInteractionLifecycle({
    config,
    db,
    hub,
    lifecycleDedupers,
    logger: testLogger,
    machineAuth,
    providerRegistry,
    pluginHostArtifacts,
    aiServices,
    skillTreeRegistry,
    telemetry,
    terminalSessions,
  });
  pendingInteractions.start();
  const appVersion = createAppVersionService({
    installKind: null,
    sourceCommit: null,
    config,
    logger: testLogger,
  });
  const countRunningThreads = (): number => listRunningThreads(db).length;
  const notifyAppUpdateChanged = (): void =>
    hub.notifySystem(["app-update-changed"]);
  const appUpdate = createScheduledAppUpdateService({
    autoCheckMs: null,
    countRunningThreads,
    inner: createAppUpdateService({
      currentCommit: null,
      appSurface: "web",
      appVersion,
      config,
      countRunningThreads,
      launcher: null,
      logger: testLogger,
      mode: null,
      notifyChanged: notifyAppUpdateChanged,
      threadsResumeAfterRestart: () =>
        getAppSettings(db).resumeThreadsAfterRestart,
      sendHold: createAppUpdateSendHold({
        aiServices,
        config,
        db,
        hub,
        lifecycleDedupers,
        logger: testLogger,
        machineAuth,
        pendingInteractions,
        pluginHostArtifacts,
        providerRegistry,
        skillTreeRegistry,
        telemetry,
        terminalSessions,
      }),
    }),
    logger: testLogger,
    notifyChanged: notifyAppUpdateChanged,
    onChangedMessage: (listener) => hub.onChangedMessage(listener),
    autoUpdate: {
      get: () => getAutoAppUpdate(db),
      set: (enabled) => setAutoAppUpdate(db, enabled),
    },
    skippedUpdate: {
      get: () => getSkippedAppUpdate(db),
      set: (key) => setSkippedAppUpdate(db, key),
    },
  });
  const serverDeps = {
    appUpdate,
    cliCommand: createCliCommandService({
      env: {},
      homeDir: serverDataDir,
      launcherPath: null,
      platform: process.platform,
      windowsUserPath: {
        read: () => Promise.reject(new Error("no Windows PATH in tests")),
        write: () => Promise.reject(new Error("no Windows PATH in tests")),
      },
    }),
    appVersion,
    bbAppManagedConfig,
    providerRegistry,
    providerNativeRoots: createProviderNativeRootsCache(),
    providerLiveCommands: createProviderLiveCommandsCache(),
    pluginHostArtifacts,
    aiServices,
    config,
    db,
    hub,
    lifecycleDedupers,
    logger: testLogger,
    machineAuth,
    pendingInteractions,
    sharedPorts,
    skillTreeRegistry,
    telemetry,
    terminalSessions,
    walCheckpointer,
    watchInterests,
  };
  const { app, closeWebSockets, injectWebSocket, pluginService } = createApp(
    serverDeps,
    options.staticDir === undefined
      ? undefined
      : { staticDir: options.staticDir },
  );

  let addressInfo: ListeningAddress | null = null;
  const server = serve(
    {
      hostname: options.bindHost ?? TEST_SERVER_HOST,
      port: options.serverPort ?? 0,
      fetch: app.fetch,
    },
    (info) => {
      addressInfo = { port: info.port };
    },
  );
  injectWebSocket(server);

  while (!addressInfo) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  const { port } = requireListeningAddress(addressInfo);
  config.serverPort = port;
  const baseUrl = `http://${TEST_SERVER_HOST}:${port}`;

  pluginService.bindSdk({ baseUrl });
  const builtinPlugins = new Set([
    ...INTEGRATION_BUILTIN_PLUGINS,
    ...(options.builtinPlugins ?? []),
  ]);
  for (const name of builtinPlugins) {
    const entry = await pluginService.install(`builtin:${name}`, {
      kind: "root",
    });
    if (entry.status !== "running") {
      throw new Error(
        `builtin plugin ${name} did not start: ${entry.statusDetail ?? entry.status}`,
      );
    }
  }

  return {
    sweepEnvironments: () => sweepProviderLifecycles(serverDeps),
    baseUrl,
    config,
    db,
    hub,
    machineAuth,
    pendingInteractions,
    providerRegistry,
    async close(): Promise<void> {
      await pluginService.stop();
      const closed = new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      await closeWebSockets();
      await closed;
      await walCheckpointer.stop();
    },
  };
}

interface DaemonConnectionProxy {
  close(): Promise<void>;
  dropConnections(): number;
  url: string;
}

async function startDaemonConnectionProxy(
  serverUrl: string,
): Promise<DaemonConnectionProxy> {
  const upstream = new URL(serverUrl);
  const sockets = new Set<net.Socket>();
  const track = (socket: net.Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  };
  const proxy = net.createServer((client) => {
    const target = net.connect(Number(upstream.port), upstream.hostname);
    track(client);
    track(target);
    client.on("error", () => target.destroy());
    target.on("error", () => client.destroy());
    client.pipe(target).pipe(client);
  });
  await new Promise<void>((resolve) =>
    proxy.listen(0, upstream.hostname, resolve),
  );
  const address = proxy.address();
  if (address === null || typeof address === "string") {
    throw new Error("Daemon connection proxy has no port");
  }
  return {
    url: `http://${upstream.hostname}:${address.port}`,
    dropConnections() {
      const dropped = sockets.size;
      for (const socket of sockets) socket.resetAndDestroy();
      return dropped;
    },
    close() {
      for (const socket of sockets) socket.destroy();
      return new Promise((resolve) => proxy.close(() => resolve()));
    },
  };
}

async function startHarnessDaemon(
  dataDir: string,
  server: RunningTestServer,
  serverUrl: string,
): Promise<HarnessDaemonResources> {
  const releaseLock = await acquireDaemonLock(dataDir);

  try {
    const identity = await loadHostIdentity({ dataDir });
    const hostKey = await server.machineAuth.issueDaemonHostKey({
      hostId: identity.hostId,
    });
    await persistHostId({ dataDir, hostId: identity.hostId });
    const daemonApp = await createHostDaemonApp({
      dataDir,
      hostKey,
      hostId: identity.hostId,
      hostName: identity.hostName,
      instanceId: randomUUID(),
      localApiConfig: null,
      logger: testLogger,
      releaseLock,
      routes: new ServerRouteResolver({
        anchorUrl: serverUrl,
        anchorHeaders: {},
        persisted: await readPersistedServerRoutes(dataDir, testLogger),
        persist: persistServerRoutes(dataDir),
        logger: testLogger,
      }),
    });
    for (
      let attempt = 1;
      attempt <= HARNESS_DAEMON_START_MAX_ATTEMPTS;
      attempt += 1
    ) {
      try {
        await daemonApp.daemon.start();
        break;
      } catch (error) {
        if (
          attempt === HARNESS_DAEMON_START_MAX_ATTEMPTS ||
          !isRetryableSessionOpenFailure(error)
        ) {
          throw error;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, HARNESS_DAEMON_START_RETRY_DELAY_MS),
        );
      }
    }
    return {
      daemon: daemonApp.daemon,
      daemonApp,
      hostId: identity.hostId,
      releaseLock,
    };
  } catch (error) {
    await releaseLock().catch(() => undefined);
    throw error;
  }
}

export async function createIntegrationHarness(
  options: CreateHarnessOptions = {},
): Promise<IntegrationHarness> {
  await loadProjectEnvFile();
  const tmpRoot = await fs.mkdtemp(path.join(tmpdir(), "bb-integration-"));
  await fs.writeFile(
    path.join(tmpRoot, "parent.pid"),
    `${process.pid}\n`,
    "utf8",
  );
  const reposRoot = path.join(tmpRoot, "repos");
  const daemonDataDir = path.join(tmpRoot, "daemon-data");
  const threadStorageRootPath = path.join(daemonDataDir, "thread-storage");
  await fs.mkdir(threadStorageRootPath, { recursive: true });
  const repoDir = await createTestGitRepo({
    repoDir: path.join(reposRoot, "test-project"),
  });

  let server: RunningTestServer | null = null;
  let daemonProxy: DaemonConnectionProxy | null = null;
  let daemonResources: HarnessDaemonResources | null = null;
  let cleanedUp = false;
  let harness: IntegrationHarness | null = null;

  async function startDaemon(): Promise<void> {
    if (!server) {
      throw new Error("Server has not been started");
    }
    if (!harness) {
      throw new Error("Harness has not been initialized");
    }
    if (daemonResources) {
      return;
    }

    daemonResources = await startHarnessDaemon(
      daemonDataDir,
      server,
      daemonProxy?.url ?? server.baseUrl,
    );
    if (daemonResources.hostId !== harness.hostId) {
      const mismatchedResources = daemonResources;
      daemonResources = null;
      await mismatchedResources.daemon
        .shutdown("integration-host-id-mismatch", 0)
        .catch(() => undefined);
      throw new Error(
        `Restarted daemon host ID ${mismatchedResources.hostId} did not match existing harness host ID ${harness.hostId}`,
      );
    }
    harness.daemonApp = daemonResources.daemonApp;
    harness.hostId = daemonResources.hostId;
    await waitForHostConnected(harness.api);
  }

  async function shutdownDaemon(
    reason = "integration-shutdown",
  ): Promise<void> {
    if (!daemonResources) {
      return;
    }
    const currentResources = daemonResources;
    daemonResources = null;
    await currentResources.daemon.shutdown(reason, 0);
  }

  async function restartDaemon(reason = "integration-restart"): Promise<void> {
    await shutdownDaemon(reason);
    await startDaemon();
  }

  async function crashDaemon(): Promise<void> {
    if (!daemonResources) {
      return;
    }
    const currentResources = daemonResources;
    daemonResources = null;
    await currentResources.daemonApp.connection
      .shutdown()
      .catch(() => undefined);
    await currentResources.daemon.shutdown("integration-crash", 0);
  }

  async function cleanup(): Promise<void> {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;

    await shutdownDaemon("integration-cleanup").catch(() => undefined);
    await daemonProxy?.close().catch(() => undefined);
    await server?.close().catch(() => undefined);
    await killProcessesReferencingPath(tmpRoot);
    await removePathWithRetry(tmpRoot);
  }

  try {
    server = await startIntegrationServer(tmpRoot, options);
    const api = createPublicApiClient(server.baseUrl, {
      fetch: createIntegrationFetch(),
    });
    if (options.proxyDaemonConnection === true) {
      daemonProxy = await startDaemonConnectionProxy(server.baseUrl);
    }
    daemonResources = await startHarnessDaemon(
      daemonDataDir,
      server,
      daemonProxy?.url ?? server.baseUrl,
    );
    await waitForHostConnected(api);
    await persistHostId({
      dataDir: server.config.dataDir,
      hostId: daemonResources.hostId,
    });

    harness = {
      api,
      cleanup,
      crashDaemon,
      daemonApp: daemonResources.daemonApp,
      db: server.db,
      dropDaemonConnections() {
        if (daemonProxy === null) {
          throw new Error("Pass proxyDaemonConnection to drop connections");
        }
        return daemonProxy.dropConnections();
      },
      hostId: daemonResources.hostId,
      hub: server.hub,
      repoDir,
      restartDaemon,
      server,
      serverUrl: server.baseUrl,
      shutdownDaemon,
      startDaemon,
    };

    return harness;
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function withHarness<T>(run: WithHarnessCallback<T>): Promise<T>;
export async function withHarness<T>(
  options: CreateHarnessOptions,
  run: WithHarnessCallback<T>,
): Promise<T>;
export async function withHarness<T>(
  arg1: WithHarnessInvocation<T>,
  arg2?: WithHarnessCallback<T>,
): Promise<T> {
  const options = typeof arg1 === "function" ? {} : arg1;
  const run = typeof arg1 === "function" ? arg1 : arg2;
  if (!run) {
    throw new Error("withHarness requires a callback");
  }

  const harness = await createIntegrationHarness(options);
  try {
    return await run(harness);
  } finally {
    await harness.cleanup();
  }
}
