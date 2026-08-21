import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

type ControlledPiAgentSessionListener = (event: AgentSessionEvent) => void;

interface MockPiResourceLoaderOptions {
  additionalSkillPaths?: readonly string[];
  cwd?: string;
  agentDir?: string;
  systemPrompt?: string;
  appendSystemPromptOverride?: (base: string[]) => string[];
  noExtensions?: boolean;
  noSkills?: boolean;
  noPromptTemplates?: boolean;
  noThemes?: boolean;
}

interface MockPiResourceLoader {
  options: MockPiResourceLoaderOptions;
}

interface MockCreateAgentSessionServicesOptions {
  agentDir: string;
  cwd: string;
  modelRuntime?: object;
  resourceLoaderOptions: MockPiResourceLoaderOptions;
}

const {
  mockCreateAgentSession,
  mockCreateAgentSessionServices,
  mockInMemory,
  mockOpen,
  mockResourceLoaders,
  mockGetPiModelRuntime,
} = vi.hoisted(() => {
  const mockResourceLoaders: MockPiResourceLoader[] = [];
  const mockSettingsManager = {
    getShellCommandPrefix: vi.fn(() => undefined),
    getShellPath: vi.fn(() => undefined),
  };
  const mockModelRuntime = {
    getAvailable: vi.fn(async () => []),
    getModel: vi.fn(() => undefined),
    getModels: vi.fn(() => []),
    hasConfiguredAuth: vi.fn(() => false),
    refresh: vi.fn(async () => ({ aborted: false, errors: new Map() })),
  };
  const mockCreateAgentSessionServices = vi.fn(
    async (options: MockCreateAgentSessionServicesOptions) => {
      const resourceLoader = {
        options: {
          agentDir: options.agentDir,
          cwd: options.cwd,
          ...options.resourceLoaderOptions,
        },
      };
      mockResourceLoaders.push(resourceLoader);
      return {
        agentDir: options.agentDir,
        cwd: options.cwd,
        diagnostics: [],
        modelRuntime: options.modelRuntime ?? mockModelRuntime,
        resourceLoader,
        settingsManager: mockSettingsManager,
      };
    },
  );

  return {
    mockCreateAgentSession: vi.fn(),
    mockCreateAgentSessionServices,
    mockInMemory: vi.fn((cwd?: string) => ({ kind: "in-memory", cwd })),
    mockOpen: vi.fn(),
    mockResourceLoaders,
    mockGetPiModelRuntime: vi.fn(async () => mockModelRuntime),
  };
});

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  // Keep the real SessionManager file operations so fork tests exercise
  // genuine full-history and checkpointed materialization on disk.
  const actual =
    await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  mockOpen.mockImplementation(
    (path: string, sessionDir?: string, cwdOverride?: string) =>
      actual.SessionManager.open(path, sessionDir, cwdOverride),
  );
  return {
    // Keep every other export real: the canonical session dialect reaches
    // tool-definition helpers (defineTool, createBashToolDefinition, ...)
    // that the mocked construction seams do not touch.
    ...actual,
    createAgentSessionFromServices: mockCreateAgentSession,
    createAgentSessionServices: mockCreateAgentSessionServices,
    getAgentDir: vi.fn(() => "/tmp/pi-agent"),
    SessionManager: {
      forkFrom: actual.SessionManager.forkFrom.bind(actual.SessionManager),
      open: mockOpen,
      inMemory: mockInMemory,
    },
  };
});

vi.mock("../configured-services.js", () => ({
  createConfiguredPiServices: mockCreateAgentSessionServices,
}));

vi.mock("../model-runtime.js", () => ({
  getPiModelRuntime: mockGetPiModelRuntime,
}));

import { handleLine } from "../bridge.js";
import {
  restorePiBridgeStdout,
  takeOverPiBridgeStdout,
} from "../output-guard.js";
import { PI_BRIDGE_SESSION_DIR_ENV } from "../session-paths.js";
import {
  createBridgeJsonRpcTestHarness,
  type BridgeJsonRpcObject,
  type BridgeJsonRpcOutputMessage,
} from "@bb/provider-bridge-protocol/testing";
import {
  createStandaloneBuiltinCompactCommandInput,
  type JsonValue,
  type ThreadEvent,
} from "@bb/domain";
import { assembleCapturedThreadEvents } from "@bb/provider-bridge-protocol/testing";

const originalPiBridgeSessionDir = process.env[PI_BRIDGE_SESSION_DIR_ENV];

const CANONICAL_OPTIONS = {
  approvalReviewer: null,
  permissionEscalation: null,
  permissionMode: "full",
  permissionScope: "full",
} as const;

const CLIENT_REQUEST_ID = "creq_abcdefghjk";

/** Canonical session-construction params for thread/start and thread/resume. */
function sessionParams(args: {
  threadId: string;
  cwd?: string;
  instructionMode?: "append" | "replace";
  options?: BridgeJsonRpcObject;
}): BridgeJsonRpcObject {
  return {
    cwd: args.cwd ?? "/tmp/worktree",
    instructionMode: args.instructionMode ?? "append",
    options: { ...CANONICAL_OPTIONS, ...args.options },
    threadId: args.threadId,
  };
}

/** Canonical params for the thread-scoped maintenance methods. */
function threadRef(threadId: string): BridgeJsonRpcObject {
  return { providerThreadId: threadId, threadId };
}

/** Canonical turn/start params. */
function turnStartParams(
  threadId: string,
  input: JsonValue[],
): BridgeJsonRpcObject {
  return {
    clientRequestId: CLIENT_REQUEST_ID,
    input,
    options: CANONICAL_OPTIONS,
    providerThreadId: threadId,
    threadId,
  };
}

/**
 * The composer's standalone builtin `/compact` mention, as the wire JSON a
 * turn/start request carries.
 */
function compactCommandPromptInput(): JsonValue {
  return JSON.parse(
    JSON.stringify(createStandaloneBuiltinCompactCommandInput()[0]),
  ) as JsonValue;
}

/** Canonical turn/steer params. */
function turnSteerParams(
  threadId: string,
  expectedTurnId: string,
  input: JsonValue[],
): BridgeJsonRpcObject {
  return { ...turnStartParams(threadId, input), expectedTurnId };
}

/**
 * The thread events a canonical session emitted, in order. Pi emits
 * `thread/delta` notifications; assembling the full capture through a fresh
 * delta assembler reproduces exactly what the runtime adapter would emit.
 */
function threadEvents(
  messages: readonly BridgeJsonRpcOutputMessage[],
): ThreadEvent[] {
  return assembleCapturedThreadEvents(messages);
}

/** Turn lifecycle only, without the provider diagnostics around it. */
function turnEvents(
  messages: readonly BridgeJsonRpcOutputMessage[],
): ThreadEvent[] {
  return threadEvents(messages).filter((event) =>
    event.type.startsWith("turn/"),
  );
}

interface ControlledPiAgentSession {
  abort: ReturnType<typeof vi.fn>;
  bindExtensions: ReturnType<typeof vi.fn>;
  compact: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  emit(event: AgentSessionEvent): void;
  extensionRunner: { emit: ReturnType<typeof vi.fn> };
  finishAbort(): void;
  finishPrompt(): void;
  getActiveToolNames: ReturnType<typeof vi.fn>;
  getContextUsage: ReturnType<typeof vi.fn>;
  hasExtensionHandlers: ReturnType<typeof vi.fn>;
  isStreaming: boolean;
  prompt: ReturnType<typeof vi.fn>;
  requestExtensionShutdown(): void;
  sessionManager: { getLeafId: ReturnType<typeof vi.fn> };
  setActiveToolsByName: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
}

function createControlledPiAgentSession(): ControlledPiAgentSession {
  let finishAbort: (() => void) | undefined;
  let finishPrompt: (() => void) | undefined;
  let extensionShutdownHandler: (() => void) | undefined;
  const listeners: ControlledPiAgentSessionListener[] = [];
  const abort = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishAbort = resolve;
      }),
  );
  return {
    abort,
    bindExtensions: vi.fn(
      async (bindings: { shutdownHandler?: () => void }) => {
        extensionShutdownHandler = bindings.shutdownHandler;
      },
    ),
    compact: vi.fn(async () => undefined),
    dispose: vi.fn(),
    emit(event: AgentSessionEvent): void {
      for (const listener of [...listeners]) {
        listener(event);
      }
    },
    extensionRunner: { emit: vi.fn(async () => undefined) },
    finishAbort() {
      if (!finishAbort) {
        throw new Error("Expected Pi abort to be waiting");
      }
      finishAbort();
      finishAbort = undefined;
    },
    finishPrompt() {
      if (!finishPrompt) {
        throw new Error("Expected Pi prompt to be running");
      }
      finishPrompt();
      finishPrompt = undefined;
    },
    getActiveToolNames: vi.fn(() => []),
    getContextUsage: vi.fn(() => undefined),
    hasExtensionHandlers: vi.fn(() => false),
    isStreaming: false,
    // Pi accepts the prompt in preflight and only settles when the run it
    // started ends, so a dispatched prompt stays open until a test finishes it.
    prompt: vi.fn(
      async (
        _text: string,
        options?: { preflightResult?: (accepted: boolean) => void },
      ) => {
        options?.preflightResult?.(true);
        await new Promise<void>((resolve) => {
          finishPrompt = resolve;
        });
      },
    ),
    requestExtensionShutdown(): void {
      if (!extensionShutdownHandler) {
        throw new Error("Expected Pi extension shutdown handler to be bound");
      }
      extensionShutdownHandler();
    },
    sessionManager: { getLeafId: vi.fn(() => "pi-entry-checkpoint") },
    setActiveToolsByName: vi.fn(),
    subscribe: vi.fn((listener: ControlledPiAgentSessionListener) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index !== -1) {
          listeners.splice(index, 1);
        }
      };
    }),
  };
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

function createAgentEndEvent(): AgentSessionEvent {
  return {
    type: "agent_end",
    messages: [],
    willRetry: false,
  };
}

function createTurnEndEvent(stopReason: "toolUse" | "stop"): AgentSessionEvent {
  const hasToolResult = stopReason === "toolUse";
  return {
    type: "turn_end",
    message: {
      role: "assistant",
      content: hasToolResult
        ? [
            {
              type: "toolCall",
              id: "call-read-1",
              name: "read",
              arguments: { path: "/tmp/example.txt" },
            },
          ]
        : [{ type: "text", text: "done" }],
      api: "openai-responses",
      provider: "openai",
      model: "gpt-5.4",
      usage: {
        input: 10,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 12,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
      stopReason,
      timestamp: 0,
    },
    toolResults: hasToolResult
      ? [
          {
            role: "toolResult",
            toolCallId: "call-read-1",
            toolName: "read",
            content: [{ type: "text", text: "tool output" }],
            isError: false,
            timestamp: 0,
          },
        ]
      : [],
  };
}

describe("pi bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResourceLoaders.length = 0;
    delete process.env[PI_BRIDGE_SESSION_DIR_ENV];
  });

  it("uses the requested project path for model listing", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);

    try {
      bridge.sendRequest(99, "model/list", { cwd: "/tmp/project-models" });
      await bridge.waitForResponse(99);

      expect(mockGetPiModelRuntime).toHaveBeenCalledWith("/tmp/project-models");
    } finally {
      bridge.restore();
    }
  });

  it("keeps extension stdout out of the JSON-RPC protocol channel", async () => {
    const stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const piSession = createControlledPiAgentSession();
    mockCreateAgentSession.mockResolvedValue({ session: piSession });
    takeOverPiBridgeStdout();

    try {
      bridge.sendRequest(
        100,
        "thread/start",
        sessionParams({ threadId: "thread-extension-stdout" }),
      );
      await bridge.waitForResponse(100);
      bridge.sendRequest(
        101,
        "turn/start",
        turnStartParams("thread-extension-stdout", [
          { type: "text", text: "run" },
        ]),
      );
      await bridge.waitForResponse(101);

      const terminalNotification = "\u001b]777;notify;π;done\u0007";
      process.stdout.write(terminalNotification);
      piSession.emit(createAgentEndEvent());
      await bridge.flushWork();

      expect(stderrWrite).toHaveBeenCalledWith(terminalNotification);
      expect(threadEvents(bridge.messages)).toContainEqual(
        expect.objectContaining({
          type: "turn/completed",
          status: "completed",
          providerCheckpointId: "pi-entry-checkpoint",
        }),
      );
    } finally {
      restorePiBridgeStdout();
      bridge.restore();
      stderrWrite.mockRestore();
    }
  });

  it("forwards redirected stderr backpressure through stdout", () => {
    const stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => false);
    const stdoutDrain = vi.fn();
    process.stdout.once("drain", stdoutDrain);
    takeOverPiBridgeStdout();

    try {
      expect(process.stdout.write("extension output")).toBe(false);
      expect(stdoutDrain).not.toHaveBeenCalled();

      process.stderr.emit("drain");

      expect(stdoutDrain).toHaveBeenCalledOnce();
    } finally {
      restorePiBridgeStdout();
      process.stdout.off("drain", stdoutDrain);
      stderrWrite.mockRestore();
    }
  });

  afterEach(() => {
    if (originalPiBridgeSessionDir === undefined) {
      delete process.env[PI_BRIDGE_SESSION_DIR_ENV];
      return;
    }
    process.env[PI_BRIDGE_SESSION_DIR_ENV] = originalPiBridgeSessionDir;
  });

  it("passes appendSystemPrompt through Pi's append override path", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    mockCreateAgentSession.mockImplementation(async () => ({
      session: createControlledPiAgentSession(),
    }));

    try {
      bridge.sendRequest(
        1,
        "thread/start",
        sessionParams({
          threadId: "thread-append",
          instructionMode: "append",
          options: { instructions: "BB append instructions" },
        }),
      );
      await bridge.waitForResponse(1);

      expect(mockResourceLoaders).toHaveLength(1);
      expect(mockResourceLoaders[0]?.options).toMatchObject({
        cwd: "/tmp/worktree",
      });
      expect(mockResourceLoaders[0]?.options.systemPrompt).toBeUndefined();
      expect(mockResourceLoaders[0]?.options.noSkills).toBeUndefined();
      expect(
        mockResourceLoaders[0]?.options.appendSystemPromptOverride?.([
          "Project append instructions",
        ]),
      ).toEqual(["Project append instructions", "BB append instructions"]);
    } finally {
      bridge.restore();
    }
  });

  // Sessions carry no skill roots in their options; the roots the runtime
  // configures once per process must reach every session the bridge builds
  // afterwards, or injected skills are silently dropped.
  it("applies skills/configure roots to new sessions", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    mockCreateAgentSession.mockImplementation(async () => ({
      session: createControlledPiAgentSession(),
    }));

    try {
      bridge.sendRequest(70, "skills/configure", {
        roots: [
          { id: "root_a", path: "/staged/pi-skills-a", skills: [] },
          { id: "root_b", path: "/staged/pi-skills-b", skills: [] },
        ],
      });
      await bridge.waitForResponse(70);

      bridge.sendRequest(
        71,
        "thread/start",
        sessionParams({ threadId: "thread-configured-skills" }),
      );
      const response = await bridge.waitForResponse(71);

      expect(response.error).toBeUndefined();
      expect(mockResourceLoaders).toHaveLength(1);
      expect(mockResourceLoaders[0]?.options).toMatchObject({
        cwd: "/tmp/worktree",
        additionalSkillPaths: ["/staged/pi-skills-a", "/staged/pi-skills-b"],
      });
      expect(mockResourceLoaders[0]?.options.noSkills).toBeUndefined();
    } finally {
      // The latch is process-scoped; clear it so later tests see no paths.
      bridge.sendRequest(79, "skills/configure", { roots: [] });
      bridge.restore();
    }
  });

  it("passes baseInstructions through Pi's replacement system prompt path", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    mockCreateAgentSession.mockImplementation(async () => ({
      session: createControlledPiAgentSession(),
    }));

    try {
      bridge.sendRequest(
        2,
        "thread/start",
        sessionParams({
          threadId: "thread-replace",
          instructionMode: "replace",
          options: { instructions: "Replacement prompt" },
        }),
      );
      await bridge.waitForResponse(2);

      expect(mockResourceLoaders).toHaveLength(1);
      expect(mockResourceLoaders[0]?.options).toMatchObject({
        cwd: "/tmp/worktree",
        systemPrompt: "Replacement prompt",
      });
      expect(mockResourceLoaders[0]?.options.noExtensions).toBeUndefined();
      expect(mockResourceLoaders[0]?.options.noSkills).toBeUndefined();
      expect(mockResourceLoaders[0]?.options.noPromptTemplates).toBeUndefined();
      expect(mockResourceLoaders[0]?.options.noThemes).toBeUndefined();
      expect(
        mockResourceLoaders[0]?.options.appendSystemPromptOverride,
      ).toBeUndefined();
    } finally {
      bridge.restore();
    }
  });

  it.each(["low", "max"] as const)(
    "passes thread/start %s reasoningLevel through to Pi thinkingLevel",
    async (reasoningLevel) => {
      const bridge = createBridgeJsonRpcTestHarness(handleLine);
      mockCreateAgentSession.mockImplementation(async () => ({
        session: createControlledPiAgentSession(),
      }));

      try {
        bridge.sendRequest(
          3,
          "thread/start",
          sessionParams({
            threadId: `thread-reasoning-${reasoningLevel}`,
            options: { reasoningLevel },
          }),
        );
        await bridge.waitForResponse(3);

        expect(mockCreateAgentSession).toHaveBeenCalledWith(
          expect.objectContaining({
            thinkingLevel: reasoningLevel,
          }),
        );
      } finally {
        bridge.restore();
      }
    },
  );

  // Historical fix 21c6e391f: bb's "none" is the one reasoning-ladder name Pi
  // spells differently ("off"). Dropping it (like unsupported levels) would
  // silently leave extended thinking at Pi's default instead of disabling it.
  it('maps reasoningLevel "none" to Pi thinkingLevel "off" on thread/start', async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    mockCreateAgentSession.mockImplementation(async () => ({
      session: createControlledPiAgentSession(),
    }));

    try {
      bridge.sendRequest(
        60,
        "thread/start",
        sessionParams({
          threadId: "thread-none",
          options: { reasoningLevel: "none" },
        }),
      );
      const response = await bridge.waitForResponse(60);

      expect(response.error).toBeUndefined();
      expect(mockCreateAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({ thinkingLevel: "off" }),
      );
    } finally {
      bridge.restore();
    }
  });

  it('maps reasoningLevel "none" to Pi thinkingLevel "off" on thread/resume', async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    mockCreateAgentSession.mockImplementation(async () => ({
      session: createControlledPiAgentSession(),
    }));

    try {
      bridge.sendRequest(61, "thread/resume", {
        ...sessionParams({
          threadId: "thread-none-resume",
          options: { reasoningLevel: "none" },
        }),
        providerThreadId: "thread-none-resume",
      });
      const response = await bridge.waitForResponse(61);

      expect(response.error).toBeUndefined();
      expect(mockCreateAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({ thinkingLevel: "off" }),
      );
    } finally {
      bridge.restore();
    }
  });

  it("uses the configured bridge session directory for default Pi sessions", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    mockCreateAgentSession.mockImplementation(async () => ({
      session: createControlledPiAgentSession(),
    }));
    process.env[PI_BRIDGE_SESSION_DIR_ENV] = "/tmp/pi-bridge-test-sessions";

    try {
      bridge.sendRequest(
        4,
        "thread/start",
        sessionParams({ threadId: "thread/session:test" }),
      );
      await bridge.waitForResponse(4);

      expect(mockOpen).toHaveBeenCalledWith(
        join("/tmp/pi-bridge-test-sessions", "thread_session_test.jsonl"),
        "/tmp/pi-bridge-test-sessions",
      );
    } finally {
      bridge.restore();
    }
  });

  it("reopens a stable provider session under a new bb thread id", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const resumedSession = createControlledPiAgentSession();
    mockCreateAgentSession.mockResolvedValue({ session: resumedSession });
    const sessionDir = mkdtempSync(join(tmpdir(), "pi-resume-test-"));
    process.env[PI_BRIDGE_SESSION_DIR_ENV] = sessionDir;
    const providerThreadId = "thread-original";
    const resumedThreadId = "thread-resumed";
    const providerSessionFile = join(sessionDir, `${providerThreadId}.jsonl`);
    writeFileSync(
      providerSessionFile,
      `${JSON.stringify({
        type: "session",
        version: 3,
        id: "persisted-session",
        timestamp: "2026-08-17T00:00:00.000Z",
        cwd: "/tmp/worktree",
      })}\n`,
    );

    try {
      bridge.sendRequest(62, "thread/resume", {
        ...sessionParams({ threadId: resumedThreadId }),
        providerThreadId,
      });
      await expect(bridge.waitForResponse(62)).resolves.toMatchObject({
        id: 62,
        result: { providerThreadId, sessionRestorable: true },
      });

      expect(mockOpen).toHaveBeenCalledWith(providerSessionFile, sessionDir);
      expect(bridge.messages).toContainEqual(
        expect.objectContaining({
          method: "thread/identity",
          params: {
            threadId: resumedThreadId,
            providerThreadId,
            sessionRestorable: true,
          },
        }),
      );
      // Resume is a session construction: the assembler must drop the
      // thread's prior id space before any of the new session's deltas.
      expect(bridge.messages).toContainEqual(
        expect.objectContaining({
          method: "thread/delta",
          params: {
            threadId: resumedThreadId,
            deltas: [{ kind: "session.reset" }],
          },
        }),
      );

      bridge.sendRequest(63, "thread/discard", {
        providerThreadId,
        threadId: resumedThreadId,
      });
      await bridge.flushWork();
      resumedSession.finishAbort();
      await expect(bridge.waitForResponse(63)).resolves.toMatchObject({
        id: 63,
        result: { ok: true },
      });
      expect(existsSync(providerSessionFile)).toBe(false);
    } finally {
      bridge.restore();
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it("emits session.reset right after identity on thread/start", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    mockCreateAgentSession.mockResolvedValue({
      session: createControlledPiAgentSession(),
    });

    try {
      bridge.sendRequest(
        66,
        "thread/start",
        sessionParams({ threadId: "thread-reset-start" }),
      );
      await bridge.waitForResponse(66);

      const identityIndex = bridge.messages.findIndex(
        (message) => message.method === "thread/identity",
      );
      const resetIndex = bridge.messages.findIndex(
        (message) =>
          message.method === "thread/delta" &&
          JSON.stringify(message.params) ===
            JSON.stringify({
              threadId: "thread-reset-start",
              deltas: [{ kind: "session.reset" }],
            }),
      );
      // Identity precedes every thread/delta for the session, and the reset
      // precedes any of the new session's other deltas (it is the first).
      expect(identityIndex).toBeGreaterThanOrEqual(0);
      expect(resetIndex).toBeGreaterThan(identityIndex);
      const firstDeltaIndex = bridge.messages.findIndex(
        (message) => message.method === "thread/delta",
      );
      expect(firstDeltaIndex).toBe(resetIndex);
    } finally {
      bridge.restore();
    }
  });

  it("fails thread/start when the requested Pi model cannot be resolved", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    mockCreateAgentSession.mockImplementation(async () => ({
      session: createControlledPiAgentSession(),
    }));

    try {
      bridge.sendRequest(
        4,
        "thread/start",
        sessionParams({
          threadId: "thread-invalid-model",
          options: { model: "unsupported/model" },
        }),
      );
      await expect(bridge.waitForResponse(4)).resolves.toMatchObject({
        error: {
          code: -32000,
          message: 'Failed to resolve Pi model "unsupported/model"',
        },
        id: 4,
      });
      expect(mockCreateAgentSession).not.toHaveBeenCalled();
      expect(
        bridge.messages.some((message) => message.method === "thread/identity"),
      ).toBe(false);
    } finally {
      bridge.restore();
    }
  });

  it("forks source history through a checkpoint into the deterministic file", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const forkedSession = createControlledPiAgentSession();
    mockCreateAgentSession.mockImplementation(async () => ({
      session: forkedSession,
    }));

    const sessionDir = mkdtempSync(join(tmpdir(), "pi-fork-test-"));
    process.env[PI_BRIDGE_SESSION_DIR_ENV] = sessionDir;

    // Materialize a source session file at the source thread's deterministic
    // path so the fork exercises genuine SessionManager.forkFrom file copying.
    const sourceThreadId = "thr_source";
    const sourceFile = join(sessionDir, `${sourceThreadId}.jsonl`);
    const sourceContent = `${[
      JSON.stringify({
        type: "session",
        version: 3,
        id: "source-session",
        timestamp: "2026-06-15T00:00:00.000Z",
        cwd: "/tmp/worktree",
      }),
      JSON.stringify({
        type: "message",
        id: "e1",
        parentId: null,
        timestamp: "2026-06-15T00:00:01.000Z",
        message: { role: "user", content: "remember 42" },
      }),
      JSON.stringify({
        type: "message",
        id: "e2",
        parentId: "e1",
        timestamp: "2026-06-15T00:00:02.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "noted: 42" }],
        },
      }),
      JSON.stringify({
        type: "message",
        id: "e3",
        parentId: "e2",
        timestamp: "2026-06-15T00:00:03.000Z",
        message: { role: "user", content: "forget 42" },
      }),
      JSON.stringify({
        type: "message",
        id: "e4",
        parentId: "e3",
        timestamp: "2026-06-15T00:00:04.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "forgotten" }],
        },
      }),
    ].join("\n")}\n`;
    writeFileSync(sourceFile, sourceContent);

    const targetThreadId = "thr_fork";
    const targetFile = join(sessionDir, `${targetThreadId}.jsonl`);

    try {
      bridge.sendRequest(40, "thread/fork", {
        ...sessionParams({ threadId: targetThreadId }),
        sourceProviderCheckpointId: "e2",
        sourceProviderThreadId: sourceThreadId,
      });
      const response = await bridge.waitForResponse(40);
      if (response.error !== undefined) {
        throw new Error(JSON.stringify(response.error));
      }
      expect(response).toMatchObject({
        id: 40,
        result: {
          providerThreadId: targetThreadId,
          sessionRestorable: true,
        },
      });

      // The forked session is materialized at the NEW thread's deterministic
      // path, carrying the retained source path plus parentSession lineage.
      const forkedContent = readFileSync(targetFile, "utf8");
      expect(forkedContent).toContain("remember 42");
      expect(forkedContent).toContain("noted: 42");
      expect(forkedContent).not.toContain("forget 42");
      expect(forkedContent).not.toContain("forgotten");
      expect(forkedContent).toContain(`"parentSession":"${sourceFile}"`);
      // Source file is left untouched by the fork.
      expect(readFileSync(sourceFile, "utf8")).toBe(sourceContent);

      // The bridge opens the new thread's deterministic file and keeps bb's
      // threadId as the provider identity (no provider-id remap).
      expect(mockOpen).toHaveBeenCalledWith(targetFile, sessionDir);
      expect(bridge.messages).toContainEqual(
        expect.objectContaining({
          method: "thread/identity",
          params: {
            threadId: targetThreadId,
            providerThreadId: targetThreadId,
            sessionRestorable: true,
          },
        }),
      );
      // Fork is a session construction: the new session's id space must not
      // inherit assembly state from any prior session on the thread.
      expect(bridge.messages).toContainEqual(
        expect.objectContaining({
          method: "thread/delta",
          params: {
            threadId: targetThreadId,
            deltas: [{ kind: "session.reset" }],
          },
        }),
      );
      bridge.sendRequest(42, "thread/discard", threadRef(targetThreadId));
      await bridge.flushWork();
      forkedSession.finishAbort();
      await expect(bridge.waitForResponse(42)).resolves.toMatchObject({
        id: 42,
        result: { ok: true },
      });
      expect(existsSync(targetFile)).toBe(false);
      expect(readFileSync(sourceFile, "utf8")).toBe(sourceContent);
    } finally {
      bridge.restore();
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it("fails thread/fork when the source session file is missing", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    mockCreateAgentSession.mockImplementation(async () => ({
      session: createControlledPiAgentSession(),
    }));

    const sessionDir = mkdtempSync(join(tmpdir(), "pi-fork-missing-"));
    process.env[PI_BRIDGE_SESSION_DIR_ENV] = sessionDir;

    try {
      bridge.sendRequest(41, "thread/fork", {
        ...sessionParams({ threadId: "thr_fork_missing" }),
        sourceProviderThreadId: "thr_no_source",
      });
      await expect(bridge.waitForResponse(41)).resolves.toMatchObject({
        id: 41,
        error: {
          code: -32000,
          message:
            'Cannot fork: source pi session file not found for thread "thr_no_source"',
        },
      });
      expect(mockCreateAgentSession).not.toHaveBeenCalled();
      expect(
        bridge.messages.some((message) => message.method === "thread/identity"),
      ).toBe(false);
    } finally {
      bridge.restore();
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it("rejects thread/start params that are not the canonical shape", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    mockCreateAgentSession.mockImplementation(async () => ({
      session: createControlledPiAgentSession(),
    }));

    try {
      // No `options`: the only session-construction shape the bridge speaks
      // carries the full execution options.
      bridge.sendRequest(3, "thread/start", {
        cwd: "/tmp/worktree",
        instructionMode: "append",
        threadId: "thread-shapeless",
      });

      // Reply, never drop (#853): schema-invalid params answer INVALID_PARAMS
      // instead of leaving the runtime to time out.
      await expect(bridge.waitForResponse(3)).resolves.toMatchObject({
        id: 3,
        error: { code: -32602 },
      });
      expect(mockCreateAgentSession).not.toHaveBeenCalled();
      expect(mockResourceLoaders).toHaveLength(0);
    } finally {
      bridge.restore();
    }
  });

  it("holds thread stop open until the Pi SDK session closes", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const sessions: ControlledPiAgentSession[] = [];
    mockCreateAgentSession.mockImplementation(async () => {
      const session = createControlledPiAgentSession();
      sessions.push(session);
      return { session };
    });

    try {
      bridge.sendRequest(
        1,
        "thread/start",
        sessionParams({ threadId: "thread-stop-waits" }),
      );
      await bridge.waitForResponse(1);

      bridge.sendRequest(2, "thread/stop", {
        ...threadRef("thread-stop-waits"),
        activeTurnId: null,
        intent: "release",
      });
      await bridge.flushWork();

      expect(bridge.hasResponse(2)).toBe(false);
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.abort).toHaveBeenCalledTimes(1);
      expect(sessions[0]?.dispose).not.toHaveBeenCalled();

      sessions[0]?.sessionManager.getLeafId.mockReturnValue(
        "pi-entry-after-abort",
      );
      sessions[0]?.finishAbort();
      await expect(bridge.waitForResponse(2)).resolves.toMatchObject({
        id: 2,
        result: {
          ok: true,
          providerCheckpointId: "pi-entry-after-abort",
        },
      });
      expect(sessions[0]?.dispose).toHaveBeenCalledTimes(1);
    } finally {
      bridge.restore();
    }
  });

  it("waits for an in-flight close before replacing the same thread", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const sessions: ControlledPiAgentSession[] = [];
    mockCreateAgentSession.mockImplementation(async () => {
      const session = createControlledPiAgentSession();
      sessions.push(session);
      return { session };
    });

    try {
      bridge.sendRequest(
        11,
        "thread/start",
        sessionParams({ threadId: "thread-overlap" }),
      );
      await bridge.waitForResponse(11);

      bridge.sendRequest(12, "thread/stop", {
        ...threadRef("thread-overlap"),
        activeTurnId: null,
        intent: "release",
      });
      await bridge.flushWork();
      bridge.sendRequest(
        13,
        "thread/start",
        sessionParams({ threadId: "thread-overlap" }),
      );
      await bridge.flushWork();

      expect(bridge.hasResponse(12)).toBe(false);
      expect(bridge.hasResponse(13)).toBe(false);
      expect(sessions).toHaveLength(1);

      sessions[0]?.finishAbort();
      await expect(bridge.waitForResponse(12)).resolves.toMatchObject({
        id: 12,
        result: { ok: true },
      });
      await expect(bridge.waitForResponse(13)).resolves.toMatchObject({
        id: 13,
      });
      expect(sessions).toHaveLength(2);

      bridge.sendRequest(14, "thread/stop", {
        ...threadRef("thread-overlap"),
        activeTurnId: null,
        intent: "release",
      });
      await bridge.flushWork();
      sessions[1]?.finishAbort();
      await bridge.waitForResponse(14);
    } finally {
      bridge.restore();
    }
  });

  it("shuts down extensions before disposing a replaced thread session", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const sessions: ControlledPiAgentSession[] = [];
    mockCreateAgentSession.mockImplementation(async () => {
      const session = createControlledPiAgentSession();
      sessions.push(session);
      return { session };
    });

    try {
      bridge.sendRequest(
        15,
        "thread/start",
        sessionParams({ threadId: "thread-replaced" }),
      );
      await bridge.waitForResponse(15);
      sessions[0]?.hasExtensionHandlers.mockReturnValue(true);

      bridge.sendRequest(16, "thread/resume", {
        ...sessionParams({ threadId: "thread-replaced" }),
        providerThreadId: "thread-replaced",
      });
      await bridge.flushWork();

      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.abort).toHaveBeenCalledOnce();
      expect(sessions[0]?.extensionRunner.emit).not.toHaveBeenCalled();
      expect(sessions[0]?.dispose).not.toHaveBeenCalled();

      sessions[0]?.finishAbort();
      await bridge.waitForResponse(16);

      expect(sessions).toHaveLength(2);
      expect(sessions[0]?.extensionRunner.emit).toHaveBeenCalledWith({
        type: "session_shutdown",
        reason: "quit",
      });
      expect(sessions[0]?.dispose).toHaveBeenCalledOnce();
      expect(
        sessions[0]?.extensionRunner.emit.mock.invocationCallOrder[0],
      ).toBeLessThan(sessions[0]?.dispose.mock.invocationCallOrder[0] ?? 0);

      sessions[0]?.requestExtensionShutdown();
      await bridge.flushWork();
      expect(sessions[1]?.abort).not.toHaveBeenCalled();

      bridge.sendRequest(17, "thread/stop", {
        ...threadRef("thread-replaced"),
        activeTurnId: null,
        intent: "release",
      });
      await bridge.flushWork();
      sessions[1]?.finishAbort();
      await bridge.waitForResponse(17);
    } finally {
      bridge.restore();
    }
  });

  it("responds to turn/steer after the SDK accepts queued steer input", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const piSession = createControlledPiAgentSession();
    piSession.isStreaming = true;
    piSession.prompt.mockImplementation(async () => {
      piSession.emit(createQueueUpdateEvent(["expanded steer"]));
    });
    mockCreateAgentSession.mockImplementation(async () => ({
      session: piSession,
    }));

    try {
      bridge.sendRequest(
        21,
        "thread/start",
        sessionParams({ threadId: "thread-steer-consumption" }),
      );
      await bridge.waitForResponse(21);

      bridge.sendRequest(
        22,
        "turn/steer",
        turnSteerParams("thread-steer-consumption", "turn-active", [
          { type: "text", text: "interrupting steer" },
        ]),
      );
      await bridge.flushWork();

      expect(piSession.prompt).toHaveBeenCalledWith(
        "interrupting steer",
        expect.objectContaining({ streamingBehavior: "steer" }),
      );
      await expect(bridge.waitForResponse(22)).resolves.toMatchObject({
        id: 22,
        result: { threadId: "thread-steer-consumption" },
      });
    } finally {
      bridge.restore();
    }
  });

  it("reports when a turn/start prompt settles without SDK turn events", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const piSession = createControlledPiAgentSession();
    mockCreateAgentSession.mockResolvedValue({ session: piSession });

    try {
      bridge.sendRequest(
        50,
        "thread/start",
        sessionParams({ threadId: "thread-zero-work" }),
      );
      await bridge.waitForResponse(50);

      bridge.sendRequest(
        51,
        "turn/start",
        turnStartParams("thread-zero-work", [
          { type: "text", text: "/local-extension-command" },
        ]),
      );
      await bridge.waitForResponse(51);
      piSession.finishPrompt();
      await bridge.flushWork();

      // The accepted input opened a turn the SDK never worked on; the settle
      // signal must still close it, or the runtime waits forever.
      expect(threadEvents(bridge.messages)).toContainEqual(
        expect.objectContaining({
          type: "turn/completed",
          status: "completed",
        }),
      );
    } finally {
      bridge.restore();
    }
  });

  it("reports context usage after every Pi turn_end without duplicating agent_end", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const piSession = createControlledPiAgentSession();
    piSession.getContextUsage
      .mockReturnValueOnce({
        tokens: 10_500,
        contextWindow: 1_050_000,
        percent: 1,
      })
      .mockReturnValueOnce({
        tokens: 11_750,
        contextWindow: 1_050_000,
        percent: (11_750 / 1_050_000) * 100,
      });
    piSession.prompt.mockImplementation(async () => {
      piSession.emit({ type: "agent_start" });
      piSession.emit(createTurnEndEvent("toolUse"));
      piSession.emit(createTurnEndEvent("stop"));
      piSession.emit(createAgentEndEvent());
    });
    mockCreateAgentSession.mockResolvedValue({ session: piSession });

    try {
      bridge.sendRequest(
        52,
        "thread/start",
        sessionParams({ threadId: "thread-context-usage" }),
      );
      await bridge.waitForResponse(52);

      bridge.sendRequest(
        53,
        "turn/start",
        turnStartParams("thread-context-usage", [
          { type: "text", text: "read and respond" },
        ]),
      );
      await bridge.waitForResponse(53);
      await bridge.flushWork();

      const usageEvents = threadEvents(bridge.messages).filter(
        (event) => event.type === "thread/contextWindowUsage/updated",
      );
      expect(usageEvents).toEqual([
        expect.objectContaining({
          contextWindowUsage: {
            usedTokens: 10_500,
            modelContextWindow: 1_050_000,
            estimated: true,
          },
        }),
        expect.objectContaining({
          contextWindowUsage: {
            usedTokens: 11_750,
            modelContextWindow: 1_050_000,
            estimated: true,
          },
        }),
      ]);
      expect(piSession.getContextUsage).toHaveBeenCalledTimes(2);
    } finally {
      bridge.restore();
    }
  });

  it("compacts the session instead of prompting for a standalone /compact command", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const piSession = createControlledPiAgentSession();
    piSession.compact.mockImplementation(async () => {
      piSession.emit({ type: "compaction_start", reason: "manual" });
      piSession.emit({
        type: "compaction_end",
        reason: "manual",
        result: undefined,
        aborted: false,
        willRetry: false,
      });
    });
    mockCreateAgentSession.mockResolvedValue({ session: piSession });

    try {
      bridge.sendRequest(
        60,
        "thread/start",
        sessionParams({ threadId: "thread-compact" }),
      );
      await bridge.waitForResponse(60);

      bridge.sendRequest(
        61,
        "turn/start",
        turnStartParams("thread-compact", [compactCommandPromptInput()]),
      );
      await bridge.waitForResponse(61);
      await bridge.flushWork();

      // The builtin /compact affordance is a compaction request, not model
      // input: prompting with the literal text would just make the model talk
      // about compaction while the context keeps growing.
      expect(piSession.compact).toHaveBeenCalledTimes(1);
      expect(piSession.prompt).not.toHaveBeenCalled();
      expect(threadEvents(bridge.messages)).toContainEqual(
        expect.objectContaining({ type: "thread/compacted" }),
      );
    } finally {
      bridge.restore();
    }
  });

  it("fails the compaction turn when the Pi session refuses to compact", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const piSession = createControlledPiAgentSession();
    piSession.compact.mockRejectedValue(new Error("Nothing to compact"));
    mockCreateAgentSession.mockResolvedValue({ session: piSession });

    try {
      bridge.sendRequest(
        62,
        "thread/start",
        sessionParams({ threadId: "thread-compact-failure" }),
      );
      await bridge.waitForResponse(62);

      bridge.sendRequest(
        63,
        "turn/start",
        turnStartParams("thread-compact-failure", [
          compactCommandPromptInput(),
        ]),
      );
      await bridge.waitForResponse(63);
      await bridge.flushWork();

      // A refusal emits no compaction events, so without the settle report the
      // requested turn would never close.
      expect(threadEvents(bridge.messages)).toContainEqual(
        expect.objectContaining({
          type: "turn/completed",
          status: "failed",
          error: { message: "Nothing to compact" },
        }),
      );
    } finally {
      bridge.restore();
    }
  });

  it("holds a turn/start pi queued behind a live run until pi reads it", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const piSession = createControlledPiAgentSession();
    piSession.isStreaming = true;
    // Pi queues a prompt that arrives while a run is still live and returns
    // straight away: the dispatch call settling is not the run settling.
    piSession.prompt.mockImplementation(
      async (
        _text: string,
        options?: { preflightResult?: (accepted: boolean) => void },
      ) => {
        piSession.emit(createQueueUpdateEvent([], ["queued prompt"]));
        options?.preflightResult?.(true);
      },
    );
    mockCreateAgentSession.mockImplementation(async () => ({
      session: piSession,
    }));

    try {
      bridge.sendRequest(
        80,
        "thread/start",
        sessionParams({ threadId: "thread-queued-turn" }),
      );
      await bridge.waitForResponse(80);

      bridge.sendRequest(
        81,
        "turn/start",
        turnStartParams("thread-queued-turn", [
          { type: "text", text: "queued prompt" },
        ]),
      );
      await bridge.flushWork();
      await bridge.flushWork();

      // Accepting queued input lets the queue-time settle report claim it and
      // complete an empty turn for a message pi has not read (#2014).
      expect(turnEvents(bridge.messages)).toEqual([]);

      piSession.emit(createQueueUpdateEvent([], []));
      await expect(bridge.waitForResponse(81)).resolves.toMatchObject({
        id: 81,
        result: { threadId: "thread-queued-turn" },
      });

      piSession.emit({ type: "agent_start" });
      await bridge.flushWork();

      // The acceptance lands in the turn pi opened for the input it read.
      expect(turnEvents(bridge.messages)).toEqual([
        expect.objectContaining({ type: "turn/started" }),
        expect.objectContaining({ type: "turn/input/accepted" }),
      ]);
    } finally {
      bridge.restore();
    }
  });

  it("emits an error when a queued steer is not consumed before agent end", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const piSession = createControlledPiAgentSession();
    piSession.isStreaming = true;
    piSession.prompt.mockImplementation(async () => {
      piSession.emit(createQueueUpdateEvent(["undelivered steer"]));
    });
    mockCreateAgentSession.mockImplementation(async () => ({
      session: piSession,
    }));

    try {
      bridge.sendRequest(
        31,
        "thread/start",
        sessionParams({ threadId: "thread-undelivered-steer" }),
      );
      await bridge.waitForResponse(31);

      bridge.sendRequest(
        32,
        "turn/steer",
        turnSteerParams("thread-undelivered-steer", "turn-active", [
          { type: "text", text: "undelivered steer" },
        ]),
      );
      await bridge.flushWork();

      await expect(bridge.waitForResponse(32)).resolves.toMatchObject({
        id: 32,
        result: { threadId: "thread-undelivered-steer" },
      });

      piSession.emit(createAgentEndEvent());
      await bridge.flushWork();
      await bridge.flushWork();

      expect(bridge.messages).toContainEqual(
        expect.objectContaining({
          method: "error",
          params: {
            threadId: "thread-undelivered-steer",
            providerThreadId: "thread-undelivered-steer",
            message: "Pi turn ended before steer was consumed",
          },
        }),
      );
    } finally {
      bridge.restore();
    }
  });
});
