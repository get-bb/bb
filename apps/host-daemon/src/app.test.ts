import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentRuntime, AgentRuntimeOptions } from "@bb/agent-runtime";
import type { PendingInteractionCreate, ToolCallRequest } from "@bb/domain";
import {
  hostDaemonInteractiveInterruptRequestSchema,
  type HostDaemonInteractiveRequestResponse,
} from "@bb/host-daemon-contract";
import type { HostWatcher } from "@bb/host-watcher";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCommandFetchLoop,
  createHostDaemonApp,
  type HostDaemonApp,
} from "./app.js";
import type { HostDaemonLogger } from "./logger.js";
import type { CreateReconnectingWebSocket } from "./server-connection.js";
import type { ReconnectingWebSocketLike } from "./server-connection-support.js";

interface Deferred<TValue> {
  promise: Promise<TValue>;
  resolve: (value: TValue | PromiseLike<TValue>) => void;
  reject: (reason?: Error) => void;
}

interface TestCommand {
  id: string;
}

interface RecordedFetchRequest {
  body: string | null;
  method: string;
  pathname: string;
}

interface FetchRecorder {
  fetchFn: typeof fetch;
  requests: RecordedFetchRequest[];
}

interface CreateFetchRecorderArgs {
  interactiveRequestError?: Error;
  interactiveRequestResponse?: HostDaemonInteractiveRequestResponse;
  retiredEnvironmentIds?: string[];
}

interface RuntimeOptionsRef {
  current: AgentRuntimeOptions | null;
}

interface HostDaemonAppFixture {
  app: HostDaemonApp;
  fetchRecorder: FetchRecorder;
  logger: ReturnType<typeof createLogger>;
  runtimeOptions: RuntimeOptionsRef;
}

type HandleCommands = (commands: TestCommand[]) => Promise<void>;

const tempDirs: string[] = [];

function createDeferred<TValue>(): Deferred<TValue> {
  let resolve!: Deferred<TValue>["resolve"];
  let reject!: Deferred<TValue>["reject"];
  const promise = new Promise<TValue>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, reject, resolve };
}

function createLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } satisfies HostDaemonLogger;
}

function handledCommandIds(
  handleCommands: ReturnType<typeof vi.fn<HandleCommands>>,
): string[] {
  return handleCommands.mock.calls.flatMap(([commands]) =>
    commands.map((command) => command.id),
  );
}

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function readFetchUrl(input: RequestInfo | URL): URL {
  if (typeof input === "string") {
    return new URL(input);
  }
  if (input instanceof URL) {
    return input;
  }
  return new URL(input.url);
}

function readFetchBody(init: RequestInit | undefined): string | null {
  const body = init?.body;
  if (body === undefined || body === null) {
    return null;
  }
  if (typeof body === "string") {
    return body;
  }
  throw new Error("Expected string request body");
}

function createFetchRecorder(
  args: CreateFetchRecorderArgs = {},
): FetchRecorder {
  const requests: RecordedFetchRequest[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = readFetchUrl(input);
    const request = {
      body: readFetchBody(init),
      method: init?.method ?? "GET",
      pathname: url.pathname,
    };
    requests.push(request);

    if (url.pathname === "/internal/session/open") {
      return Response.json(
        {
          sessionId: "session-app-test",
          heartbeatIntervalMs: 30000,
          leaseTimeoutMs: 90000,
          trackedThreadTargets: [],
          trackedApplicationDataTargets: [],
          retiredEnvironmentIds: args.retiredEnvironmentIds ?? [],
        },
        { status: 201 },
      );
    }
    if (url.pathname === "/internal/session/commands") {
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/internal/session/events") {
      return Response.json({
        acceptedEvents: [],
        rejectedEvents: [],
      });
    }
    if (url.pathname === "/internal/session/interactive-request") {
      if (args.interactiveRequestError) {
        throw args.interactiveRequestError;
      }
      const response: HostDaemonInteractiveRequestResponse =
        args.interactiveRequestResponse ?? {
          outcome: "created",
          interactionId: "pint_app_test",
          status: "pending",
        };
      return Response.json(response);
    }
    if (url.pathname === "/internal/session/interactive-request/interrupt") {
      return Response.json({
        ok: true,
        interactionIds: ["pint_app_test"],
      });
    }

    return new Response(`Unhandled test request: ${url.pathname}`, {
      status: 500,
    });
  };

  return {
    fetchFn,
    requests,
  };
}

function createOpeningWebSocket(): CreateReconnectingWebSocket {
  return (urlProvider) => {
    let readyState = 0;
    const socket: ReconnectingWebSocketLike = {
      get readyState() {
        return readyState;
      },
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send: vi.fn(),
      close: vi.fn(() => {
        readyState = 3;
      }),
      reconnect: vi.fn(),
    };
    void urlProvider().then(() => {
      queueMicrotask(() => {
        readyState = 1;
        socket.onopen?.({ type: "open" });
      });
    });
    return socket;
  };
}

function createFakeRuntime(): AgentRuntime {
  return {
    async ensureProvider() {},
    async startThread() {
      return { providerThreadId: "provider-thread-app-test" };
    },
    async resumeThread() {
      return { providerThreadId: "provider-thread-app-test" };
    },
    async runTurn() {},
    async steerTurn() {
      return { status: "steered" };
    },
    async stopThread() {},
    async renameThread() {},
    async archiveThread() {},
    async unarchiveThread() {},
    async listModels() {
      return {
        models: [],
        selectedOnlyModels: [],
      };
    },
    listRunningProviders() {
      return [];
    },
    async shutdown() {},
  };
}

function createCommandApprovalRequest(): PendingInteractionCreate {
  return {
    threadId: "thr_app_interactive",
    turnId: "turn_app_interactive",
    providerId: "codex",
    providerThreadId: "provider-thread-app-interactive",
    providerRequestId: "provider-request-app-interactive",
    payload: {
      kind: "approval",
      subject: {
        kind: "command",
        itemId: "item-app-interactive",
        command: "git status",
        cwd: "/tmp/project",
        actions: [],
        sessionGrant: null,
      },
      reason: "Needs approval",
      availableDecisions: ["allow_once", "deny"],
    },
  };
}

function createToolCallRequest(): ToolCallRequest {
  return {
    requestId: "provider-tool-request-app-test",
    threadId: "thr_app_tool",
    providerThreadId: "provider-thread-app-tool",
    turnId: "turn_app_tool",
    callId: "call-app-tool",
    tool: "message_user",
    arguments: {
      text: "hello",
    },
  };
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

async function createAppFixture(
  args: CreateFetchRecorderArgs = {},
): Promise<HostDaemonAppFixture> {
  const dataDir = await makeTempDir("bb-host-daemon-app-test-");
  const fetchRecorder = createFetchRecorder(args);
  const logger = createLogger();
  const runtimeOptions: RuntimeOptionsRef = { current: null };
  const app = await createHostDaemonApp({
    dataDir,
    serverUrl: "http://127.0.0.1:3334",
    hostKey: "host-key-app-test",
    hostType: "persistent",
    hostId: "host-app-test",
    hostName: "App Test Host",
    instanceId: "instance-app-test",
    logger,
    releaseLock: async () => undefined,
    localApiConfig: null,
    createRuntime: (options) => {
      runtimeOptions.current = options;
      return createFakeRuntime();
    },
    fetchFn: fetchRecorder.fetchFn,
    createWebSocket: createOpeningWebSocket(),
  });

  return {
    app,
    fetchRecorder,
    logger,
    runtimeOptions,
  };
}

describe("createCommandFetchLoop", () => {
  it("retries fetching commands with exponential backoff after transient failures", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const logger = createLogger();
    const fetchCommands = vi
      .fn<() => Promise<TestCommand[]>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new Error("still down"))
      .mockResolvedValueOnce([]);
    const handleCommands = vi.fn(async () => undefined);
    const loop = createCommandFetchLoop({
      logger,
      fetchCommands,
      handleCommands,
    });

    await loop.request();

    expect(fetchCommands).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      "Failed to fetch host-daemon commands",
    );

    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchCommands).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchCommands).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(3_999);
    expect(fetchCommands).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchCommands).toHaveBeenCalledTimes(3);
    expect(handleCommands).not.toHaveBeenCalled();
  });

  it("jitters command fetch retry timing", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const logger = createLogger();
    const fetchCommands = vi
      .fn<() => Promise<TestCommand[]>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce([]);
    const handleCommands = vi.fn(async () => undefined);
    const loop = createCommandFetchLoop({
      logger,
      fetchCommands,
      handleCommands,
    });

    await loop.request();

    await vi.advanceTimersByTimeAsync(1_499);
    expect(fetchCommands).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchCommands).toHaveBeenCalledTimes(2);
  });

  it("fetches newly requested commands while a previous batch is still running", async () => {
    const firstBatchDone = createDeferred<void>();
    const logger = createLogger();
    const firstBatch = [{ id: "slow-command" }];
    const secondBatch = [{ id: "later-thread" }];
    let nextBatch: TestCommand[] = firstBatch;
    let firstHandlerCompleted = false;
    const fetchCommands = vi.fn(async () => {
      const batch = nextBatch;
      nextBatch = [];
      return batch;
    });
    const handleCommands = vi.fn(async (commands: TestCommand[]) => {
      if (commands[0] === firstBatch[0]) {
        await firstBatchDone.promise;
        firstHandlerCompleted = true;
      }
    });
    const loop = createCommandFetchLoop({
      logger,
      fetchCommands,
      handleCommands,
    });

    const firstRequest = loop.request();
    await vi.waitFor(() => {
      expect(handleCommands).toHaveBeenCalledWith(firstBatch);
    });

    nextBatch = secondBatch;
    const secondRequest = loop.request();
    await vi.waitFor(() => {
      expect(handleCommands).toHaveBeenCalledWith(secondBatch);
    });
    expect(firstHandlerCompleted).toBe(false);

    firstBatchDone.resolve();
    await Promise.all([firstRequest, secondRequest]);

    expect(handleCommands).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid in-flight command limits", () => {
    const logger = createLogger();
    const fetchCommands = vi.fn(async () => []);
    const handleCommands = vi.fn(async () => undefined);

    expect(() =>
      createCommandFetchLoop({
        logger,
        fetchCommands,
        handleCommands,
        maxInFlightCommands: 0,
      }),
    ).toThrow("maxInFlightCommands must be a finite number >= 1");
  });

  it("limits concurrently handled commands", async () => {
    const firstCommandDone = createDeferred<void>();
    const secondCommandDone = createDeferred<void>();
    const logger = createLogger();
    const commands = [{ id: "one" }, { id: "two" }, { id: "three" }];
    const fetchCommands = vi
      .fn<() => Promise<TestCommand[]>>()
      .mockResolvedValueOnce(commands)
      .mockResolvedValue([]);
    const handleCommands = vi.fn(async (batch: TestCommand[]) => {
      const command = batch[0];
      if (command?.id === "one") {
        await firstCommandDone.promise;
      }
      if (command?.id === "two") {
        await secondCommandDone.promise;
      }
    });
    const loop = createCommandFetchLoop({
      logger,
      fetchCommands,
      handleCommands,
      maxInFlightCommands: 2,
    });

    await loop.request();
    await vi.waitFor(() => {
      expect(handledCommandIds(handleCommands)).toEqual(["one", "two"]);
    });

    firstCommandDone.resolve();
    await vi.waitFor(() => {
      expect(handledCommandIds(handleCommands)).toEqual([
        "one",
        "two",
        "three",
      ]);
    });
    secondCommandDone.resolve();
    await loop.stopAndDrain();
  });

  it("retries fetching commands after handler failures", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const logger = createLogger();
    const fetchCommands = vi
      .fn<() => Promise<TestCommand[]>>()
      .mockResolvedValueOnce([{ id: "bad-command" }])
      .mockResolvedValueOnce([]);
    const handleCommands = vi.fn(async () => {
      throw new Error("handler boom");
    });
    const loop = createCommandFetchLoop({
      logger,
      fetchCommands,
      handleCommands,
      maxInFlightCommands: 1,
      retryDelayMs: 2_000,
    });

    await loop.request();
    await Promise.resolve();
    expect(logger.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      "Failed to handle host-daemon commands",
    );
    expect(fetchCommands).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchCommands).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => {
      expect(fetchCommands).toHaveBeenCalledTimes(2);
    });
  });

  it("waits for active and queued handlers before shutdown drain completes", async () => {
    const firstCommandDone = createDeferred<void>();
    const logger = createLogger();
    const commands = [{ id: "one" }, { id: "two" }];
    const fetchCommands = vi
      .fn<() => Promise<TestCommand[]>>()
      .mockResolvedValueOnce(commands)
      .mockResolvedValue([]);
    const handleCommands = vi.fn(async (batch: TestCommand[]) => {
      if (batch[0]?.id === "one") {
        await firstCommandDone.promise;
      }
    });
    const loop = createCommandFetchLoop({
      logger,
      fetchCommands,
      handleCommands,
      maxInFlightCommands: 1,
    });

    await loop.request();
    await vi.waitFor(() => {
      expect(handledCommandIds(handleCommands)).toEqual(["one"]);
    });

    let drainCompleted = false;
    const drainPromise = loop.stopAndDrain().then(() => {
      drainCompleted = true;
    });
    await Promise.resolve();
    expect(drainCompleted).toBe(false);

    firstCommandDone.resolve();
    await drainPromise;
    expect(handledCommandIds(handleCommands)).toEqual(["one", "two"]);
  });
});

describe("createHostDaemonApp", () => {
  it("starts without waiting for the initial command fetch to finish", async () => {
    const dataDir = await makeTempDir("bb-host-daemon-app-startup-");
    const logger = createLogger();
    const commandFetchResponse = createDeferred<Response>();
    const requests: RecordedFetchRequest[] = [];
    const fetchFn: typeof fetch = async (input, init) => {
      const url = readFetchUrl(input);
      requests.push({
        body: readFetchBody(init),
        method: init?.method ?? "GET",
        pathname: url.pathname,
      });

      if (url.pathname === "/internal/session/open") {
        return Response.json(
          {
            sessionId: "session-startup-command-fetch",
            heartbeatIntervalMs: 30000,
            leaseTimeoutMs: 90000,
            trackedThreadTargets: [],
            trackedApplicationDataTargets: [],
            retiredEnvironmentIds: [],
          },
          { status: 201 },
        );
      }
      if (url.pathname === "/internal/session/commands") {
        return commandFetchResponse.promise;
      }
      if (url.pathname === "/internal/session/events") {
        return Response.json({
          acceptedEvents: [],
          rejectedEvents: [],
        });
      }

      return new Response(`Unhandled test request: ${url.pathname}`, {
        status: 500,
      });
    };
    const app = await createHostDaemonApp({
      dataDir,
      serverUrl: "http://127.0.0.1:3334",
      hostKey: "host-key-startup-command-fetch",
      hostType: "persistent",
      hostId: "host-startup-command-fetch",
      hostName: "Startup Command Fetch Host",
      instanceId: "instance-startup-command-fetch",
      logger,
      releaseLock: async () => undefined,
      localApiConfig: null,
      createRuntime: () => createFakeRuntime(),
      fetchFn,
      createWebSocket: createOpeningWebSocket(),
    });

    try {
      const startPromise = app.daemon.start();
      const startupOutcome: Promise<"started"> = startPromise.then(
        () => "started",
      );
      const timeoutOutcome = new Promise<"timeout">((resolve) => {
        setTimeout(() => resolve("timeout"), 50);
      });

      await vi.waitFor(() => {
        expect(
          requests.some(
            (request) => request.pathname === "/internal/session/commands",
          ),
        ).toBe(true);
      });
      await expect(
        Promise.race([startupOutcome, timeoutOutcome]),
      ).resolves.toBe("started");

      commandFetchResponse.resolve(new Response(null, { status: 204 }));
      await startPromise;
    } finally {
      commandFetchResponse.resolve(new Response(null, { status: 204 }));
      await app.daemon.shutdown("test");
    }
  });

  it("forgets server-retired loaded environments when opening a session", async () => {
    const dataDir = await makeTempDir("bb-host-daemon-app-retired-");
    const workspacePath = await makeTempDir(
      "bb-host-daemon-retired-workspace-",
    );
    const logger = createLogger();
    const fetchRecorder = createFetchRecorder({
      retiredEnvironmentIds: ["env-app-retired"],
    });
    const stopWatchingStatus = vi.fn(async () => undefined);
    const runtime = {
      ...createFakeRuntime(),
      shutdown: vi.fn(async () => undefined),
    } satisfies AgentRuntime;
    const hostWatcher = {
      watchApplicationStorageRoot: vi.fn(() => () => undefined),
      watchWorkspace: vi.fn(() => stopWatchingStatus),
      watchThreadStorageRoot: vi.fn(() => () => undefined),
    } satisfies HostWatcher;
    const app = await createHostDaemonApp({
      dataDir,
      serverUrl: "http://127.0.0.1:3334",
      hostKey: "host-key-retired-env",
      hostType: "persistent",
      hostId: "host-retired-env",
      hostName: "Retired Environment Host",
      instanceId: "instance-retired-env",
      logger,
      releaseLock: async () => undefined,
      localApiConfig: null,
      createRuntime: () => runtime,
      fetchFn: fetchRecorder.fetchFn,
      hostWatcher,
      createWebSocket: createOpeningWebSocket(),
    });

    try {
      await app.runtimeManager.ensureEnvironment({
        environmentId: "env-app-retired",
        workspacePath,
      });
      expect(app.runtimeManager.get("env-app-retired")).toBeDefined();

      await app.connection.start();

      expect(app.runtimeManager.get("env-app-retired")).toBeUndefined();
      expect(stopWatchingStatus).toHaveBeenCalledTimes(1);
      expect(runtime.shutdown).toHaveBeenCalledTimes(1);
      const openSessionBody = fetchRecorder.requests
        .filter((request) => request.pathname === "/internal/session/open")
        .map((request) => JSON.parse(request.body ?? "{}"));
      expect(openSessionBody[0]).toMatchObject({
        loadedEnvironments: [{ environmentId: "env-app-retired" }],
      });
    } finally {
      await app.daemon.shutdown("test");
    }
  });

  it("logs raw stderr for unexpected provider process exits", async () => {
    const { app, logger, runtimeOptions } = await createAppFixture();
    try {
      const workspacePath = await makeTempDir(
        "bb-host-daemon-app-log-workspace-",
      );
      await app.runtimeManager.ensureEnvironment({
        environmentId: "env-app-provider-exit-log",
        workspacePath,
      });
      const options = runtimeOptions.current;
      if (!options?.onProcessExit) {
        throw new Error("Expected process exit callback to be captured");
      }

      options.onProcessExit({
        providerId: "codex",
        threadIds: ["thr_provider_exit_log"],
        code: 1,
        expected: false,
        signal: null,
        stderr: "OPENAI_API_KEY=sk-test-secret\nUsage limit reached.",
      });

      expect(logger.warn).toHaveBeenCalledWith(
        {
          providerId: "codex",
          threadIds: ["thr_provider_exit_log"],
          code: 1,
          signal: null,
          stderr: "OPENAI_API_KEY=sk-test-secret\nUsage limit reached.",
        },
        "Unexpected provider process exited with stderr",
      );
    } finally {
      await app.daemon.shutdown("test");
    }
  });

  it("interrupts pending interactive requests when an expected provider exit affects their threads", async () => {
    const { app, fetchRecorder, runtimeOptions } = await createAppFixture();
    try {
      const workspacePath = await makeTempDir("bb-host-daemon-app-workspace-");
      await app.connection.start();
      await app.runtimeManager.ensureEnvironment({
        environmentId: "env-app-interactive",
        workspacePath,
      });
      const options = runtimeOptions.current;
      if (!options?.onInteractiveRequest || !options.onProcessExit) {
        throw new Error("Expected runtime callbacks to be captured");
      }

      const request = createCommandApprovalRequest();
      const pending = options.onInteractiveRequest(request);
      await vi.waitFor(() => {
        expect(
          fetchRecorder.requests.filter(
            (record) =>
              record.pathname === "/internal/session/interactive-request",
          ),
        ).toHaveLength(1);
      });

      const pendingRejection = expect(pending).rejects.toThrow(
        'Provider "codex" exited while awaiting user interaction',
      );
      options.onProcessExit({
        providerId: "codex",
        threadIds: [request.threadId],
        code: null,
        expected: true,
        signal: "SIGTERM",
        stderr: null,
      });

      await pendingRejection;
      await vi.waitFor(() => {
        expect(
          fetchRecorder.requests.filter(
            (record) =>
              record.pathname ===
              "/internal/session/interactive-request/interrupt",
          ),
        ).toHaveLength(1);
      });
      const interruptRequest = fetchRecorder.requests.find(
        (record) =>
          record.pathname === "/internal/session/interactive-request/interrupt",
      );
      if (!interruptRequest?.body) {
        throw new Error("Expected interactive interrupt request body");
      }
      const payload = hostDaemonInteractiveInterruptRequestSchema.parse(
        JSON.parse(interruptRequest.body),
      );
      expect(payload).toEqual({
        sessionId: "session-app-test",
        providerId: "codex",
        threadIds: [request.threadId],
        reason: 'Provider "codex" exited while awaiting user interaction',
      });
    } finally {
      await app.daemon.shutdown("test");
    }
  });

  it("logs stack-bearing fields for dynamic tool forwarding failures", async () => {
    const { app, logger, runtimeOptions } = await createAppFixture();
    try {
      const workspacePath = await makeTempDir("bb-host-daemon-app-tool-");
      await app.runtimeManager.ensureEnvironment({
        environmentId: "env-app-tool",
        workspacePath,
      });
      await app.connection.start();
      const options = runtimeOptions.current;
      if (!options?.onToolCall) {
        throw new Error("Expected tool call callback to be captured");
      }

      const request = createToolCallRequest();
      await expect(options.onToolCall(request)).rejects.toThrow(
        "Failed to call tool",
      );

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          callId: request.callId,
          err: expect.any(Error),
          providerThreadId: request.providerThreadId,
          threadId: request.threadId,
          tool: request.tool,
          turnId: request.turnId,
        }),
        "Failed to forward dynamic tool call to server",
      );
    } finally {
      await app.daemon.shutdown("test");
    }
  });

  it("logs stack-bearing fields for unexpected interactive forwarding failures", async () => {
    const registrationError = new Error("registration transport failed");
    const { app, logger, runtimeOptions } = await createAppFixture({
      interactiveRequestError: registrationError,
    });
    try {
      const workspacePath = await makeTempDir(
        "bb-host-daemon-app-interactive-error-",
      );
      await app.runtimeManager.ensureEnvironment({
        environmentId: "env-app-interactive-error",
        workspacePath,
      });
      await app.connection.start();
      const options = runtimeOptions.current;
      if (!options?.onInteractiveRequest) {
        throw new Error("Expected interactive request callback to be captured");
      }

      const request = createCommandApprovalRequest();
      await expect(options.onInteractiveRequest(request)).rejects.toThrow(
        "registration transport failed",
      );

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          err: registrationError,
          kind: request.payload.kind,
          providerRequestId: request.providerRequestId,
          providerThreadId: request.providerThreadId,
          threadId: request.threadId,
          turnId: request.turnId,
        }),
        "Failed to forward interactive provider request to server",
      );
    } finally {
      await app.daemon.shutdown("test");
    }
  });

  it("logs rejected interactive request registrations with a structured code", async () => {
    const { app, logger, runtimeOptions } = await createAppFixture({
      interactiveRequestResponse: {
        outcome: "rejected",
        reason: "Ask User Question feature is disabled",
      },
    });
    try {
      const workspacePath = await makeTempDir(
        "bb-host-daemon-app-rejected-interactive-",
      );
      await app.runtimeManager.ensureEnvironment({
        environmentId: "env-app-rejected-interactive",
        workspacePath,
      });
      await app.connection.start();
      const options = runtimeOptions.current;
      if (!options?.onInteractiveRequest) {
        throw new Error("Expected interactive request callback to be captured");
      }

      const request = createCommandApprovalRequest();
      await expect(options.onInteractiveRequest(request)).rejects.toThrow(
        "Ask User Question feature is disabled",
      );

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: "Ask User Question feature is disabled",
          errorName: "InteractiveRequestRegistryError",
          interactiveRequestErrorCode: "interactive_request_rejected",
          kind: request.payload.kind,
          providerRequestId: request.providerRequestId,
          providerThreadId: request.providerThreadId,
          threadId: request.threadId,
          turnId: request.turnId,
        }),
        "Interactive provider request rejected by server",
      );
      expect(logger.error).not.toHaveBeenCalledWith(
        expect.anything(),
        "Failed to forward interactive provider request to server",
      );
    } finally {
      await app.daemon.shutdown("test");
    }
  });
});
