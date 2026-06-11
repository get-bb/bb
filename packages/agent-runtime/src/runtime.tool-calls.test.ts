import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadEvent, ToolCallResponse } from "@bb/domain";
import type { AgentRuntimeCaptureEntry } from "./capture-types.js";
import { createAgentRuntimeWithAdapters } from "./runtime.js";
import { handleRuntimeProviderRequest } from "./runtime-provider-requests.js";
import {
  parseJsonRpcLine,
  type JsonRpcMessage,
  type ProviderInboundRequest,
} from "./runtime-json-rpc.js";
import { promptTextInput } from "./test/prompt-input.js";
import { fakeProviderScriptPath } from "./test/index.js";
import {
  createFakeAdapter,
  createThreadHintMismatchAdapter,
  fullRuntimeOptions,
  waitForRuntimeState,
  waitForThreadTurnCompleted,
} from "./test/runtime-test-harness.js";

type ChildStdoutChunk = Buffer | string;

function readChildStdoutLine(child: ChildProcess): Promise<string> {
  if (!child.stdout) {
    throw new Error("Expected child stdout to be readable");
  }
  const stdout = child.stdout;
  return new Promise((resolve) => {
    stdout.once("data", (chunk: ChildStdoutChunk) => {
      resolve(String(chunk));
    });
  });
}

describe("createAgentRuntime tool calls", () => {
  let tmpDir: string;
  let scriptPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "bb-runtime-test-"));
    scriptPath = fakeProviderScriptPath;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("routes provider-scoped tool calls through onToolCall and sends response back", async () => {
    const toolCalls: Array<{
      threadId: string;
      providerThreadId: string;
      tool: string;
    }> = [];
    const events: ThreadEvent[] = [];
    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: (event) => events.push(event),
      onToolCall: async (req) => {
        toolCalls.push({
          threadId: req.threadId,
          providerThreadId: req.providerThreadId,
          tool: req.tool,
        });
        return {
          contentItems: [{ type: "inputText", text: "tool result" }],
          success: true,
        };
      },
      adapterFactory: () => createFakeAdapter(scriptPath),
    });

    await runtime.startThread({
      sessionKind: "thread",
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await runtime.runTurn({
      clientRequestId: "creq_222222223z",
      threadId: "t1",
      input: [promptTextInput({ text: "call_tool:my_test_tool" })],
      options: fullRuntimeOptions,
    });
    await waitForRuntimeState({
      events,
      label: "tool call routed and turn completed",
      predicate: () =>
        toolCalls.length === 1 &&
        events.some((event) => event.type === "turn/completed"),
      providerId: "fake",
      runtime,
    });

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toEqual({
      threadId: "t1",
      providerThreadId: "prov-1",
      tool: "my_test_tool",
    });
    await runtime.shutdown();
  });

  it("resolves unresolved provider tool call turn ids from the active turn", async () => {
    const toolCalls: Array<{
      threadId: string;
      providerThreadId: string;
      turnId: string;
      tool: string;
    }> = [];
    const events: ThreadEvent[] = [];
    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: (event) => events.push(event),
      onToolCall: async (req) => {
        toolCalls.push({
          threadId: req.threadId,
          providerThreadId: req.providerThreadId,
          turnId: req.turnId,
          tool: req.tool,
        });
        return {
          contentItems: [{ type: "inputText", text: "tool result" }],
          success: true,
        };
      },
      adapterFactory: () => {
        const adapter = createFakeAdapter(scriptPath);
        return {
          ...adapter,
          decodeToolCallRequest(request) {
            const decoded = adapter.decodeToolCallRequest(request);
            return decoded ? { ...decoded, turnId: null } : null;
          },
        };
      },
    });

    await runtime.startThread({
      sessionKind: "thread",
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await runtime.runTurn({
      clientRequestId: "creq_222222223y",
      threadId: "t1",
      input: [promptTextInput({ text: "call_tool:my_test_tool" })],
      options: fullRuntimeOptions,
    });
    await waitForRuntimeState({
      events,
      label: "tool call with resolved turn id routed and turn completed",
      predicate: () =>
        toolCalls.length === 1 &&
        events.some((event) => event.type === "turn/completed"),
      providerId: "fake",
      runtime,
    });

    expect(toolCalls).toEqual([
      {
        threadId: "t1",
        providerThreadId: "prov-1",
        turnId: "turn-1",
        tool: "my_test_tool",
      },
    ]);
    await runtime.shutdown();
  });

  it("drops unresolved provider tool calls when no active turn is known", async () => {
    const child = spawn(process.execPath, [
      "-e",
      "process.stdin.pipe(process.stdout)",
    ]);
    const adapter = createFakeAdapter(scriptPath);
    const captures: AgentRuntimeCaptureEntry[] = [];
    const toolCallResponse = {
      contentItems: [{ type: "inputText", text: "tool result" }],
      success: true,
    } satisfies ToolCallResponse;
    const onToolCall = vi.fn(async () => toolCallResponse);
    const rawRequest = {
      jsonrpc: "2.0",
      id: 42,
      method: "item/tool/call",
      params: {
        providerThreadId: "prov-1",
        turnId: null,
        callId: "call-1",
        tool: "my_test_tool",
        arguments: {},
      },
    } satisfies JsonRpcMessage;

    try {
      handleRuntimeProviderRequest({
        createCaptureId: () => "cap-1",
        emitCapture: (entry) => captures.push(entry),
        getActiveTurnId: () => undefined,
        getThreadExecutionOptions: () => undefined,
        line: JSON.stringify(rawRequest),
        onInteractiveRequest: async () => ({
          decision: "deny",
        }),
        onToolCall,
        parsedId: rawRequest.id,
        parsedMethod: rawRequest.method,
        providerProcess: {
          adapter,
          child,
          interactiveRequestScope: "scope-1",
        },
        rawRequest,
        resolveThreadId: () => "t1",
      });

      const parsed = parseJsonRpcLine((await readChildStdoutLine(child)).trim());
      if (parsed.kind !== "response") {
        throw new Error(`Expected JSON-RPC response, got ${parsed.kind}`);
      }
      expect(parsed.parsed).toMatchObject({
        jsonrpc: "2.0",
        id: 42,
        error: {
          code: -32000,
          message: expect.stringContaining("without a turn id"),
        },
      });
      expect(onToolCall).not.toHaveBeenCalled();
      expect(
        captures.filter((entry) => entry.kind === "tool-call-request"),
      ).toHaveLength(0);
    } finally {
      child.kill();
    }
  });

  it("rejects malformed adapter tool calls with empty turn ids", async () => {
    const child = spawn(process.execPath, [
      "-e",
      "process.stdin.pipe(process.stdout)",
    ]);
    const baseAdapter = createFakeAdapter(scriptPath);
    const adapter = {
      ...baseAdapter,
      decodeToolCallRequest(request: ProviderInboundRequest) {
        const decoded = baseAdapter.decodeToolCallRequest(request);
        return decoded ? { ...decoded, turnId: "" } : null;
      },
    };
    const captures: AgentRuntimeCaptureEntry[] = [];
    const toolCallResponse = {
      contentItems: [{ type: "inputText", text: "tool result" }],
      success: true,
    } satisfies ToolCallResponse;
    const onToolCall = vi.fn(async () => toolCallResponse);
    const rawRequest = {
      jsonrpc: "2.0",
      id: 43,
      method: "item/tool/call",
      params: {
        providerThreadId: "prov-1",
        turnId: null,
        callId: "call-1",
        tool: "my_test_tool",
        arguments: {},
      },
    } satisfies JsonRpcMessage;

    try {
      handleRuntimeProviderRequest({
        createCaptureId: () => "cap-1",
        emitCapture: (entry) => captures.push(entry),
        getActiveTurnId: () => "turn-1",
        getThreadExecutionOptions: () => undefined,
        line: JSON.stringify(rawRequest),
        onInteractiveRequest: async () => ({
          decision: "deny",
        }),
        onToolCall,
        parsedId: rawRequest.id,
        parsedMethod: rawRequest.method,
        providerProcess: {
          adapter,
          child,
          interactiveRequestScope: "scope-1",
        },
        rawRequest,
        resolveThreadId: () => "t1",
      });

      const parsed = parseJsonRpcLine((await readChildStdoutLine(child)).trim());
      if (parsed.kind !== "response") {
        throw new Error(`Expected JSON-RPC response, got ${parsed.kind}`);
      }
      expect(parsed.parsed).toMatchObject({
        jsonrpc: "2.0",
        id: 43,
        error: {
          code: -32000,
          message: expect.stringContaining("must be a non-empty string"),
        },
      });
      expect(onToolCall).not.toHaveBeenCalled();
      expect(
        captures.filter((entry) => entry.kind === "tool-call-request"),
      ).toHaveLength(0);
    } finally {
      child.kill();
    }
  });

  it("rejects tool calls whose BB thread hint disagrees with the provider-thread mapping", async () => {
    const toolCalls: string[] = [];
    const events: ThreadEvent[] = [];
    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: (event) => events.push(event),
      onToolCall: async (req) => {
        toolCalls.push(req.tool);
        return {
          contentItems: [{ type: "inputText", text: "tool result" }],
          success: true,
        };
      },
      adapterFactory: () => createThreadHintMismatchAdapter(scriptPath),
    });

    await runtime.startThread({
      sessionKind: "thread",
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await runtime.runTurn({
      clientRequestId: "creq_2222222242",
      threadId: "t1",
      input: [promptTextInput({ text: "call_tool:my_test_tool" })],
      options: fullRuntimeOptions,
    });
    await waitForThreadTurnCompleted({
      events,
      providerId: "fake",
      runtime,
      threadId: "t1",
    });

    expect(toolCalls).toEqual([]);
    await runtime.shutdown();
  });

  it("sends JSON-RPC error back when onToolCall throws", async () => {
    const events: ThreadEvent[] = [];
    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: (e) => events.push(e),
      onToolCall: async () => {
        throw new Error("Tool execution failed");
      },
      adapterFactory: () => createFakeAdapter(scriptPath),
    });

    await runtime.startThread({
      sessionKind: "thread",
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    // This should not throw — the error is caught and sent as JSON-RPC error
    await runtime.runTurn({
      clientRequestId: "creq_2222222243",
      threadId: "t1",
      input: [promptTextInput({ text: "call_tool:failing_tool" })],
      options: fullRuntimeOptions,
    });
    await waitForThreadTurnCompleted({
      events,
      providerId: "fake",
      runtime,
      threadId: "t1",
    });
    await runtime.shutdown();
    // The test passes if no unhandled promise rejection occurs
  });

  it("captures correlated raw provider events, translated events, and tool call results", async () => {
    const captures: AgentRuntimeCaptureEntry[] = [];
    const runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: () => {},
      onCapture: (entry) => captures.push(entry),
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "tool result" }],
        success: true,
      }),
      adapterFactory: () => createFakeAdapter(scriptPath),
    });

    await runtime.startThread({
      sessionKind: "thread",
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await runtime.runTurn({
      clientRequestId: "creq_2222222244",
      threadId: "t1",
      input: [promptTextInput({ text: "call_tool:my_test_tool" })],
      options: fullRuntimeOptions,
    });
    await waitForRuntimeState({
      label: "captured tool result and raw turn completion",
      predicate: () =>
        captures.some((entry) => entry.kind === "tool-call-result") &&
        captures.some(
          (entry) =>
            entry.kind === "raw-provider-event" &&
            entry.rawEvent.method === "turn/completed",
        ),
      providerId: "fake",
      runtime,
    });
    await runtime.shutdown();

    const rawEvents = captures.filter(
      (
        entry,
      ): entry is Extract<
        AgentRuntimeCaptureEntry,
        { kind: "raw-provider-event" }
      > => entry.kind === "raw-provider-event",
    );
    const translatedEvents = captures.filter(
      (
        entry,
      ): entry is Extract<
        AgentRuntimeCaptureEntry,
        { kind: "translated-thread-event" }
      > => entry.kind === "translated-thread-event",
    );
    const toolRequests = captures.filter(
      (
        entry,
      ): entry is Extract<
        AgentRuntimeCaptureEntry,
        { kind: "tool-call-request" }
      > => entry.kind === "tool-call-request",
    );
    const toolResults = captures.filter(
      (
        entry,
      ): entry is Extract<
        AgentRuntimeCaptureEntry,
        { kind: "tool-call-result" }
      > => entry.kind === "tool-call-result",
    );

    expect(rawEvents.map((entry) => entry.rawEvent.method)).toEqual(
      expect.arrayContaining([
        "thread/identity",
        "turn/started",
        "item/completed",
        "turn/completed",
      ]),
    );
    expect(translatedEvents.map((entry) => entry.event.type)).toEqual(
      expect.arrayContaining([
        "thread/identity",
        "turn/started",
        "item/completed",
        "turn/completed",
      ]),
    );
    expect(toolRequests).toHaveLength(1);
    expect(toolResults).toHaveLength(1);
    expect(toolRequests[0]?.request).toMatchObject({
      threadId: "t1",
      providerThreadId: "prov-1",
      tool: "my_test_tool",
    });
    expect(toolResults[0]).toMatchObject({
      requestCaptureId: toolRequests[0]?.captureId,
      requestId: toolRequests[0]?.request.requestId,
      success: true,
    });

    const turnStartedCapture = rawEvents.find(
      (entry) => entry.rawEvent.method === "turn/started",
    );
    expect(turnStartedCapture).toBeDefined();
    expect(
      translatedEvents.some(
        (entry) =>
          entry.rawCaptureId === turnStartedCapture?.captureId &&
          entry.event.type === "turn/started",
      ),
    ).toBe(true);
  });

  // ---- Error handling ----
});
