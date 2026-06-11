import { join } from "node:path";
import { CommandRouter } from "./command-router.js";
import { createDaemon, type HostDaemon } from "./daemon.js";
import {
  createEventSink,
  EventSinkDisposedError,
  type EventSink,
} from "./event-sink.js";
import {
  createWorkflowEventBuffer,
  WorkflowEventBufferDisposedError,
  type WorkflowEventBuffer,
} from "./workflow-event-buffer.js";
import {
  InteractiveRequestRegistry,
  InteractiveRequestRegistryError,
} from "./interactive-request-registry.js";
import { startEventLoopStallMonitor } from "./event-loop-stall-monitor.js";
import {
  defaultListModels,
  type ReplayTaskRegistry,
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
import {
  TerminalManager,
  type TerminalManagerOptions,
} from "./terminals/terminal-manager.js";
import { createReplayCaptureService } from "@bb/replay-capture/writer";
import { createServerClient } from "./server-client.js";
import { AppDataChangeReporter } from "./app-data-change-reporter.js";
import {
  ensureAppDataRootPath,
  ensureAppsRootPath,
  listApplicationDataTargetsFromRoot,
} from "./app-data-files.js";
import {
  cleanupInjectedSkillStagingDirs,
  ensureDataDirSkillsRootPath,
} from "./injected-skills.js";
import {
  ServerConnection,
  type CreateReconnectingWebSocket,
} from "./server-connection.js";
import { runtimeErrorLogFields, summarizeError } from "./error-utils.js";
import { prepareWorkflowAgentShellEnv } from "./runtime-shell-env.js";
import { ensureThreadStorageRoot } from "./thread-storage-root.js";
import { DEFAULT_WORKFLOW_TURN_STALL_TIMEOUT_MS } from "./workflow-agent-executor.js";
import {
  DEFAULT_WORKFLOW_CANCEL_ESCALATION_GRACE_MS,
  DEFAULT_WORKFLOW_WORKTREE_SETUP_TIMEOUT_MS,
  WORKFLOW_STALE_RUNNER_SWEEP_INTERVAL_MS,
  WorkflowRunManager,
} from "./workflow-run-manager.js";
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
  /** Cap on live workflow provider processes (the worktree-runtime token
   *  gate). The entrypoint fills it from
   *  BB_WORKFLOW_MAX_LIVE_PROVIDER_PROCESSES (default 8). */
  maxLiveWorkflowProviderProcesses: number;
  appUrl?: string;
  devAppPort?: number;
  devReplayCapture?: boolean;
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
  workflowEventBuffer: WorkflowEventBuffer;
  localApi: LocalApiServer | null;
  runtimeManager: RuntimeManager;
  terminalManager: TerminalManager;
  workflowRunManager: WorkflowRunManager;
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
  const appsRootPath = await ensureAppsRootPath(options.dataDir);
  const appDataRootPath = await ensureAppDataRootPath(options.dataDir);
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

  const appDataChangeReporter = new AppDataChangeReporter({
    logger: options.logger,
    postAppDataChange: (payload) => serverClient.postAppDataChange(payload),
    postAppDataResync: (payload) => serverClient.postAppDataResync(payload),
  });

  async function refreshTrackedApplicationDataTargets(): Promise<void> {
    const targets = await listApplicationDataTargetsFromRoot({ appsRootPath });
    runtimeManager.replaceTrackedApplicationDataTargets(targets);
    await appDataChangeReporter.replaceTrackedApplications({ targets });
  }

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
  const workflowEventBuffer = createWorkflowEventBuffer({
    dataDir: options.dataDir,
    logger: options.logger,
    postEvents: (events) => serverClient.postWorkflowRunEvents(events),
  });
  const replayTasks: ReplayTaskRegistry = new Map();
  async function abortReplayTasks(): Promise<void> {
    const tasks = [...replayTasks.values()];
    for (const task of tasks) {
      task.abort.abort();
    }
    await Promise.allSettled(tasks.map((task) => task.done));
  }
  const replayCapture = createReplayCaptureService({
    dataDir: options.dataDir,
    enabled: options.devReplayCapture ?? false,
    logger: options.logger,
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
  runtimeManager = new RuntimeManager({
    bridgeBundleDir: options.bridgeBundleDir,
    createRuntime: options.createRuntime,
    dataDir: options.dataDir,
    dataDirSkillsRootPath,
    hostWatcher: options.hostWatcher,
    logger: options.logger,
    shellEnv: options.runtimeShellEnv,
    appsRootPath,
    appDataRootPath,
    onCapture: (entry) => {
      replayCapture?.recordRuntimeCaptureEntry(entry);
    },
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
      replayCapture?.recordThreadEvent({
        environmentId,
        threadId: event.threadId,
        event,
      });
    },
    onThreadStorageChanged: ({ environmentId }) => {
      sendServerMessage({
        type: "environment-change",
        environmentId,
        change: "thread-storage-changed",
      });
    },
    onApplicationStorageTargetsChanged: () => {
      void refreshTrackedApplicationDataTargets()
        .then(() => {
          sendServerMessage({
            type: "application-storage-changed",
          });
        })
        .catch((error) => {
          options.logger.warn(
            {
              appsRootPath,
              ...runtimeErrorLogFields(error),
            },
            "Failed to refresh tracked app data targets",
          );
        });
    },
    onApplicationDataChanged: (change) => {
      void appDataChangeReporter.observe(change);
    },
    onApplicationDataResync: (change) => {
      void appDataChangeReporter.requestResync(change);
    },
    onApplicationContentChanged: ({ applicationId }) => {
      sendServerMessage({
        type: "application-content-changed",
        applicationId,
      });
    },
    onInjectedSkillsChanged: (change) => {
      options.logger.debug(
        {
          applicationId: change.applicationId,
          changedPaths: change.changedPaths,
          sourceType: change.sourceType,
        },
        "Injected skills changed; future runtime launches will rescan",
      );
    },
    onApplicationStorageWatchError: ({ error }) => {
      options.logger.warn(
        {
          rootPath: error.rootPath,
          watchError: error.message,
        },
        "Application storage watch unavailable; retrying in background",
      );
    },
    onDataDirSkillsWatchError: ({ error }) => {
      options.logger.warn(
        {
          rootPath: error.rootPath,
          watchError: error.message,
        },
        "Data-dir skills watch unavailable; retrying in background",
      );
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
      if (!info.expected && info.stderr) {
        options.logger.warn(
          {
            providerId: info.providerId,
            threadIds: info.threadIds,
            code: info.code,
            signal: info.signal,
            stderr: info.stderr,
          },
          "Unexpected provider process exited with stderr",
        );
      }
      if (info.threadIds.length === 0) {
        return;
      }
      const reason = `Provider "${info.providerId}" exited while awaiting user interaction`;
      interactiveRequestRegistry.interruptThreads({
        providerId: info.providerId,
        threadIds: info.threadIds,
        reason,
      });

      enqueueInteractiveInterrupt({
        providerId: info.providerId,
        threadIds: info.threadIds,
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

  const workflowRunManager = new WorkflowRunManager({
    dataDir: options.dataDir,
    logger: options.logger,
    workflowAgentShellEnv: await prepareWorkflowAgentShellEnv({
      appsRootPath,
      shimDirectoryPath: join(options.dataDir, "workflow-agent-shim"),
    }),
    bridgeBundleDir: options.bridgeBundleDir,
    createRuntime: options.createRuntime,
    onRunEvent: ({ runId, event }) => {
      try {
        workflowEventBuffer.push({ runId, event });
      } catch (error) {
        if (error instanceof WorkflowEventBufferDisposedError) {
          options.logger.warn(
            { runId, eventType: event.type },
            "Ignoring workflow run event received after spool disposal",
          );
          return;
        }
        throw error;
      }
    },
    maxLiveProviderProcesses: options.maxLiveWorkflowProviderProcesses,
    worktreeSetupTimeoutMs: DEFAULT_WORKFLOW_WORKTREE_SETUP_TIMEOUT_MS,
    turnStallTimeoutMs: DEFAULT_WORKFLOW_TURN_STALL_TIMEOUT_MS,
    cancelEscalationGraceMs: DEFAULT_WORKFLOW_CANCEL_ESCALATION_GRACE_MS,
  });
  // Boot reap is silent: the server's session-open reconciliation interrupts
  // (and keeps resumable) every unreported run from a previous instance.
  await workflowRunManager.reapStaleRunners({
    spoolSyntheticTerminalEvents: false,
  });
  // The in-life sweep DOES spool synthetic run/failed settles: a runner that
  // outlived its daemon, got reported via its fresh heartbeat, and died later
  // has no handle, so nothing else ever observes its exit while the session
  // stays healthy — the run would dangle `running` until the next restart.
  const staleRunnerSweep = setInterval(() => {
    workflowRunManager
      .reapStaleRunners({ spoolSyntheticTerminalEvents: true })
      .catch((error) => {
        options.logger.warn(
          { err: error },
          "Workflow stale-runner sweep failed",
        );
      });
  }, WORKFLOW_STALE_RUNNER_SWEEP_INTERVAL_MS);
  staleRunnerSweep.unref();

  const router = new CommandRouter({
    dataDir: options.dataDir,
    fetchProjectAttachment: (args) => serverClient.fetchProjectAttachment(args),
    runtimeManager,
    terminalManager,
    workflowRunManager,
    fetchWorkflowRunJournal: (args) =>
      serverClient.fetchWorkflowRunJournal(args),
    listModels: (args) =>
      defaultListModels(args, {
        bridgeBundleDir: options.bridgeBundleDir,
      }),
    resolveInteractiveRequest: async (request) => {
      interactiveRequestRegistry.resolve(request);
    },
    replayTasks,
    threadStorageRootPath,
    logger: options.logger,
    recordReplayCaptureThreadMetadata: (metadata) =>
      replayCapture?.recordThreadMetadata(metadata),
    recordReplayCaptureTurnRequest: (input) =>
      replayCapture?.recordTurnRequest(input),
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
    getActiveWorkflowRunIds: async () => {
      try {
        return await workflowRunManager.listActiveWorkflowRunIds();
      } catch (error) {
        // Reporting [] interrupts the host's running runs server-side, but
        // they revive on the next successful report (bucket (c)); failing the
        // session open would block reconnection entirely.
        options.logger.error(
          { err: error },
          "Failed to list active workflow runs for session open; reporting none",
        );
        return [];
      }
    },
    getLoadedEnvironments: () => runtimeManager.listLoadedEnvironments(),
    onHostRpcRequest: async (message) => {
      const response = await router.handleOnlineRpcRequest(message);
      sendServerMessage(response);
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
      runtimeManager.replaceTrackedThreadStorageTargets(
        session.trackedThreadTargets,
      );
      runtimeManager.replaceTrackedApplicationDataTargets(
        session.trackedApplicationDataTargets,
      );
      void appDataChangeReporter.replaceTrackedApplications({
        targets: session.trackedApplicationDataTargets,
      });
      void eventSink.flush().catch((error) => {
        options.logger.warn(
          {
            sessionId: session.sessionId,
            ...runtimeErrorLogFields(error),
          },
          "Failed to flush pending daemon events after session opened",
        );
      });
      void workflowEventBuffer.flush().catch((error) => {
        options.logger.warn(
          {
            sessionId: session.sessionId,
            ...runtimeErrorLogFields(error),
          },
          "Failed to flush buffered workflow run events after session opened",
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
      await abortReplayTasks();
      await eventSink.flush();
      await workflowEventBuffer.flush();
    },
    shutdownRuntimes: async () => {
      eventLoopStallMonitor.stop();
      clearInterval(staleRunnerSweep);
      await localApi?.close();
      await terminalManager.shutdownAll();
      await workflowRunManager.shutdown();
      await runtimeManager.shutdownAll();
      await eventSink.flush();
      await eventSink.dispose();
      // After manager shutdown so the runners' synthetic terminal events are
      // spooled (and flushed when the server is reachable) before disposal.
      await workflowEventBuffer.flush();
      await workflowEventBuffer.dispose();
      await shutdownDefaultListModelsRuntimes();
      await replayCapture?.drain();
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
    workflowEventBuffer,
    localApi,
    runtimeManager,
    terminalManager,
    workflowRunManager,
    router,
    connection,
  };
}
