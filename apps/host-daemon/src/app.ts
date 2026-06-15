import { CommandRouter } from "./command-router.js";
import { createDaemon, type HostDaemon } from "./daemon.js";
import {
  createEventSink,
  EventSinkDisposedError,
  type EventSink,
} from "./event-sink.js";
import {
  InteractiveRequestRegistry,
  InteractiveRequestRegistryError,
} from "./interactive-request-registry.js";
import { startEventLoopStallMonitor } from "./event-loop-stall-monitor.js";
import {
  defaultListModels,
  shutdownDefaultListModelsRuntimes,
} from "./command-dispatch-support.js";
import { startLocalApiServer, type LocalApiServer } from "./local-api.js";
import type { HostDaemonLocalApiConfig } from "./local-api-config.js";
import type { HostDaemonLogger } from "./logger.js";
import type { HostDaemonDaemonWsMessage } from "@bb/host-daemon-contract";
import {
  RuntimeManager,
  type RuntimeManagerOptions,
} from "./runtime-manager.js";
import { WatchManager } from "./watch-manager.js";
import {
  TerminalManager,
  type TerminalManagerOptions,
} from "./terminals/terminal-manager.js";
import { createServerClient } from "./server-client.js";
import {
  cleanupInjectedSkillStagingDirs,
  ensureDataDirSkillsRootPath,
} from "./injected-skills.js";
import {
  ServerConnection,
  type CreateReconnectingWebSocket,
} from "./server-connection.js";
import { runtimeErrorLogFields, summarizeError } from "./error-utils.js";
import { ensureThreadStorageRoot } from "./thread-storage-root.js";
import type { AgentRuntimeOptions } from "@bb/agent-runtime";
import {
  type HostType,
  type ToolCallRequest,
  type ToolCallResponse,
} from "@bb/domain";
import type { HostWatcher } from "@bb/host-watcher";

interface SessionState {
  value: string | null;
}

const INTERACTIVE_INTERRUPT_RETRY_DELAY_MS = 1_000;

export interface CreateHostDaemonAppOptions {
  dataDir: string;
  serverUrl: string;
  hostKey: string;
  bridgeBundleDir?: string;
  hostType: HostType;
  hostId: string;
  hostName: string;
  instanceId: string;
  appUrl?: string;
  devAppPort?: number;
  logger: HostDaemonLogger;
  releaseLock: () => Promise<void>;
  localApiConfig: HostDaemonLocalApiConfig | null;
  createRuntime?: RuntimeManagerOptions["createRuntime"];
  runtimeShellEnv?: AgentRuntimeOptions["shellEnv"];
  threadStorageRootPath?: string;
  hostWatcher?: HostWatcher;
  onToolCall?: (request: ToolCallRequest) => Promise<ToolCallResponse>;
  pickFolder?: () => Promise<string | null>;
  fetchFn?: typeof fetch;
  createWebSocket?: CreateReconnectingWebSocket;
}

export interface HostDaemonApp {
  daemon: HostDaemon;
  eventSink: EventSink;
  localApi: LocalApiServer | null;
  runtimeManager: RuntimeManager;
  watchManager: WatchManager;
  terminalManager: TerminalManager;
  router: CommandRouter;
  connection: ServerConnection;
}

interface PendingInteractiveInterruptRequest {
  providerId: string;
  reason: string;
  threadIds: readonly string[];
}

export async function createHostDaemonApp(
  options: CreateHostDaemonAppOptions,
): Promise<HostDaemonApp> {
  const threadStorageRootPath = await ensureThreadStorageRoot(
    options.dataDir,
    options.threadStorageRootPath
      ? { env: { BB_THREAD_STORAGE: options.threadStorageRootPath } }
      : {},
  );
  const dataDirSkillsRootPath = await ensureDataDirSkillsRootPath(
    options.dataDir,
  );
  await cleanupInjectedSkillStagingDirs({
    dataDir: options.dataDir,
    keepCatalogHashes: [],
    logger: options.logger,
  });
  const sessionState: SessionState = {
    value: null,
  };
  const pendingInteractiveInterrupts = new Map<
    string,
    PendingInteractiveInterruptRequest
  >();
  let runtimeManager: RuntimeManager;
  let watchManager: WatchManager;
  let flushPendingInteractiveInterruptsPromise: Promise<void> | null = null;
  let interactiveInterruptRetryTimeout: ReturnType<typeof setTimeout> | null =
    null;
  let eventSink: EventSink;

  async function flushThreadEventsBeforeInteractiveRegistration(): Promise<void> {
    // Interactive registration creates server-owned turn-scoped timeline state,
    // so the server must first observe the provider turn/started for that turn.
    await eventSink.flushRequired();
  }

  async function flushThreadEventsBeforeToolCall(): Promise<void> {
    // Dynamic tool calls can append server-owned turn-scoped events, so the
    // server must first observe any provider turn/started already emitted.
    await eventSink.flushRequired();
  }

  const serverClient = createServerClient({
    serverUrl: options.serverUrl,
    hostKey: options.hostKey,
    logger: options.logger,
    getSessionId: () => {
      if (!sessionState.value) {
        throw new Error("Server session is not open");
      }
      return sessionState.value;
    },
    beforeInteractiveRequestRegistrationAttempt:
      flushThreadEventsBeforeInteractiveRegistration,
    fetchFn: options.fetchFn,
  });

  function buildInteractiveInterruptKey(
    request: PendingInteractiveInterruptRequest,
  ): string {
    return [
      request.providerId,
      request.reason,
      [...request.threadIds].sort().join(","),
    ].join("|");
  }

  function clearInteractiveInterruptRetry(): void {
    if (interactiveInterruptRetryTimeout !== null) {
      clearTimeout(interactiveInterruptRetryTimeout);
      interactiveInterruptRetryTimeout = null;
    }
  }

  function scheduleInteractiveInterruptRetry(): void {
    if (
      interactiveInterruptRetryTimeout !== null ||
      sessionState.value === null ||
      pendingInteractiveInterrupts.size === 0
    ) {
      return;
    }

    interactiveInterruptRetryTimeout = setTimeout(() => {
      interactiveInterruptRetryTimeout = null;
      void flushPendingInteractiveInterrupts();
    }, INTERACTIVE_INTERRUPT_RETRY_DELAY_MS);
  }

  async function flushPendingInteractiveInterrupts(): Promise<void> {
    if (flushPendingInteractiveInterruptsPromise) {
      await flushPendingInteractiveInterruptsPromise;
      return;
    }

    clearInteractiveInterruptRetry();

    flushPendingInteractiveInterruptsPromise = (async () => {
      while (sessionState.value !== null) {
        const nextEntry = pendingInteractiveInterrupts.entries().next().value;
        if (!nextEntry) {
          return;
        }

        const [key, request] = nextEntry;
        try {
          await serverClient.interruptInteractiveRequests(request);
          pendingInteractiveInterrupts.delete(key);
        } catch (error) {
          options.logger.warn(
            {
              providerId: request.providerId,
              threadIds: request.threadIds,
              ...runtimeErrorLogFields(error),
            },
            "Failed to flush pending interactive interrupt request",
          );
          scheduleInteractiveInterruptRetry();
          return;
        }
      }
    })();

    try {
      await flushPendingInteractiveInterruptsPromise;
    } finally {
      flushPendingInteractiveInterruptsPromise = null;
    }
  }

  function enqueueInteractiveInterrupt(
    request: PendingInteractiveInterruptRequest,
  ): void {
    pendingInteractiveInterrupts.set(
      buildInteractiveInterruptKey(request),
      request,
    );
    void flushPendingInteractiveInterrupts();
  }

  eventSink = createEventSink({
    isSessionOpen: () => sessionState.value !== null,
    logger: options.logger,
    postEvents: (events) => serverClient.postEvents(events),
  });

  const interactiveRequestRegistry = new InteractiveRequestRegistry({
    registerRequest: (request) =>
      serverClient.registerInteractiveRequest(request),
    onRegistrationFailure: ({ error, request }) => {
      enqueueInteractiveInterrupt({
        providerId: request.providerId,
        reason: `Failed to register interactive request while provider was waiting: ${error.message}`,
        threadIds: [request.threadId],
      });
    },
  });

  let sendServerMessage = (_message: HostDaemonDaemonWsMessage) => false;
  watchManager = new WatchManager({
    dataDir: options.dataDir,
    hostWatcher: options.hostWatcher,
    threadStorageRootPath,
    onThreadStorageChanged: ({ environmentId }) => {
      sendServerMessage({
        type: "environment-change",
        environmentId,
        change: "thread-storage-changed",
      });
    },
    onThreadStorageWatchError: ({ error }) => {
      options.logger.warn(
        {
          rootPath: error.rootPath,
          watchError: error.message,
        },
        "Thread storage watch unavailable; retrying in background",
      );
    },
    onWorkspaceStatusChanged: ({ environmentId, changeKinds }) => {
      for (const change of changeKinds) {
        sendServerMessage({
          type: "environment-change",
          environmentId,
          change,
        });
      }
    },
    onWorkspaceStatusWatchError: ({ error }) => {
      options.logger.warn(
        {
          environmentId: error.environmentId,
          rootPath: error.rootPath,
          watchError: error.message,
        },
        "Workspace status watch unavailable; retrying in background",
      );
    },
  });
  runtimeManager = new RuntimeManager({
    bridgeBundleDir: options.bridgeBundleDir,
    createRuntime: options.createRuntime,
    dataDir: options.dataDir,
    dataDirSkillsRootPath,
    hostWatcher: options.hostWatcher,
    logger: options.logger,
    shellEnv: options.runtimeShellEnv,
    onEvent: ({ environmentId, event }) => {
      try {
        eventSink.emit({
          threadId: event.threadId,
          event,
        });
      } catch (error) {
        if (error instanceof EventSinkDisposedError) {
          options.logger.warn(
            {
              environmentId,
              eventType: event.type,
              threadId: event.threadId,
            },
            "Ignoring runtime event received after event sink disposal",
          );
          return;
        }
        throw error;
      }
    },
    onInjectedSkillsChanged: (change) => {
      options.logger.debug(
        {
          changedPaths: change.changedPaths,
          sourceType: change.sourceType,
        },
        "Injected skills changed; future runtime launches will rescan",
      );
    },
    onDataDirSkillsWatchError: ({ error }) => {
      options.logger.warn(
        {
          rootPath: error.rootPath,
          watchError: error.message,
        },
        "Data-dir skills watch unavailable",
      );
    },
    onWorkspaceStatusChanged: ({ environmentId, changeKinds }) => {
      for (const change of changeKinds) {
        sendServerMessage({
          type: "environment-change",
          environmentId,
          change,
        });
      }
    },
    onToolCall:
      options.onToolCall ??
      (async (request) => {
        try {
          await flushThreadEventsBeforeToolCall();
          return await serverClient.callTool(request);
        } catch (error) {
          options.logger.error(
            {
              tool: request.tool,
              threadId: request.threadId,
              providerThreadId: request.providerThreadId,
              turnId: request.turnId,
              callId: request.callId,
              err: error,
            },
            "Failed to forward dynamic tool call to server",
          );
          throw error;
        }
      }),
    onInteractiveRequest: async (request) => {
      try {
        return await interactiveRequestRegistry.registerAndWait(request);
      } catch (error) {
        if (
          error instanceof InteractiveRequestRegistryError &&
          error.code === "interactive_request_rejected"
        ) {
          options.logger.warn(
            {
              interactiveRequestErrorCode: error.code,
              ...summarizeError(error),
              threadId: request.threadId,
              providerThreadId: request.providerThreadId,
              turnId: request.turnId,
              providerRequestId: request.providerRequestId,
              kind: request.payload.kind,
            },
            "Interactive provider request rejected by server",
          );
          throw error;
        }
        options.logger.error(
          {
            threadId: request.threadId,
            providerThreadId: request.providerThreadId,
            turnId: request.turnId,
            providerRequestId: request.providerRequestId,
            kind: request.payload.kind,
            err: error,
          },
          "Failed to forward interactive provider request to server",
        );
        throw error;
      }
    },
    onStderr: (line) => {
      if (line.includes('"component":"claude-code-mock-cli-traffic-proxy"')) {
        options.logger.info(
          { providerStderr: line },
          "Claude Code mock CLI traffic proxy request",
        );
      }
    },
    onProcessExit: (info) => {
      const threadIds = info.threads.map((thread) => thread.threadId);
      if (!info.expected && info.stderr) {
        options.logger.warn(
          {
            providerId: info.providerId,
            threadIds,
            code: info.code,
            signal: info.signal,
            stderr: info.stderr,
          },
          "Unexpected provider process exited with stderr",
        );
      }
      if (threadIds.length === 0) {
        return;
      }
      const reason = `Provider "${info.providerId}" exited while awaiting user interaction`;
      interactiveRequestRegistry.interruptThreads({
        providerId: info.providerId,
        threadIds,
        reason,
      });

      enqueueInteractiveInterrupt({
        providerId: info.providerId,
        threadIds,
        reason,
      });
    },
    threadStorageRootPath,
  });
  let sendTerminalMessage: TerminalManagerOptions["sendMessage"] = (message) =>
    sendServerMessage(message);
  const terminalManager = new TerminalManager({
    dataDir: options.dataDir,
    logger: options.logger,
    runtimeManager,
    sendMessage: (message) => sendTerminalMessage(message),
  });

  const router = new CommandRouter({
    dataDir: options.dataDir,
    fetchProjectAttachment: (args) => serverClient.fetchProjectAttachment(args),
    runtimeManager,
    terminalManager,
    listModels: (args) =>
      defaultListModels(args, {
        bridgeBundleDir: options.bridgeBundleDir,
      }),
    resolveInteractiveRequest: async (request) => {
      interactiveRequestRegistry.resolve(request);
    },
    threadStorageRootPath,
    logger: options.logger,
    eventSink: {
      emit: (event) => eventSink.emit(event),
      flush: () => eventSink.flush(),
    },
  });

  const connection = new ServerConnection({
    serverUrl: options.serverUrl,
    hostKey: options.hostKey,
    hostId: options.hostId,
    hostName: options.hostName,
    hostType: options.hostType,
    dataDir: options.dataDir,
    instanceId: options.instanceId,
    logger: options.logger,
    serverClient,
    createWebSocket: options.createWebSocket,
    getActiveThreads: () => runtimeManager.listActiveThreads(),
    getLoadedEnvironments: () => runtimeManager.listLoadedEnvironments(),
    onHostRpcRequest: async (message) => {
      if (message.command.type === "environment.destroy") {
        await watchManager.removeEnvironmentWorkspaceWatch(
          message.command.environmentId,
        );
      }
      const response = await router.handleOnlineRpcRequest(message);
      sendServerMessage(response);
    },
    onWatchSetReplace: async (message) => {
      await watchManager.replaceWatchSet({
        generation: message.generation,
        workspaceTargets: message.workspaceTargets,
        threadStorageTargets: message.threadStorageTargets,
      });
    },
    onTerminalMessage: (message) => terminalManager.handleMessage(message),
    onSessionOpened: async (session) => {
      sessionState.value = session.sessionId;
      if (session.retiredEnvironmentIds.length > 0) {
        await Promise.all(
          session.retiredEnvironmentIds.map((environmentId) =>
            runtimeManager.forgetEnvironment(environmentId),
          ),
        );
        options.logger.info(
          {
            environmentIds: session.retiredEnvironmentIds,
            sessionId: session.sessionId,
          },
          "Retired locally loaded environments after session reconciliation",
        );
      }
      await watchManager.replaceAuthoritativeWatchSet(session.watchSet);
      void eventSink.flush().catch((error) => {
        options.logger.warn(
          {
            sessionId: session.sessionId,
            ...runtimeErrorLogFields(error),
          },
          "Failed to flush pending daemon events after session opened",
        );
      });
      void flushPendingInteractiveInterrupts();
    },
    setSession: (session) => {
      sessionState.value = session?.sessionId ?? null;
      if (session === null) {
        clearInteractiveInterruptRetry();
      }
    },
  });
  sendServerMessage = (message) => connection.sendMessage(message);

  const localApi = options.localApiConfig
    ? await startLocalApiServer({
        hostId: options.hostId,
        localApiConfig: options.localApiConfig,
        serverUrl: options.serverUrl,
        serverPort: Number(new URL(options.serverUrl).port) || 0,
        devAppPort: options.devAppPort,
        appUrl: options.appUrl,
        getConnected: () => connection.sessionId != null,
        pickFolder: options.pickFolder,
      })
    : null;
  const eventLoopStallMonitor = startEventLoopStallMonitor({
    logger: options.logger,
  });

  const daemon = createDaemon({
    identity: {
      hostId: options.hostId,
      hostName: options.hostName,
      instanceId: options.instanceId,
    },
    logger: options.logger,
    releaseLock: options.releaseLock,
    flushEvents: async () => {
      await eventSink.flush();
    },
    shutdownRuntimes: async () => {
      eventLoopStallMonitor.stop();
      await localApi?.close();
      await watchManager.shutdown();
      await terminalManager.shutdownAll();
      await runtimeManager.shutdownAll();
      await eventSink.flush();
      await eventSink.dispose();
      await shutdownDefaultListModelsRuntimes();
      await connection.shutdown();
    },
    onStart: async () => {
      options.logger.info(
        { dataDir: options.dataDir, serverUrl: options.serverUrl },
        "Host daemon connecting",
      );
      await connection.start();
    },
  });
  connection.setSessionCloseHandler((reason) =>
    daemon.shutdown(`session-close:${reason}`),
  );

  return {
    daemon,
    eventSink,
    localApi,
    runtimeManager,
    watchManager,
    terminalManager,
    router,
    connection,
  };
}
