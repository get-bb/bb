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
import { createBridgeJsonRpcTestHarness } from "../../../test/bridge-json-rpc-test-helpers.js";

const originalPiBridgeSessionDir = process.env[PI_BRIDGE_SESSION_DIR_ENV];

interface ControlledPiAgentSession {
  abort: ReturnType<typeof vi.fn>;
  bindExtensions: ReturnType<typeof vi.fn>;
  compact: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  emit(event: AgentSessionEvent): void;
  extensionRunner: { emit: ReturnType<typeof vi.fn> };
  finishAbort(): void;
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
    getActiveToolNames: vi.fn(() => []),
    getContextUsage: vi.fn(() => undefined),
    hasExtensionHandlers: vi.fn(() => false),
    isStreaming: false,
    prompt: vi.fn(async () => {}),
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
): AgentSessionEvent {
  return {
    type: "queue_update",
    steering,
    followUp: [],
  };
}

function createAgentEndEvent(): AgentSessionEvent {
  return {
    type: "agent_end",
    messages: [],
    willRetry: false,
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
      bridge.sendRequest(100, "thread/start", {
        cwd: "/tmp/worktree",
        threadId: "thread-extension-stdout",
      });
      await bridge.waitForResponse(100);

      const terminalNotification = "\u001b]777;notify;π;done\u0007";
      process.stdout.write(terminalNotification);
      piSession.emit(createAgentEndEvent());
      await bridge.flushWork();

      expect(stderrWrite).toHaveBeenCalledWith(terminalNotification);
      expect(bridge.messages).toContainEqual(
        expect.objectContaining({
          method: "sdk/message",
          params: {
            threadId: "thread-extension-stdout",
            message: {
              ...createAgentEndEvent(),
              providerCheckpointId: "pi-entry-checkpoint",
            },
          },
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
      bridge.sendRequest(1, "thread/start", {
        cwd: "/tmp/worktree",
        threadId: "thread-append",
        appendSystemPrompt: "BB append instructions",
      });
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

  it("passes additional skill paths through Pi's resource loader path", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    mockCreateAgentSession.mockImplementation(async () => ({
      session: createControlledPiAgentSession(),
    }));

    try {
      bridge.sendRequest(5, "thread/start", {
        cwd: "/tmp/worktree",
        threadId: "thread-skills",
        additionalSkillPaths: ["/tmp/bb-skills", "/tmp/repo-skills"],
      });
      await bridge.waitForResponse(5);

      expect(mockResourceLoaders).toHaveLength(1);
      expect(mockResourceLoaders[0]?.options).toMatchObject({
        cwd: "/tmp/worktree",
        additionalSkillPaths: ["/tmp/bb-skills", "/tmp/repo-skills"],
      });
      expect(mockResourceLoaders[0]?.options.noSkills).toBeUndefined();
    } finally {
      bridge.restore();
    }
  });

  it("passes baseInstructions through Pi's replacement system prompt path", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    mockCreateAgentSession.mockImplementation(async () => ({
      session: createControlledPiAgentSession(),
    }));

    try {
      bridge.sendRequest(2, "thread/start", {
        cwd: "/tmp/worktree",
        threadId: "thread-replace",
        baseInstructions: "Replacement prompt",
      });
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

  it.each(["off", "max"] as const)(
    "passes thread/start %s reasoningLevel through to Pi thinkingLevel",
    async (reasoningLevel) => {
      const bridge = createBridgeJsonRpcTestHarness(handleLine);
      mockCreateAgentSession.mockImplementation(async () => ({
        session: createControlledPiAgentSession(),
      }));

      try {
        bridge.sendRequest(3, "thread/start", {
          cwd: "/tmp/worktree",
          threadId: `thread-reasoning-${reasoningLevel}`,
          reasoningLevel,
        });
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

  it("uses the configured bridge session directory for default Pi sessions", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    mockCreateAgentSession.mockImplementation(async () => ({
      session: createControlledPiAgentSession(),
    }));
    process.env[PI_BRIDGE_SESSION_DIR_ENV] = "/tmp/pi-bridge-test-sessions";

    try {
      bridge.sendRequest(4, "thread/start", {
        cwd: "/tmp/worktree",
        threadId: "thread/session:test",
      });
      await bridge.waitForResponse(4);

      expect(mockOpen).toHaveBeenCalledWith(
        join("/tmp/pi-bridge-test-sessions", "thread_session_test.jsonl"),
        "/tmp/pi-bridge-test-sessions",
      );
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
      bridge.sendRequest(4, "thread/start", {
        cwd: "/tmp/worktree",
        model: "unsupported/model",
        threadId: "thread-invalid-model",
      });
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
        cwd: "/tmp/worktree",
        providerCheckpointId: "e2",
        threadId: targetThreadId,
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
          threadId: targetThreadId,
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
          },
        }),
      );
      bridge.sendRequest(42, "thread/discard", { threadId: targetThreadId });
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
        cwd: "/tmp/worktree",
        threadId: "thr_fork_missing",
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

  it("rejects requests that combine replacement and append instructions", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    mockCreateAgentSession.mockImplementation(async () => ({
      session: createControlledPiAgentSession(),
    }));

    try {
      bridge.sendRequest(3, "thread/start", {
        cwd: "/tmp/worktree",
        threadId: "thread-both",
        baseInstructions: "Replacement prompt",
        appendSystemPrompt: "Append prompt",
      });
      await bridge.flushWork();

      expect(bridge.hasResponse(3)).toBe(false);
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
      bridge.sendRequest(1, "thread/start", {
        cwd: "/tmp/worktree",
        threadId: "thread-stop-waits",
      });
      await bridge.waitForResponse(1);

      bridge.sendRequest(2, "thread/stop", { threadId: "thread-stop-waits" });
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

  it("acknowledges Pi compaction before the SDK reports its outcome", async () => {
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const session = createControlledPiAgentSession();
    let rejectCompaction: ((error: Error) => void) | undefined;
    session.compact.mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => {
        rejectCompaction = reject;
      }),
    );
    mockCreateAgentSession.mockResolvedValue({ session });

    try {
      bridge.sendRequest(1, "thread/start", {
        cwd: "/tmp/worktree",
        threadId: "thread-compact",
      });
      await bridge.waitForResponse(1);

      bridge.sendRequest(2, "thread/compact", {
        threadId: "thread-compact",
      });

      await expect(bridge.waitForResponse(2)).resolves.toMatchObject({
        id: 2,
        result: { threadId: "thread-compact" },
      });
      expect(session.compact).toHaveBeenCalledOnce();
      expect(session.prompt).not.toHaveBeenCalled();

      bridge.sendRequest(3, "turn/steer", {
        threadId: "thread-compact",
        expectedTurnId: "turn-compact",
        input: [{ type: "text", text: "wait for compaction", mentions: [] }],
      });
      await expect(bridge.waitForResponse(3)).resolves.toMatchObject({
        id: 3,
        error: {
          message: "Cannot steer while context compaction is active",
        },
      });
      expect(session.prompt).not.toHaveBeenCalled();

      rejectCompaction?.(new Error("Pi compaction failed"));
      await bridge.flushWork();
      expect(
        bridge.messages.filter((message) => message.id === 2),
      ).toHaveLength(1);
      expect(bridge.messages).toContainEqual({
        jsonrpc: "2.0",
        method: "error",
        params: {
          threadId: "thread-compact",
          message: "Pi compaction failed",
        },
      });
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
      bridge.sendRequest(11, "thread/start", {
        cwd: "/tmp/worktree",
        threadId: "thread-overlap",
      });
      await bridge.waitForResponse(11);

      bridge.sendRequest(12, "thread/stop", { threadId: "thread-overlap" });
      await bridge.flushWork();
      bridge.sendRequest(13, "thread/start", {
        cwd: "/tmp/worktree",
        threadId: "thread-overlap",
      });
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

      bridge.sendRequest(14, "thread/stop", { threadId: "thread-overlap" });
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
      bridge.sendRequest(15, "thread/start", {
        cwd: "/tmp/worktree",
        threadId: "thread-replaced",
      });
      await bridge.waitForResponse(15);
      sessions[0]?.hasExtensionHandlers.mockReturnValue(true);

      bridge.sendRequest(16, "thread/resume", {
        cwd: "/tmp/worktree",
        threadId: "thread-replaced",
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

      bridge.sendRequest(17, "thread/stop", { threadId: "thread-replaced" });
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
      bridge.sendRequest(21, "thread/start", {
        cwd: "/tmp/worktree",
        threadId: "thread-steer-consumption",
      });
      await bridge.waitForResponse(21);

      bridge.sendRequest(22, "turn/steer", {
        threadId: "thread-steer-consumption",
        expectedTurnId: "turn-active",
        input: [{ type: "text", text: "interrupting steer" }],
      });
      await bridge.flushWork();

      expect(piSession.prompt).toHaveBeenCalledWith("interrupting steer", {
        streamingBehavior: "steer",
      });
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
      bridge.sendRequest(50, "thread/start", {
        cwd: "/tmp/worktree",
        threadId: "thread-zero-work",
      });
      await bridge.waitForResponse(50);

      bridge.sendRequest(51, "turn/start", {
        threadId: "thread-zero-work",
        input: [{ type: "text", text: "/local-extension-command" }],
      });
      await bridge.waitForResponse(51);
      await bridge.flushWork();

      expect(bridge.messages).toContainEqual({
        jsonrpc: "2.0",
        method: "pi/prompt/settled",
        params: {
          threadId: "thread-zero-work",
          status: "completed",
        },
      });
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
      bridge.sendRequest(31, "thread/start", {
        cwd: "/tmp/worktree",
        threadId: "thread-undelivered-steer",
      });
      await bridge.waitForResponse(31);

      bridge.sendRequest(32, "turn/steer", {
        threadId: "thread-undelivered-steer",
        expectedTurnId: "turn-active",
        input: [{ type: "text", text: "undelivered steer" }],
      });
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
            message: "Pi turn ended before steer was consumed",
          },
        }),
      );
    } finally {
      bridge.restore();
    }
  });
});
