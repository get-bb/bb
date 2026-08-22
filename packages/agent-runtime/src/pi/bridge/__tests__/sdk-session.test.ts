import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentSessionEvent,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";

type MockAgentSessionEventListener = (event: AgentSessionEvent) => void;

interface MockSubscribe {
  (listener: MockAgentSessionEventListener): () => void;
}

interface MockBashSpawnContext {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

interface MockBashSpawnHook {
  (context: MockBashSpawnContext): MockBashSpawnContext;
}

interface MockBashToolOptions {
  commandPrefix?: string;
  shellPath?: string;
  spawnHook?: MockBashSpawnHook;
}

interface MockCreateAgentSessionServicesOptions {
  agentDir?: string;
  cwd: string;
  modelRuntime?: object;
  resourceLoaderOptions: Record<string, unknown>;
}

interface MockBashToolTextContent {
  type: "text";
  text: string;
}

interface MockBashToolExecutionResult {
  content: MockBashToolTextContent[];
  details: Record<string, never>;
}

interface MockBashToolDefinition {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, never>;
  execute: () => Promise<MockBashToolExecutionResult>;
}

interface MockCreateBashToolDefinition {
  (cwd: string, options?: MockBashToolOptions): MockBashToolDefinition;
}

const {
  mockGetActiveToolNames,
  mockSetActiveToolsByName,
  mockCreateBashToolDefinition,
  mockDefineTool,
  mockOpen,
  mockInMemory,
  mockCreateAgentSessionServices,
  mockCreateAgentSession,
  mockBindExtensions,
  mockSessionState,
  mockSessionEventListeners,
  mockAbort,
  mockCompact,
  mockDispose,
  mockPrompt,
  mockGetModel,
  mockGetModels,
  mockHasConfiguredAuth,
  mockModelRuntime,
  mockGetShellCommandPrefix,
  mockGetShellPath,
} = vi.hoisted(() => {
  const mockSessionEventListeners: MockAgentSessionEventListener[] = [];
  const mockSubscribe = vi.fn<MockSubscribe>((listener) => {
    mockSessionEventListeners.push(listener);
    return () => {
      const index = mockSessionEventListeners.indexOf(listener);
      if (index !== -1) {
        mockSessionEventListeners.splice(index, 1);
      }
    };
  });
  const mockSessionState = { isStreaming: false };
  const mockPrompt = vi.fn();
  const mockAbort = vi.fn(async () => {});
  const mockCompact = vi.fn(async () => {});
  const mockBindExtensions = vi.fn(async () => {});
  const mockDispose = vi.fn();
  const mockGetLeafId = vi.fn(() => "pi-entry-checkpoint");
  const mockExtensionEmit = vi.fn(async () => {});
  const mockHasExtensionHandlers = vi.fn(() => false);
  const mockGetSessionStats = vi.fn();
  const mockGetContextUsage = vi.fn();
  const mockGetActiveToolNames = vi.fn<() => string[]>(() => []);
  const mockSetActiveToolsByName = vi.fn<(toolNames: string[]) => void>();
  const mockOpen = vi.fn((path: string) => ({ kind: "open", path }));
  const mockInMemory = vi.fn((cwd?: string) => ({ kind: "in-memory", cwd }));
  const mockGetShellCommandPrefix = vi.fn<() => string | undefined>(
    () => undefined,
  );
  const mockGetShellPath = vi.fn<() => string | undefined>(() => undefined);
  const mockSettingsManager = {
    getShellCommandPrefix: mockGetShellCommandPrefix,
    getShellPath: mockGetShellPath,
  };
  const mockCreateBashToolDefinition = vi.fn<MockCreateBashToolDefinition>(
    (_cwd, _options) => ({
      name: "bash",
      label: "bash",
      description: "Execute a bash command",
      parameters: {},
      execute: vi.fn(
        async (): Promise<MockBashToolExecutionResult> => ({
          content: [{ type: "text", text: "ok" }],
          details: {},
        }),
      ),
    }),
  );
  const mockDefineTool = vi.fn(<TTool>(tool: TTool): TTool => tool);
  const mockCreateAgentSession = vi.fn(async () => ({
    session: {
      abort: mockAbort,
      bindExtensions: mockBindExtensions,
      compact: mockCompact,
      subscribe: mockSubscribe,
      prompt: mockPrompt,
      dispose: mockDispose,
      extensionRunner: { emit: mockExtensionEmit },
      getSessionStats: mockGetSessionStats,
      getContextUsage: mockGetContextUsage,
      getActiveToolNames: mockGetActiveToolNames,
      hasExtensionHandlers: mockHasExtensionHandlers,
      setActiveToolsByName: mockSetActiveToolsByName,
      sessionManager: { getLeafId: mockGetLeafId },
      get isStreaming() {
        return mockSessionState.isStreaming;
      },
    },
  }));
  const mockGetModel = vi.fn<
    (
      provider: string,
      modelId: string,
    ) => { id: string; provider: string } | undefined
  >((provider, modelId) => ({
    id: modelId,
    provider,
  }));
  const mockGetModels = vi.fn<() => { id: string; provider: string }[]>(
    () => [],
  );
  const mockHasConfiguredAuth = vi.fn<(provider: string) => boolean>(
    () => true,
  );
  const mockModelRuntime = {
    getModel: mockGetModel,
    getModels: mockGetModels,
    hasConfiguredAuth: mockHasConfiguredAuth,
  };
  const mockCreateAgentSessionServices = vi.fn(
    async (options: MockCreateAgentSessionServicesOptions) => ({
      agentDir: options.agentDir ?? "/tmp/pi-agent",
      cwd: options.cwd,
      diagnostics: [],
      modelRuntime: options.modelRuntime ?? mockModelRuntime,
      resourceLoader: { options: options.resourceLoaderOptions },
      settingsManager: mockSettingsManager,
    }),
  );

  return {
    mockGetActiveToolNames,
    mockSetActiveToolsByName,
    mockCreateBashToolDefinition,
    mockDefineTool,
    mockOpen,
    mockInMemory,
    mockCreateAgentSessionServices,
    mockCreateAgentSession,
    mockBindExtensions,
    mockSessionState,
    mockSessionEventListeners,
    mockAbort,
    mockCompact,
    mockDispose,
    mockExtensionEmit,
    mockHasExtensionHandlers,
    mockPrompt,
    mockGetModel,
    mockGetModels,
    mockHasConfiguredAuth,
    mockModelRuntime,
    mockGetShellCommandPrefix,
    mockGetShellPath,
  };
});

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSessionFromServices: mockCreateAgentSession,
  createBashToolDefinition: mockCreateBashToolDefinition,
  defineTool: mockDefineTool,
  getAgentDir: vi.fn(() => "/tmp/pi-agent"),
  SessionManager: {
    open: mockOpen,
    inMemory: mockInMemory,
  },
}));

vi.mock("../configured-services.js", () => ({
  createConfiguredPiServices: mockCreateAgentSessionServices,
}));

import { PiSdkSession } from "../sdk-session.js";

function rejectPromptWithTransientAuthError(count: number, error: Error): void {
  for (let index = 0; index < count; index += 1) {
    mockPrompt.mockRejectedValueOnce(error);
  }
}

function emitSessionEvent(event: AgentSessionEvent): void {
  for (const listener of [...mockSessionEventListeners]) {
    listener(event);
  }
}

function createQueueUpdateEvent(
  steering: readonly string[],
  followUp: readonly string[] = [],
): AgentSessionEvent {
  return {
    type: "queue_update",
    steering,
    followUp,
  };
}

/**
 * Every dispatch installs pi's preflight hook: it is how the session learns
 * that pi took an input it did not queue.
 */
function withPreflight(
  options: Record<string, unknown> = {},
): Record<string, unknown> {
  return { ...options, preflightResult: expect.any(Function) };
}

/** Report pi's preflight acceptance for the most recent dispatch. */
function reportPreflightAccepted(accepted = true): void {
  const call = mockPrompt.mock.calls.at(-1);
  const options = call?.[1] as
    | { preflightResult?: (accepted: boolean) => void }
    | undefined;
  options?.preflightResult?.(accepted);
}

function createAgentEndEvent(willRetry = false): AgentSessionEvent {
  return {
    type: "agent_end",
    messages: [],
    willRetry,
  };
}

function createAutoRetryStartEvent(): AgentSessionEvent {
  return {
    type: "auto_retry_start",
    attempt: 1,
    maxAttempts: 2,
    delayMs: 1,
    errorMessage: "retryable failure",
  };
}

function createAutoRetryEndEvent(success: boolean): AgentSessionEvent {
  return {
    type: "auto_retry_end",
    success,
    attempt: 1,
    ...(success ? {} : { finalError: "Retry cancelled" }),
  };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function flushDeferredSteerSettlement(): Promise<void> {
  await flushAsyncWork();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await flushAsyncWork();
}

describe("PiSdkSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrompt.mockReset();
    mockSessionState.isStreaming = false;
    mockSessionEventListeners.length = 0;
    mockGetActiveToolNames.mockReturnValue([]);
    mockAbort.mockResolvedValue(undefined);
    mockCompact.mockResolvedValue(undefined);
    mockGetModel.mockImplementation((provider: string, modelId: string) => ({
      id: modelId,
      provider,
    }));
    mockGetModels.mockReturnValue([]);
    mockHasConfiguredAuth.mockReturnValue(true);
    mockGetShellCommandPrefix.mockReturnValue(undefined);
    mockGetShellPath.mockReturnValue(undefined);
  });

  it("creates Pi services from the user and project files", async () => {
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), vi.fn());

    await session.start();

    expect(mockCreateAgentSessionServices).toHaveBeenCalledWith({
      cwd: "/tmp/project",
      resourceLoaderOptions: {},
    });
  });

  it("binds lifecycle handlers for extensions", async () => {
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), vi.fn());

    await session.start();

    expect(mockBindExtensions).toHaveBeenCalledWith({
      mode: "rpc",
      abortHandler: expect.any(Function),
      shutdownHandler: expect.any(Function),
      onError: expect.any(Function),
    });
  });

  it("reports a broken configured extension before the thread starts", async () => {
    mockCreateAgentSessionServices.mockRejectedValueOnce(
      new Error("Failed to load Pi extension broken.ts: syntax error"),
    );
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), vi.fn());

    await expect(session.start()).rejects.toThrow(
      "Failed to load Pi extension broken.ts",
    );
    expect(mockCreateAgentSession).not.toHaveBeenCalled();
  });

  it("opens a persistent session file when provided", async () => {
    const session = new PiSdkSession(
      {
        cwd: "/tmp/project",
        sessionFilePath: "/tmp/pi-sessions/thread-1.jsonl",
      },
      vi.fn(),
      vi.fn(),
    );

    await session.start();

    expect(mockOpen).toHaveBeenCalledWith(
      "/tmp/pi-sessions/thread-1.jsonl",
      "/tmp/pi-sessions",
    );
    expect(mockInMemory).not.toHaveBeenCalled();
  });

  it("falls back to an in-memory session when no file path is provided", async () => {
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), vi.fn());

    await session.start();

    expect(mockInMemory).toHaveBeenCalledWith("/tmp/project");
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it("leaves Pi's built-in bash active when no shell env overrides are configured", async () => {
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), vi.fn());

    await session.start();

    expect(mockCreateBashToolDefinition).not.toHaveBeenCalled();
  });

  it("resolves openai-codex subscription models", async () => {
    const session = new PiSdkSession(
      {
        cwd: "/tmp/project",
        model: "openai-codex/gpt-5.5",
      },
      vi.fn(),
      vi.fn(),
    );

    await session.start();

    expect(mockGetModel).toHaveBeenCalledWith("openai-codex", "gpt-5.5");
    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        model: {
          id: "gpt-5.5",
          provider: "openai-codex",
        },
        services: expect.objectContaining({ modelRuntime: mockModelRuntime }),
      }),
    );
  });

  it("keeps the aggregator provider for a model id that contains a slash", async () => {
    const session = new PiSdkSession(
      {
        cwd: "/tmp/project",
        model: "openrouter/deepseek/deepseek-v4-flash-0731",
      },
      vi.fn(),
      vi.fn(),
    );

    await session.start();

    expect(mockGetModel).toHaveBeenCalledWith(
      "openrouter",
      "deepseek/deepseek-v4-flash-0731",
    );
    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        model: {
          id: "deepseek/deepseek-v4-flash-0731",
          provider: "openrouter",
        },
      }),
    );
  });

  it("resolves a bare model id that names no provider", async () => {
    // Selections stored before bb prefixed aggregator models keep this shape.
    mockGetModel.mockReturnValue(undefined);
    mockGetModels.mockReturnValue([
      { id: "deepseek/deepseek-v4-flash-0731", provider: "openrouter" },
    ]);
    const session = new PiSdkSession(
      {
        cwd: "/tmp/project",
        model: "deepseek/deepseek-v4-flash-0731",
      },
      vi.fn(),
      vi.fn(),
    );

    await session.start();

    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        model: {
          id: "deepseek/deepseek-v4-flash-0731",
          provider: "openrouter",
        },
      }),
    );
  });

  it("never substitutes another vendor for the named provider", async () => {
    // The named provider has no credentials, and two aggregators serve the same
    // id. Routing there would bill and expose a vendor the user never chose.
    mockGetModel.mockReturnValue({
      id: "claude-sonnet-5",
      provider: "anthropic",
    });
    mockGetModels.mockReturnValue([
      { id: "anthropic/claude-sonnet-5", provider: "openrouter" },
    ]);
    mockHasConfiguredAuth.mockImplementation(
      (provider: string) => provider === "openrouter",
    );
    const session = new PiSdkSession(
      {
        cwd: "/tmp/project",
        model: "anthropic/claude-sonnet-5",
      },
      vi.fn(),
      vi.fn(),
    );

    await session.start();

    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { id: "claude-sonnet-5", provider: "anthropic" },
      }),
    );
  });

  it("uses the sole authenticated provider for an ambiguous bare model id", async () => {
    mockGetModel.mockReturnValue(undefined);
    mockGetModels.mockReturnValue([
      { id: "gpt-5.6-terra", provider: "azure-openai-responses" },
      { id: "gpt-5.6-terra", provider: "openai" },
      { id: "gpt-5.6-terra", provider: "openai-codex" },
    ]);
    mockHasConfiguredAuth.mockImplementation(
      (provider: string) => provider === "openai-codex",
    );
    const session = new PiSdkSession(
      {
        cwd: "/tmp/project",
        model: "gpt-5.6-terra",
      },
      vi.fn(),
      vi.fn(),
    );

    await session.start();

    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { id: "gpt-5.6-terra", provider: "openai-codex" },
      }),
    );
  });

  it("refuses to guess when two providers serve one bare model id", async () => {
    mockGetModel.mockReturnValue(undefined);
    mockGetModels.mockReturnValue([
      { id: "anthropic/claude-opus-4.8", provider: "openrouter" },
      { id: "anthropic/claude-opus-4.8", provider: "vercel-ai-gateway" },
    ]);
    const session = new PiSdkSession(
      {
        cwd: "/tmp/project",
        model: "anthropic/claude-opus-4.8",
      },
      vi.fn(),
      vi.fn(),
    );

    await expect(session.start()).rejects.toThrow(
      /Ambiguous Pi model "anthropic\/claude-opus-4\.8": served by openrouter, vercel-ai-gateway/,
    );
    expect(mockCreateAgentSession).not.toHaveBeenCalled();
  });

  it("rejects unresolved explicit models before opening a Pi session", async () => {
    mockGetModel.mockReturnValueOnce(undefined);
    const session = new PiSdkSession(
      {
        cwd: "/tmp/project",
        model: "unsupported/model",
      },
      vi.fn(),
      vi.fn(),
    );

    await expect(session.start()).rejects.toThrow(
      'Failed to resolve Pi model "unsupported/model"',
    );
    expect(mockCreateAgentSession).not.toHaveBeenCalled();
  });

  it("forwards thinking level to the SDK when configured", async () => {
    const session = new PiSdkSession(
      {
        cwd: "/tmp/project",
        thinkingLevel: "xhigh",
      },
      vi.fn(),
      vi.fn(),
    );

    await session.start();

    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        thinkingLevel: "xhigh",
      }),
    );
  });

  it("scopes shell env overrides to the bash spawn hook without mutating process.env", async () => {
    const sessionEnvKey = "BB_PI_UNIT_SESSION_ENV";
    const processOnlyEnvKey = "BB_PI_UNIT_PROCESS_ONLY_ENV";
    const previousSessionEnvValue = process.env[sessionEnvKey];
    const previousProcessOnlyEnvValue = process.env[processOnlyEnvKey];
    delete process.env[sessionEnvKey];
    process.env[processOnlyEnvKey] = "daemon-secret";
    mockGetShellCommandPrefix.mockReturnValue("source ~/.profile &&");
    mockGetShellPath.mockReturnValue("/bin/zsh");

    try {
      const session = new PiSdkSession(
        {
          cwd: "/tmp/project",
          shellEnvOverrides: {
            BB_THREAD_ID: "t1",
            [sessionEnvKey]: "thread-a",
          },
        },
        vi.fn(),
        vi.fn(),
      );

      await session.start();

      expect(process.env[sessionEnvKey]).toBeUndefined();
      expect(process.env[processOnlyEnvKey]).toBe("daemon-secret");
      expect(mockCreateBashToolDefinition).toHaveBeenCalledTimes(1);
      expect(mockCreateBashToolDefinition).toHaveBeenCalledWith(
        "/tmp/project",
        expect.objectContaining({
          commandPrefix: "source ~/.profile &&",
          shellPath: "/bin/zsh",
        }),
      );

      const bashToolCall = mockCreateBashToolDefinition.mock.calls[0];
      if (!bashToolCall) {
        throw new Error("Expected Pi bash tool to be created");
      }

      const bashToolOptions = bashToolCall[1];
      if (!bashToolOptions?.spawnHook) {
        throw new Error("Expected Pi bash tool to receive a spawn hook");
      }

      const spawnContext: MockBashSpawnContext = {
        command: "printf ok",
        cwd: "/tmp/project",
        env: {
          PATH: "/bin",
          BB_THREAD_ID: "base-thread",
        },
      };

      expect(bashToolOptions.spawnHook(spawnContext)).toEqual({
        command: "printf ok",
        cwd: "/tmp/project",
        env: {
          PATH: "/bin",
          BB_THREAD_ID: "t1",
          [sessionEnvKey]: "thread-a",
        },
      });
    } finally {
      if (previousSessionEnvValue === undefined) {
        delete process.env[sessionEnvKey];
      } else {
        process.env[sessionEnvKey] = previousSessionEnvValue;
      }
      if (previousProcessOnlyEnvValue === undefined) {
        delete process.env[processOnlyEnvKey];
      } else {
        process.env[processOnlyEnvKey] = previousProcessOnlyEnvValue;
      }
    }
  });

  it("re-activates missing custom tools before later prompts", async () => {
    mockGetActiveToolNames
      .mockReturnValueOnce(["read", "bash"])
      .mockReturnValueOnce(["read", "bash"])
      .mockReturnValueOnce(["read", "bash", "notify_user"]);

    const session = new PiSdkSession(
      {
        cwd: "/tmp/project",
        customTools: [
          {
            name: "notify_user",
            label: "notify_user",
            description: "Send a message to the user",
            parameters: {} as ToolDefinition["parameters"],
            execute: vi.fn(async () => ({
              content: [{ type: "text" as const, text: "ok" }],
              details: {},
            })),
          } satisfies ToolDefinition,
        ],
      },
      vi.fn(),
      vi.fn(),
    );

    await session.start();
    await session.prompt("first follow-up").settled;
    await session.prompt("second follow-up").settled;

    expect(mockSetActiveToolsByName).toHaveBeenCalledTimes(2);
    expect(mockSetActiveToolsByName).toHaveBeenNthCalledWith(1, [
      "read",
      "bash",
      "notify_user",
    ]);
    expect(mockSetActiveToolsByName).toHaveBeenNthCalledWith(2, [
      "read",
      "bash",
      "notify_user",
    ]);
  });

  it("queues normal prompts as follow-ups while the SDK is still streaming", async () => {
    mockSessionState.isStreaming = true;
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), vi.fn());

    await session.start();
    session.prompt("queued follow-up");

    expect(mockPrompt).toHaveBeenCalledWith(
      "queued follow-up",
      withPreflight({ streamingBehavior: "followUp" }),
    );
  });

  it("accepts a queued follow-up prompt only once pi reads it", async () => {
    mockSessionState.isStreaming = true;
    mockPrompt.mockImplementationOnce(async () => {
      emitSessionEvent(createQueueUpdateEvent([], ["expanded follow-up"]));
      reportPreflightAccepted();
    });
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), vi.fn());

    await session.start();
    const dispatch = session.prompt("queued follow-up");
    let consumed = false;
    void dispatch.consumed.then(() => {
      consumed = true;
    });
    await flushAsyncWork();

    // Pi queued the prompt behind the live run: it has not read the input, and
    // the run it lands in reports its own settlement.
    expect(consumed).toBe(false);
    await expect(dispatch.settled).resolves.toBeNull();

    emitSessionEvent(createQueueUpdateEvent([], []));
    await expect(dispatch.consumed).resolves.toBeUndefined();
  });

  it("accepts an unqueued prompt when pi reports preflight acceptance", async () => {
    let releaseRun: (() => void) | undefined;
    mockPrompt.mockImplementationOnce(async () => {
      reportPreflightAccepted();
      await new Promise<void>((resolve) => {
        releaseRun = resolve;
      });
    });
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), vi.fn());

    await session.start();
    const dispatch = session.prompt("direct prompt");

    // Pi started the run with the input, so the turn is accepted long before
    // the run it started settles.
    await expect(dispatch.consumed).resolves.toBeUndefined();
    releaseRun?.();
    await expect(dispatch.settled).resolves.toEqual({});
  });

  it("resolves queued steer once the SDK accepts it and monitors consumption", async () => {
    mockSessionState.isStreaming = true;
    mockPrompt.mockImplementationOnce(async () => {
      emitSessionEvent(createQueueUpdateEvent(["expanded steer"]));
    });
    const onDone = vi.fn();
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), onDone);
    let steerAccepted = false;

    await session.start();
    const steerPromise = session.steer("interrupting steer").then(() => {
      steerAccepted = true;
    });
    await steerPromise;

    expect(mockPrompt).toHaveBeenCalledWith(
      "interrupting steer",
      withPreflight({ streamingBehavior: "steer" }),
    );
    expect(steerAccepted).toBe(true);
    expect(onDone).not.toHaveBeenCalled();

    emitSessionEvent(createQueueUpdateEvent([]));
    await flushAsyncWork();

    expect(onDone).not.toHaveBeenCalled();
  });

  it("resolves handled steers when the SDK does not queue input", async () => {
    mockSessionState.isStreaming = true;
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), vi.fn());

    await session.start();
    await session.steer("handled steer");

    expect(mockPrompt).toHaveBeenCalledWith(
      "handled steer",
      withPreflight({ streamingBehavior: "steer" }),
    );
  });

  it("rejects steer consumption when the SDK prompt rejects", async () => {
    mockSessionState.isStreaming = true;
    const promptError = new Error("prompt rejected");
    mockPrompt.mockRejectedValueOnce(promptError);
    const onDone = vi.fn();
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), onDone);

    await session.start();

    await expect(session.steer("rejected steer")).rejects.toThrow(
      "prompt rejected",
    );
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(promptError);
  });

  it("resolves duplicate queued steer text one consumed entry at a time", async () => {
    mockSessionState.isStreaming = true;
    let queuedSteerCount = 0;
    mockPrompt.mockImplementation(async () => {
      queuedSteerCount += 1;
      emitSessionEvent(
        createQueueUpdateEvent(
          Array.from({ length: queuedSteerCount }, () => "same steer"),
        ),
      );
    });
    const onDone = vi.fn();
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), onDone);
    let firstAccepted = false;
    let secondAccepted = false;

    await session.start();
    const firstPromise = session.steer("same steer").then(() => {
      firstAccepted = true;
    });
    await firstPromise;
    const secondPromise = session.steer("same steer").then(() => {
      secondAccepted = true;
    });
    await secondPromise;

    expect(firstAccepted).toBe(true);
    expect(secondAccepted).toBe(true);

    emitSessionEvent(createQueueUpdateEvent(["same steer"]));
    await flushAsyncWork();

    expect(onDone).not.toHaveBeenCalled();

    emitSessionEvent(createQueueUpdateEvent([]));
    await flushAsyncWork();

    expect(onDone).not.toHaveBeenCalled();
  });

  it("reports queued steer consumption failure when the turn ends before delivery", async () => {
    mockSessionState.isStreaming = true;
    mockPrompt.mockImplementationOnce(async () => {
      emitSessionEvent(createQueueUpdateEvent(["undelivered steer"]));
    });
    const onDone = vi.fn();
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), onDone);

    await session.start();
    await session.steer("undelivered steer");

    emitSessionEvent(createAgentEndEvent());
    await flushDeferredSteerSettlement();

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Pi turn ended before steer was consumed",
      }),
    );
  });

  it("keeps a queued follow-up pending past the agent end that continues into it", async () => {
    mockSessionState.isStreaming = true;
    mockPrompt.mockImplementationOnce(async () => {
      emitSessionEvent(createQueueUpdateEvent([], ["queued follow-up"]));
    });
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), vi.fn());

    await session.start();
    const dispatch = session.prompt("queued follow-up");
    let settledConsumption: "consumed" | "failed" | undefined;
    void dispatch.consumed.then(
      () => {
        settledConsumption = "consumed";
      },
      () => {
        settledConsumption = "failed";
      },
    );

    // Pi drains its follow-up queue by continuing the same run after
    // agent_end, so that event is terminal for steering only.
    emitSessionEvent(createAgentEndEvent());
    await flushDeferredSteerSettlement();

    expect(settledConsumption).toBeUndefined();

    emitSessionEvent(createQueueUpdateEvent([], []));
    await expect(dispatch.consumed).resolves.toBeUndefined();
  });

  it("keeps queued steer consumption pending when auto retry starts", async () => {
    mockSessionState.isStreaming = true;
    mockPrompt.mockImplementationOnce(async () => {
      emitSessionEvent(createQueueUpdateEvent(["retry steer"]));
    });
    const onDone = vi.fn();
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), onDone);

    await session.start();
    await session.steer("retry steer");

    emitSessionEvent(createAgentEndEvent(true));
    emitSessionEvent(createAutoRetryStartEvent());
    await flushDeferredSteerSettlement();

    expect(onDone).not.toHaveBeenCalled();

    emitSessionEvent(createAutoRetryEndEvent(true));
    emitSessionEvent(createQueueUpdateEvent([]));
    await flushAsyncWork();

    expect(onDone).not.toHaveBeenCalled();
  });

  it("reports queued steer consumption failure when auto retry ends unsuccessfully", async () => {
    mockSessionState.isStreaming = true;
    mockPrompt.mockImplementationOnce(async () => {
      emitSessionEvent(createQueueUpdateEvent(["retry failed steer"]));
    });
    const onDone = vi.fn();
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), onDone);

    await session.start();
    await session.steer("retry failed steer");

    emitSessionEvent(createAgentEndEvent(true));
    emitSessionEvent(createAutoRetryStartEvent());
    await flushDeferredSteerSettlement();
    emitSessionEvent(createAutoRetryEndEvent(false));
    await flushAsyncWork();

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Pi auto retry ended before steer was consumed",
      }),
    );
  });

  it("omits streaming behavior while the SDK is idle", async () => {
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), vi.fn());

    await session.start();
    session.prompt("idle follow-up");
    await session.steer("idle steer");

    expect(mockPrompt).toHaveBeenNthCalledWith(
      1,
      "idle follow-up",
      withPreflight(),
    );
    expect(mockPrompt).toHaveBeenNthCalledWith(
      2,
      "idle steer",
      withPreflight(),
    );
  });

  it("reports pending steer consumption failure when the session closes", async () => {
    mockSessionState.isStreaming = true;
    mockPrompt.mockImplementationOnce(async () => {
      emitSessionEvent(createQueueUpdateEvent(["closing steer"]));
    });
    const onDone = vi.fn();
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), onDone);

    await session.start();
    await session.steer("closing steer");

    session.stop();
    await flushAsyncWork();

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Pi SDK session stopped before input was consumed",
      }),
    );
  });

  /**
   * Each transient auth miss waits a real 250ms before the retry; drive the
   * clock instead of sleeping through eight of them per test.
   */
  async function settleThroughTransientAuthRetries<T>(
    pending: Promise<T>,
    retries: number,
  ): Promise<T> {
    for (let i = 0; i < retries; i += 1) {
      await vi.advanceTimersByTimeAsync(250);
    }
    return pending;
  }

  it("allows eight transient Pi auth storage misses before succeeding", async () => {
    vi.useFakeTimers();
    try {
      const authError = new Error("No API key found for anthropic.");
      rejectPromptWithTransientAuthError(8, authError);
      mockPrompt.mockResolvedValueOnce(undefined);
      const onDone = vi.fn();
      const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), onDone);

      await session.start();
      await settleThroughTransientAuthRetries(
        session.prompt("retry after auth storage miss").settled,
        8,
      );

      expect(mockPrompt).toHaveBeenCalledTimes(9);
      expect(onDone).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails after nine transient Pi auth storage misses", async () => {
    vi.useFakeTimers();
    try {
      const authError = new Error("No API key found for anthropic.");
      rejectPromptWithTransientAuthError(9, authError);
      const onDone = vi.fn();
      const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), onDone);

      await session.start();
      const dispatch = session.prompt("fail after retry budget");
      void dispatch.consumed.catch(() => undefined);
      await expect(
        settleThroughTransientAuthRetries(dispatch.settled, 8),
      ).resolves.toEqual({ error: authError });
      await expect(dispatch.consumed).rejects.toThrow(
        "No API key found for anthropic.",
      );

      expect(mockPrompt).toHaveBeenCalledTimes(9);
      expect(onDone).toHaveBeenCalledTimes(1);
      expect(onDone).toHaveBeenCalledWith(authError);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays processing across retryable agent-end events", async () => {
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), vi.fn());
    await session.start();
    session.prompt("retry me");

    emitSessionEvent(createAgentEndEvent(true));
    expect(session.getIsProcessing()).toBe(true);

    emitSessionEvent(createAgentEndEvent());
    expect(session.getIsProcessing()).toBe(false);
  });

  it("stays processing while Pi performs post-turn streaming work", async () => {
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), vi.fn());
    await session.start();
    session.prompt("trigger auto compaction");

    emitSessionEvent(createAgentEndEvent());
    mockSessionState.isStreaming = true;

    expect(session.getIsProcessing()).toBe(true);
    await expect(session.compact()).rejects.toThrow(
      "Cannot compact context while Pi is processing a turn",
    );
    expect(mockCompact).not.toHaveBeenCalled();
  });

  it("propagates compaction failures that emit no terminal event", async () => {
    const error = new Error("Pi rejected compaction before it started");
    mockCompact.mockRejectedValueOnce(error);
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), vi.fn());
    await session.start();

    await expect(session.compact()).rejects.toBe(error);
    expect(session.getIsCompacting()).toBe(false);
  });

  it("uses the SDK terminal event as the compaction outcome", async () => {
    const error = new Error("Pi reported compaction failure");
    mockCompact.mockImplementationOnce(async () => {
      emitSessionEvent({
        type: "compaction_start",
        reason: "manual",
      });
      emitSessionEvent({
        type: "compaction_end",
        reason: "manual",
        result: undefined,
        aborted: false,
        willRetry: false,
        errorMessage: error.message,
      });
      throw error;
    });
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), vi.fn());
    await session.start();

    await expect(session.compact()).resolves.toBeUndefined();
    expect(session.getIsCompacting()).toBe(false);
  });

  it("waits for abort before disposing during graceful close", async () => {
    let resolveAbort: (() => void) | undefined;
    mockAbort.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveAbort = resolve;
        }),
    );
    const session = new PiSdkSession({ cwd: "/tmp/project" }, vi.fn(), vi.fn());

    await session.start();
    const closePromise = session.closeGracefully(1_000);
    await Promise.resolve();

    expect(mockAbort).toHaveBeenCalledTimes(1);
    expect(mockDispose).not.toHaveBeenCalled();
    if (!resolveAbort) {
      throw new Error("Expected Pi abort promise to be pending");
    }
    resolveAbort();
    await expect(closePromise).resolves.toBe("pi-entry-checkpoint");

    expect(mockDispose).toHaveBeenCalledTimes(1);
    expect(session.getIsProcessing()).toBe(false);
  });
});
