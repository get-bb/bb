import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { turnScope, type ThreadEvent } from "@bb/domain";
import type { ProviderAdapter } from "./provider-adapter.js";
import { createAgentRuntimeWithAdapters } from "./runtime.js";
import { RuntimeProviderProcessManager } from "./runtime-provider-process.js";
import { RuntimeThreadIdentityRegistry } from "./runtime-thread-identity.js";
import { fakeProviderScriptPath } from "./test/index.js";
import {
  createFakeAdapter,
  fullRuntimeOptions,
  waitForRuntimeState,
  waitForThreadAgentMessageText,
} from "./test/runtime-test-harness.js";
import { promptTextInput } from "./test/prompt-input.js";
import type { AgentRuntimeOptions } from "./types.js";
import type { ProviderRuntimeEvent } from "./runtime-json-rpc.js";

interface CreateProviderProcessManagerArgs {
  env?: Record<string, string>;
  onStderr?: NonNullable<AgentRuntimeOptions["onStderr"]>;
  onProcessExit: NonNullable<AgentRuntimeOptions["onProcessExit"]>;
  scriptPath: string;
  workspacePath: string;
}

interface WriteThreadScopedProviderScriptArgs {
  logPath: string;
  scriptPath: string;
}

interface ProviderAccountErrorParams {
  providerThreadId: string;
  threadId: string;
  turnId: string;
}

describe("createAgentRuntime process lifecycle", () => {
  let tmpDir: string;
  let scriptPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "bb-runtime-test-"));
    scriptPath = fakeProviderScriptPath;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function createProviderProcessManager(
    args: CreateProviderProcessManagerArgs,
  ): RuntimeProviderProcessManager {
    const identityRegistry = new RuntimeThreadIdentityRegistry();
    let nextRequestId = 1;
    return new RuntimeProviderProcessManager({
      additionalWorkspaceWriteRoots: [],
      adapterFactory: () => createNoopInitializeAdapter(args.scriptPath),
      bridgeBundleDir: undefined,
      captureThreadExitState: (threadId) => ({
        activeTurnId: null,
        providerThreadId:
          identityRegistry.getProviderThreadId(threadId) ?? null,
        threadId,
      }),
      createProviderIdentityState: (providerId) =>
        identityRegistry.createProviderState({ providerId }),
      env: args.env,
      getNextRequestId: () => nextRequestId++,
      handleStdoutLine: () => undefined,
      onProcessExit: args.onProcessExit,
      onProviderIdentityWaitersInterrupted: (providerProcess) =>
        identityRegistry.resolvePendingIdentityWaiters(
          providerProcess.identity,
        ),
      onProviderThreadDetached: (threadId) =>
        identityRegistry.clearThread(threadId),
      onStderr: args.onStderr,
      skillRoots: [],
      workspacePath: args.workspacePath,
    });
  }

  function createNoopInitializeAdapter(scriptPath: string): ProviderAdapter {
    const adapter = createFakeAdapter(scriptPath);
    return {
      ...adapter,
      buildCommandPlan(command) {
        if (command.type === "initialize") {
          return { kind: "noop", reason: "initialized by process spawn" };
        }
        return adapter.buildCommandPlan(command);
      },
    };
  }

  function readLogLines(logPath: string): string[] {
    if (!existsSync(logPath)) {
      return [];
    }
    const content = readFileSync(logPath, "utf8").trim();
    return content.length > 0 ? content.split("\n") : [];
  }

  function readStringParam(
    params: Record<string, unknown>,
    key: string,
  ): string | null {
    const value = params[key];
    return typeof value === "string" ? value : null;
  }

  function isJsonRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function parseProviderAccountErrorParams(
    event: ProviderRuntimeEvent,
  ): ProviderAccountErrorParams | null {
    if (event.method !== "provider/account_error") {
      return null;
    }
    if (!isJsonRecord(event.params)) {
      return null;
    }

    const threadId = readStringParam(event.params, "threadId");
    const providerThreadId = readStringParam(event.params, "providerThreadId");
    const turnId = readStringParam(event.params, "turnId");
    if (!threadId || !providerThreadId || !turnId) {
      return null;
    }
    return { providerThreadId, threadId, turnId };
  }

  function createCodexAccountErrorAdapter(scriptPath: string): ProviderAdapter {
    const adapter = createFakeAdapter(scriptPath);
    return {
      ...adapter,
      displayName: "Codex",
      id: "codex",
      translateEvent(event, context) {
        const translated = adapter.translateEvent(event, context);
        const params = parseProviderAccountErrorParams(event);
        if (!params) {
          return translated;
        }

        return [
          ...translated,
          {
            type: "provider/error",
            threadId: params.threadId,
            providerThreadId: params.providerThreadId,
            scope: turnScope(params.turnId),
            message: "Provider error",
            detail:
              "unexpected status 401 Unauthorized: Missing bearer or basic authentication in header",
            willRetry: false,
            errorInfo: {
              category: "unknown",
              providerCode: "other",
              httpStatusCode: null,
            },
          },
        ];
      },
    };
  }

  function writeThreadScopedProviderScript(
    args: WriteThreadScopedProviderScriptArgs,
  ): void {
    writeFileSync(
      args.scriptPath,
      `const fs = require("fs");
const readline = require("readline");
const logPath = ${JSON.stringify(args.logPath)};
const processId = String(process.pid);
fs.appendFileSync(logPath, "spawn:" + processId + "\\n");
process.on("SIGTERM", () => {
  fs.appendFileSync(logPath, "exit:" + processId + "\\n");
  process.exit(0);
});
const rl = readline.createInterface({ input: process.stdin });
const threads = new Map();
let nextTurnId = 1;
function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}
function params(message) {
  return message && typeof message.params === "object" && message.params !== null
    ? message.params
    : {};
}
function textInput(input) {
  return Array.isArray(input)
    ? input
        .filter((item) => item && item.type === "text" && typeof item.text === "string")
        .map((item) => item.text)
        .join(" ")
    : "";
}
function finishTurn(threadId, providerThreadId, turnId, status, responseText) {
  if (status === "completed") {
    send({
      jsonrpc: "2.0",
      method: "item/completed",
      params: {
        threadId,
        providerThreadId,
        turnId,
        item: {
          type: "agentMessage",
          id: "msg-" + turnId,
          text: responseText,
        },
      },
    });
  }
  send({
    jsonrpc: "2.0",
    method: "turn/completed",
    params: { threadId, providerThreadId, turnId, status },
  });
}
rl.on("line", (line) => {
  const message = JSON.parse(line);
  const messageParams = params(message);
  if (message.method === "initialize" || message.method === "skills/configure") {
    send({ jsonrpc: "2.0", id: message.id, result: { ok: true } });
    return;
  }
  if (message.method === "thread/start") {
    const threadId = messageParams.threadId;
    const providerThreadId = "prov-" + processId;
    fs.appendFileSync(logPath, "thread-start:" + processId + ":" + threadId + "\\n");
    threads.set(threadId, providerThreadId);
    send({ jsonrpc: "2.0", id: message.id, result: { providerThreadId } });
    send({
      jsonrpc: "2.0",
      method: "thread/identity",
      params: { threadId, providerThreadId },
    });
    return;
  }
  if (message.method === "thread/resume") {
    const threadId = messageParams.threadId;
    const providerThreadId = messageParams.providerThreadId;
    fs.appendFileSync(logPath, "thread-resume:" + processId + ":" + threadId + ":" + providerThreadId + "\\n");
    threads.set(threadId, providerThreadId);
    send({ jsonrpc: "2.0", id: message.id, result: { providerThreadId } });
    send({
      jsonrpc: "2.0",
      method: "thread/identity",
      params: { threadId, providerThreadId },
    });
    return;
  }
  if (message.method === "turn/start") {
    const threadId = messageParams.threadId;
    const providerThreadId = messageParams.providerThreadId;
    if (!threads.has(threadId)) {
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32000, message: "Unknown thread: " + threadId },
      });
      return;
    }
    const turnId = "turn-" + nextTurnId++;
    const inputText = textInput(messageParams.input);
    send({ jsonrpc: "2.0", id: message.id, result: { ok: true } });
    fs.appendFileSync(logPath, "turn-start:" + processId + ":" + threadId + ":" + inputText + "\\n");
    if (inputText.includes("prestart_account_error")) {
      send({
        jsonrpc: "2.0",
        method: "provider/account_error",
        params: { threadId, providerThreadId, turnId },
      });
      return;
    }
    send({
      jsonrpc: "2.0",
      method: "turn/started",
      params: { threadId, providerThreadId, turnId },
    });
    if (inputText.includes("hold_turn")) {
      return;
    }
    if (inputText.includes("account_error")) {
      send({
        jsonrpc: "2.0",
        method: "provider/account_error",
        params: { threadId, providerThreadId, turnId },
      });
      finishTurn(threadId, providerThreadId, turnId, "failed", "");
      return;
    }
    finishTurn(threadId, providerThreadId, turnId, "completed", "pid:" + processId + ":" + inputText);
    return;
  }
  if (message.method === "thread/stop") {
    const threadId = messageParams.threadId;
    fs.appendFileSync(logPath, "thread-stop:" + processId + ":" + threadId + "\\n");
    threads.delete(threadId);
    send({ jsonrpc: "2.0", id: message.id, result: { ok: true } });
  }
});`,
    );
  }

  it("handles JSON-RPC error responses from provider", async () => {
    const events: ThreadEvent[] = [];
    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: (e) => events.push(e),
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => createFakeAdapter(scriptPath),
    });

    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });

    // runTurn on a thread that the fake provider doesn't know about (start creates it,
    // but if we use a different threadId the fake script returns an error)
    // Actually, let's test the bad thread case through the provider error path:
    // The fake provider returns an error for unknown threads in turn/start
    // But our runtime maps threadId -> provider, so we need to trick it.
    // Instead, test with a custom adapter that always returns errors:
    const errorAdapter: ProviderAdapter = {
      ...createFakeAdapter(scriptPath),
      buildCommandPlan(cmd) {
        if (cmd.type === "turn/start") {
          return { kind: "request", method: "bad_method", params: {} };
        }
        return createFakeAdapter(scriptPath).buildCommandPlan(cmd);
      },
    };

    const runtime2 = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: () => {},
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => errorAdapter,
    });

    await runtime2.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    // This should reject because the provider returns a -32601 error
    await expect(
      runtime2.runTurn({
        clientRequestId: "creq_222222224w",
        threadId: "t1",
        input: [promptTextInput({ text: "hi" })],
        options: fullRuntimeOptions,
      }),
    ).rejects.toThrow("Method not found");
    await runtime.shutdown();
    await runtime2.shutdown();
  });

  // ---- Process lifecycle ----

  it("fires onProcessExit when provider crashes", async () => {
    const exitInfo = vi.fn();
    const crashScript = join(tmpDir, "crash-provider.cjs");
    writeFileSync(
      crashScript,
      `const rl = require("readline").createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        const msg = JSON.parse(line);
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
          setTimeout(() => process.exit(42), 50);
        }
      });`,
    );

    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: () => {},
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      onProcessExit: exitInfo,
      adapterFactory: () => createFakeAdapter(crashScript),
    });

    await runtime.ensureProvider({ providerId: "fake" });
    await waitForRuntimeState({
      label: "provider process exit callback",
      predicate: () => exitInfo.mock.calls.length === 1,
    });

    expect(exitInfo).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "fake", code: 42 }),
    );
    await runtime.shutdown();
  });

  it("shutdown kills processes and rejects pending requests", async () => {
    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: () => {},
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => createFakeAdapter(scriptPath),
    });

    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await runtime.shutdown();
    // Should not hang
  });

  it("treats shutdown process errors as expected without carrying state to replacement processes", async () => {
    const exitInfo = vi.fn<NonNullable<AgentRuntimeOptions["onProcessExit"]>>();
    const manager = createProviderProcessManager({
      onProcessExit: exitInfo,
      scriptPath,
      workspacePath: tmpDir,
    });

    await manager.ensureProvider({ processKey: "fake", providerId: "fake" });
    const shuttingDownProcess = manager.requireProviderProcess({
      processKey: "fake",
      providerId: "fake",
    });
    const shutdown = manager.shutdownProvider({
      processKey: "fake",
      providerId: "fake",
      timeoutMs: 50,
    });
    shuttingDownProcess.child.emit(
      "error",
      new Error("simulated shutdown process error"),
    );

    expect(exitInfo).toHaveBeenCalledTimes(1);
    expect(exitInfo).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        code: null,
        expected: true,
        providerId: "fake",
      }),
    );
    await shutdown;

    await manager.ensureProvider({ processKey: "fake", providerId: "fake" });
    const replacementProcess = manager.requireProviderProcess({
      processKey: "fake",
      providerId: "fake",
    });
    replacementProcess.child.emit("exit", 64, null);

    await waitForRuntimeState({
      label: "unexpected replacement process exit",
      predicate: () => exitInfo.mock.calls.length === 2,
    });
    expect(exitInfo).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        code: 64,
        expected: false,
        providerId: "fake",
      }),
    );
    replacementProcess.child.kill("SIGTERM");
    await manager.shutdown();
  });

  it("runs each codex thread on a separate provider process", async () => {
    const events: ThreadEvent[] = [];
    const processLogPath = join(tmpDir, "thread-scoped-provider.log");
    const threadScopedProviderScript = join(
      tmpDir,
      "thread-scoped-provider.cjs",
    );
    writeThreadScopedProviderScript({
      logPath: processLogPath,
      scriptPath: threadScopedProviderScript,
    });

    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: (event) => {
        events.push(event);
      },
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => {
        const adapter = createFakeAdapter(threadScopedProviderScript);
        return {
          ...adapter,
          displayName: "Codex",
          id: "codex",
        };
      },
    });

    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "codex",
      options: fullRuntimeOptions,
    });
    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t2",
      projectId: "p1",
      providerId: "codex",
      options: fullRuntimeOptions,
    });

    await waitForRuntimeState({
      label: "two codex provider processes spawned",
      predicate: () =>
        readLogLines(processLogPath).filter((line) => line.startsWith("spawn:"))
          .length === 2,
      runtime,
    });

    const firstSession = runtime.getProviderSession("t1");
    const secondSession = runtime.getProviderSession("t2");
    if (!firstSession || !secondSession) {
      throw new Error("Expected both codex threads to have provider sessions");
    }
    expect(firstSession.providerThreadId).not.toBe(
      secondSession.providerThreadId,
    );

    await Promise.all([
      runtime.runTurn({
        clientRequestId: "creq_2222222250",
        threadId: "t1",
        input: [promptTextInput({ text: "first" })],
        options: fullRuntimeOptions,
      }),
      runtime.runTurn({
        clientRequestId: "creq_2222222251",
        threadId: "t2",
        input: [promptTextInput({ text: "second" })],
        options: fullRuntimeOptions,
      }),
    ]);
    await waitForThreadAgentMessageText({
      events,
      providerId: "codex",
      runtime,
      text: "first",
      threadId: "t1",
    });
    await waitForThreadAgentMessageText({
      events,
      providerId: "codex",
      runtime,
      text: "second",
      threadId: "t2",
    });

    await runtime.stopThread({ threadId: "t1" });
    await waitForRuntimeState({
      label: "one codex provider process exited after stopping one thread",
      predicate: () =>
        readLogLines(processLogPath).filter((line) => line.startsWith("exit:"))
          .length === 1,
      runtime,
    });

    await runtime.runTurn({
      clientRequestId: "creq_2222222252",
      threadId: "t2",
      input: [promptTextInput({ text: "still alive" })],
      options: fullRuntimeOptions,
    });
    await waitForThreadAgentMessageText({
      events,
      providerId: "codex",
      runtime,
      text: "still alive",
      threadId: "t2",
    });

    await runtime.shutdown();
  });

  it("restarts a codex thread process after a terminal account error before the next turn", async () => {
    const events: ThreadEvent[] = [];
    const processLogPath = join(tmpDir, "account-restart-provider.log");
    const threadScopedProviderScript = join(
      tmpDir,
      "account-restart-provider.cjs",
    );
    writeThreadScopedProviderScript({
      logPath: processLogPath,
      scriptPath: threadScopedProviderScript,
    });

    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: (event) => {
        events.push(event);
      },
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () =>
        createCodexAccountErrorAdapter(threadScopedProviderScript),
    });

    try {
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "codex",
        options: fullRuntimeOptions,
      });
      const initialSession = runtime.getProviderSession("t1");
      if (!initialSession) {
        throw new Error("Expected initial provider session");
      }

      await runtime.runTurn({
        clientRequestId: "creq_2222222253",
        threadId: "t1",
        input: [promptTextInput({ text: "account_error" })],
        options: fullRuntimeOptions,
      });
      await waitForRuntimeState({
        label: "terminal codex account error turn",
        predicate: () =>
          events.some(
            (event) =>
              event.type === "provider/error" &&
              event.threadId === "t1" &&
              event.detail?.includes("401 Unauthorized") &&
              event.willRetry === false,
          ) &&
          events.some(
            (event) =>
              event.type === "turn/completed" &&
              event.threadId === "t1" &&
              event.status === "failed",
          ),
        runtime,
      });
      events.splice(0, events.length);

      await runtime.runTurn({
        clientRequestId: "creq_2222222254",
        threadId: "t1",
        input: [promptTextInput({ text: "after reauth" })],
        options: fullRuntimeOptions,
      });
      await waitForThreadAgentMessageText({
        events,
        providerId: "codex",
        runtime,
        text: "after reauth",
        threadId: "t1",
      });

      expect(runtime.getProviderSession("t1")).toEqual(initialSession);
      const logLines = readLogLines(processLogPath);
      expect(logLines.filter((line) => line.startsWith("spawn:"))).toHaveLength(
        2,
      );
      expect(logLines.filter((line) => line.startsWith("exit:"))).toHaveLength(
        1,
      );
      expect(
        logLines.filter(
          (line) =>
            line.startsWith("thread-resume:") &&
            line.endsWith(`:t1:${initialSession.providerThreadId}`),
        ),
      ).toHaveLength(1);

      const accountErrorTurn = logLines.find((line) =>
        line.endsWith(":t1:account_error"),
      );
      const afterReauthTurn = logLines.find((line) =>
        line.endsWith(":t1:after reauth"),
      );
      if (!accountErrorTurn || !afterReauthTurn) {
        throw new Error("Expected account-error and post-reauth turn logs");
      }
      const accountErrorProcessId = accountErrorTurn.split(":")[1];
      const afterReauthProcessId = afterReauthTurn.split(":")[1];
      expect(afterReauthProcessId).not.toBe(accountErrorProcessId);
    } finally {
      await runtime.shutdown();
    }
  });

  it("reaps a codex thread process after a terminal provider error before turn start", async () => {
    const events: ThreadEvent[] = [];
    const processLogPath = join(tmpDir, "prestart-error-reaper-provider.log");
    const threadScopedProviderScript = join(
      tmpDir,
      "prestart-error-reaper-provider.cjs",
    );
    writeThreadScopedProviderScript({
      logPath: processLogPath,
      scriptPath: threadScopedProviderScript,
    });

    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: (event) => {
        events.push(event);
      },
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () =>
        createCodexAccountErrorAdapter(threadScopedProviderScript),
    });

    try {
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "codex",
        options: fullRuntimeOptions,
      });
      const initialSession = runtime.getProviderSession("t1");
      if (!initialSession) {
        throw new Error("Expected initial provider session");
      }

      await runtime.runTurn({
        clientRequestId: "creq_2222222255",
        threadId: "t1",
        input: [promptTextInput({ text: "prestart_account_error" })],
        options: fullRuntimeOptions,
      });
      await waitForRuntimeState({
        label: "pre-start terminal codex account error",
        predicate: () =>
          events.some(
            (event) =>
              event.type === "provider/error" &&
              event.threadId === "t1" &&
              event.willRetry === false,
          ),
        runtime,
      });

      const result = await runtime.reapIdleProviderSessions({
        idleForMs: 0,
        nowMs: Date.now(),
      });

      expect(result.reapedSessions).toEqual([
        expect.objectContaining({
          providerId: "codex",
          providerThreadId: initialSession.providerThreadId,
          threadId: "t1",
        }),
      ]);
      await waitForRuntimeState({
        label: "pre-start error codex provider process exited",
        predicate: () =>
          readLogLines(processLogPath).filter((line) =>
            line.startsWith("exit:"),
          ).length === 1,
        runtime,
      });
    } finally {
      await runtime.shutdown();
    }
  });

  it("reaps an idle codex thread process and resumes it later", async () => {
    const events: ThreadEvent[] = [];
    const processLogPath = join(tmpDir, "idle-reaper-provider.log");
    const threadScopedProviderScript = join(tmpDir, "idle-reaper-provider.cjs");
    writeThreadScopedProviderScript({
      logPath: processLogPath,
      scriptPath: threadScopedProviderScript,
    });

    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: (event) => {
        events.push(event);
      },
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => {
        const adapter = createFakeAdapter(threadScopedProviderScript);
        return {
          ...adapter,
          displayName: "Codex",
          id: "codex",
        };
      },
    });

    try {
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "codex",
        options: fullRuntimeOptions,
      });
      const initialSession = runtime.getProviderSession("t1");
      if (!initialSession) {
        throw new Error("Expected initial provider session");
      }

      await runtime.runTurn({
        clientRequestId: "creq_2222222255",
        threadId: "t1",
        input: [promptTextInput({ text: "before reap" })],
        options: fullRuntimeOptions,
      });
      await waitForThreadAgentMessageText({
        events,
        providerId: "codex",
        runtime,
        text: "before reap",
        threadId: "t1",
      });

      const belowThresholdResult = await runtime.reapIdleProviderSessions({
        idleForMs: 30 * 60 * 1000,
        nowMs: Date.now() + 29 * 60 * 1000,
      });
      expect(belowThresholdResult.reapedSessions).toEqual([]);
      expect(runtime.hasThread("t1")).toBe(true);
      expect(
        readLogLines(processLogPath).filter((line) => line.startsWith("exit:")),
      ).toHaveLength(0);

      const result = await runtime.reapIdleProviderSessions({
        idleForMs: 30 * 60 * 1000,
        nowMs: Date.now() + 31 * 60 * 1000,
      });
      const reapedSession = result.reapedSessions[0];
      if (!reapedSession) {
        throw new Error("Expected one reaped provider session");
      }
      expect(result.reapedSessions).toHaveLength(1);
      expect(reapedSession).toMatchObject({
        providerId: "codex",
        providerThreadId: initialSession.providerThreadId,
        threadId: "t1",
      });
      expect(reapedSession.idleForMs).toBeGreaterThanOrEqual(30 * 60 * 1000);
      await waitForRuntimeState({
        label: "idle codex provider process exited",
        predicate: () =>
          readLogLines(processLogPath).filter((line) =>
            line.startsWith("exit:"),
          ).length === 1,
        runtime,
      });
      expect(runtime.hasThread("t1")).toBe(false);
      expect(runtime.getProviderSession("t1")).toBeNull();

      events.splice(0, events.length);
      await runtime.resumeThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerThreadId: initialSession.providerThreadId,
        providerId: "codex",
        options: fullRuntimeOptions,
      });
      await runtime.runTurn({
        clientRequestId: "creq_2222222256",
        threadId: "t1",
        input: [promptTextInput({ text: "after reap" })],
        options: fullRuntimeOptions,
      });
      await waitForThreadAgentMessageText({
        events,
        providerId: "codex",
        runtime,
        text: "after reap",
        threadId: "t1",
      });

      const logLines = readLogLines(processLogPath);
      expect(logLines.filter((line) => line.startsWith("spawn:"))).toHaveLength(
        2,
      );
      expect(logLines.filter((line) => line.startsWith("exit:"))).toHaveLength(
        1,
      );
      expect(
        logLines.filter(
          (line) =>
            line.startsWith("thread-resume:") &&
            line.endsWith(`:t1:${initialSession.providerThreadId}`),
        ),
      ).toHaveLength(1);
    } finally {
      await runtime.shutdown();
    }
  });

  it("does not reap a codex thread process while a turn is active", async () => {
    const processLogPath = join(tmpDir, "active-turn-reaper-provider.log");
    const threadScopedProviderScript = join(
      tmpDir,
      "active-turn-reaper-provider.cjs",
    );
    writeThreadScopedProviderScript({
      logPath: processLogPath,
      scriptPath: threadScopedProviderScript,
    });

    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: () => {},
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => {
        const adapter = createFakeAdapter(threadScopedProviderScript);
        return {
          ...adapter,
          displayName: "Codex",
          id: "codex",
        };
      },
    });

    try {
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "codex",
        options: fullRuntimeOptions,
      });
      await runtime.runTurn({
        clientRequestId: "creq_2222222257",
        threadId: "t1",
        input: [promptTextInput({ text: "hold_turn" })],
        options: fullRuntimeOptions,
      });
      const activeTurnId = await runtime.waitForActiveTurn("t1", {
        timeoutMs: 1_000,
      });
      expect(activeTurnId).not.toBeNull();

      const firstResult = await runtime.reapIdleProviderSessions({
        idleForMs: 0,
        nowMs: Date.now() + 60 * 60 * 1000,
      });
      const secondResult = await runtime.reapIdleProviderSessions({
        idleForMs: 0,
        nowMs: Date.now() + 60 * 60 * 1000,
      });

      expect(firstResult.reapedSessions).toEqual([]);
      expect(secondResult.reapedSessions).toEqual([]);
      expect(runtime.hasThread("t1")).toBe(true);
      expect(
        readLogLines(processLogPath).filter((line) => line.startsWith("exit:")),
      ).toHaveLength(0);
      await runtime.stopThread({ threadId: "t1" });
    } finally {
      await runtime.shutdown();
    }
  });

  it("scrubs inherited bb runtime env vars before spawning provider processes", async () => {
    vi.stubEnv("BB_DATA_DIR", "/tmp/leaked-bb-data");
    vi.stubEnv("BB_SERVER_PORT", "38886");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("OPENAI_API_KEY", "external-secret");
    const envScript = join(tmpDir, "env-provider.cjs");
    writeFileSync(
      envScript,
      `const values = [
        process.env.BB_DATA_DIR ?? "missing",
        process.env.BB_SERVER_PORT ?? "missing",
        process.env.NODE_ENV ?? "missing",
        process.env.OPENAI_API_KEY ?? "missing",
        process.env.BB_THREAD_ID ?? "missing"
      ];
      process.stderr.write(values.join("|") + "\\n");
      setInterval(() => {}, 1000);`,
    );
    const stderrLines: string[] = [];
    const manager = createProviderProcessManager({
      env: {
        BB_THREAD_ID: "thr_explicit",
      },
      onProcessExit: vi.fn(),
      onStderr: (line) => {
        stderrLines.push(line);
      },
      scriptPath: envScript,
      workspacePath: tmpDir,
    });

    try {
      await manager.ensureProvider({ processKey: "fake", providerId: "fake" });
      await waitForRuntimeState({
        label: "provider env stderr",
        predicate: () => stderrLines.length > 0,
      });

      expect(stderrLines[0]).toBe(
        "missing|missing|missing|external-secret|thr_explicit",
      );
    } finally {
      await manager.shutdown();
    }
  });

  it("ignores provider stdout emitted after shutdown starts", async () => {
    const events: ThreadEvent[] = [];
    const shutdownEventScript = join(tmpDir, "shutdown-event-provider.cjs");
    writeFileSync(
      shutdownEventScript,
      `const rl = require("readline").createInterface({ input: process.stdin });
      process.on("SIGTERM", () => {
        process.stdout.write(JSON.stringify({
          jsonrpc: "2.0",
          method: "thread/identity",
          params: { threadId: "t1", providerThreadId: "late-provider-thread" }
        }) + "\\n");
        setTimeout(() => process.exit(0), 10);
      });
      rl.on("line", (line) => {
        const msg = JSON.parse(line);
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
        } else if (msg.method === "thread/start") {
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: { providerThreadId: "provider-thread" }
          }) + "\\n");
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0",
            method: "thread/identity",
            params: { threadId: msg.params?.threadId, providerThreadId: "provider-thread" }
          }) + "\\n");
        }
      });`,
    );

    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: (event) => {
        events.push(event);
      },
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => createFakeAdapter(shutdownEventScript),
    });

    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await waitForRuntimeState({
      label: "initial provider identity event",
      predicate: () =>
        events.some(
          (event) =>
            event.type === "thread/identity" &&
            event.providerThreadId === "provider-thread",
        ),
    });
    events.splice(0, events.length);

    await runtime.shutdown();
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(events).toEqual([]);
  });

  // ---- Fail-fast behavior ----

  it("fails fast when provider binary does not exist", async () => {
    const badAdapter: ProviderAdapter = {
      ...createFakeAdapter(scriptPath),
      process: { command: "nonexistent-binary-that-does-not-exist", args: [] },
    };

    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: () => {},
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => badAdapter,
    });

    await expect(
      runtime.ensureProvider({ providerId: "fake" }),
    ).rejects.toThrow(/failed to start|exited during startup/i);
    await runtime.shutdown();
  });

  it("fails fast when provider crashes during initialize", async () => {
    const crashOnInitScript = join(tmpDir, "crash-on-init.cjs");
    writeFileSync(
      crashOnInitScript,
      `process.exit(1);`, // exits immediately, never responds to init
    );

    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: () => {},
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => createFakeAdapter(crashOnInitScript),
    });

    await expect(
      runtime.ensureProvider({ providerId: "fake" }),
    ).rejects.toThrow(/exited/i);
    await runtime.shutdown();
  });

  it("removes the cached provider and retries when startup skill configuration fails", async () => {
    const attemptsPath = join(tmpDir, "startup-config-attempts.txt");
    const logPath = join(tmpDir, "startup-config-log.txt");
    const startupConfigScript = join(tmpDir, "startup-config-failure.cjs");
    writeFileSync(
      startupConfigScript,
      `const fs = require("fs");
      const readline = require("readline");
      const attemptsPath = process.argv[2];
      const logPath = process.argv[3];
      const previousAttempts = fs.existsSync(attemptsPath)
        ? Number(fs.readFileSync(attemptsPath, "utf8"))
        : 0;
      const attempt = previousAttempts + 1;
      fs.writeFileSync(attemptsPath, String(attempt));
      fs.appendFileSync(logPath, "spawn:" + attempt + "\\n");
      setInterval(() => {}, 1000);
      const rl = readline.createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        const msg = JSON.parse(line);
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
          return;
        }
        if (msg.method === "skills/configure") {
          fs.appendFileSync(logPath, "configure:" + attempt + "\\n");
          if (attempt === 1) {
            process.stdout.write(JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              error: { code: -32000, message: "configure failed" }
            }) + "\\n");
            return;
          }
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
          return;
        }
        if (msg.method === "thread/start") {
          const threadId = msg.params?.threadId ?? "";
          const providerThreadId = "provider-thread-" + attempt;
          fs.appendFileSync(logPath, "thread-start:" + attempt + ":" + threadId + "\\n");
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: { providerThreadId }
          }) + "\\n");
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0",
            method: "thread/identity",
            params: { threadId, providerThreadId }
          }) + "\\n");
        }
      });`,
    );
    const baseAdapter = createFakeAdapter(scriptPath);
    const adapter: ProviderAdapter = {
      ...baseAdapter,
      process: {
        command: "node",
        args: [startupConfigScript, attemptsPath, logPath],
      },
    };
    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      skillRoots: [
        {
          id: "bb-cli",
          providerId: "codex",
          skillDirectoryRootPath: join(tmpDir, "skill-root"),
        },
      ],
      onEvent: () => {},
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => adapter,
    });

    try {
      await expect(
        runtime.startThread({
          environmentId: "env-1",
          threadId: "t1",
          projectId: "p1",
          providerId: "codex",
          options: fullRuntimeOptions,
        }),
      ).rejects.toThrow("configure failed");
      expect(runtime.listRunningProviders()).not.toContain("codex");

      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t2",
        projectId: "p1",
        providerId: "codex",
        options: fullRuntimeOptions,
      });

      expect(runtime.listRunningProviders()).toContain("codex");
      expect(readFileSync(logPath, "utf8").trim().split("\n")).toEqual([
        "spawn:1",
        "configure:1",
        "spawn:2",
        "configure:2",
        "thread-start:2:t2",
      ]);
    } finally {
      await runtime.shutdown();
    }
  });

  it("waits for startup skill configuration before starting a codex thread", async () => {
    const logPath = join(tmpDir, "delayed-startup-log.txt");
    const delayedStartupScript = join(tmpDir, "delayed-startup.cjs");
    writeFileSync(
      delayedStartupScript,
      `const fs = require("fs");
      const readline = require("readline");
      const logPath = process.argv[2];
      let skillsConfigured = false;
      function log(line) {
        fs.appendFileSync(logPath, line + "\\n");
      }
      function send(id, result) {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
      }
      const rl = readline.createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        const msg = JSON.parse(line);
        if (msg.method === "initialize") {
          log("initialize");
          setTimeout(() => send(msg.id, {}), 50);
          return;
        }
        if (msg.method === "skills/configure") {
          skillsConfigured = true;
          log("configure");
          send(msg.id, {});
          return;
        }
        if (msg.method === "thread/start") {
          const threadId = msg.params?.threadId ?? "";
          const providerThreadId = "provider-thread";
          log("thread-start:" + threadId + ":configured=" + String(skillsConfigured));
          send(msg.id, { providerThreadId });
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0",
            method: "thread/identity",
            params: { threadId, providerThreadId }
          }) + "\\n");
        }
      });`,
    );
    const baseAdapter = createFakeAdapter(scriptPath);
    const adapter: ProviderAdapter = {
      ...baseAdapter,
      process: {
        command: "node",
        args: [delayedStartupScript, logPath],
      },
    };
    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      skillRoots: [
        {
          id: "bb-cli",
          providerId: "codex",
          skillDirectoryRootPath: join(tmpDir, "skill-root"),
        },
      ],
      onEvent: () => {},
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => adapter,
    });

    try {
      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "codex",
        options: fullRuntimeOptions,
      });

      expect(readLogLines(logPath)).toEqual([
        "initialize",
        "configure",
        "thread-start:t1:configured=true",
      ]);
    } finally {
      await runtime.shutdown();
    }
  });

  it("fails fast on runTurn after provider has crashed", async () => {
    const crashAfterInitScript = join(tmpDir, "crash-after-init.cjs");
    writeFileSync(
      crashAfterInitScript,
      `const rl = require("readline").createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        const msg = JSON.parse(line);
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
          // Start thread succeeds
        } else if (msg.method === "thread/start") {
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0", id: msg.id,
            result: { providerThreadId: "prov-crash" }
          }) + "\\n");
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0", method: "thread/identity",
            params: { threadId: msg.params?.threadId, providerThreadId: "prov-crash" }
          }) + "\\n");
          // Then crash
          setTimeout(() => process.exit(99), 50);
        }
      });`,
    );

    const exitInfo = vi.fn();
    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: () => {},
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      onProcessExit: exitInfo,
      adapterFactory: () => createFakeAdapter(crashAfterInitScript),
    });

    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await waitForRuntimeState({
      label: "provider process exit callback",
      predicate: () => exitInfo.mock.calls.length === 1,
    });

    await expect(
      runtime.runTurn({
        clientRequestId: "creq_222222224x",
        threadId: "t1",
        input: [promptTextInput({ text: "hi" })],
        options: fullRuntimeOptions,
      }),
    ).rejects.toThrow(/exited|not running|no provider associated/i);
    await runtime.shutdown();
  });

  it("rejects pending sendRequest when provider dies mid-turn", async () => {
    const crashDuringTurnScript = join(tmpDir, "crash-during-turn.cjs");
    writeFileSync(
      crashDuringTurnScript,
      `const rl = require("readline").createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        const msg = JSON.parse(line);
        if (msg.method === "initialize") {
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
        } else if (msg.method === "thread/start") {
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0", id: msg.id,
            result: { providerThreadId: "prov-mid" }
          }) + "\\n");
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0", method: "thread/identity",
            params: { threadId: msg.params?.threadId, providerThreadId: "prov-mid" }
          }) + "\\n");
        } else if (msg.method === "turn/start") {
          // Don't respond — just crash
          setTimeout(() => process.exit(77), 50);
        }
      });`,
    );

    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: () => {},
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => createFakeAdapter(crashDuringTurnScript),
    });

    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });

    // runTurn sends the request but the provider crashes without responding
    await expect(
      runtime.runTurn({
        clientRequestId: "creq_222222224y",
        threadId: "t1",
        input: [promptTextInput({ text: "hi" })],
        options: fullRuntimeOptions,
      }),
    ).rejects.toThrow(/exited unexpectedly/i);
    await runtime.shutdown();
  });

  it("concurrent ensureProvider calls do not spawn duplicate processes", async () => {
    let spawnCount = 0;
    const baseAdapter = createFakeAdapter(scriptPath);
    const countingAdapter: ProviderAdapter = {
      ...baseAdapter,
      get process() {
        spawnCount++;
        return baseAdapter.process;
      },
    };

    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: () => {},
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => countingAdapter,
    });

    // Call ensureProvider concurrently
    await Promise.all([
      runtime.ensureProvider({ providerId: "fake" }),
      runtime.ensureProvider({ providerId: "fake" }),
      runtime.ensureProvider({ providerId: "fake" }),
    ]);

    // Duplicate starts would read the process config more than once.
    expect(spawnCount).toBe(1);
    await runtime.shutdown();
  });

  // ---- Multi-thread ----
});
