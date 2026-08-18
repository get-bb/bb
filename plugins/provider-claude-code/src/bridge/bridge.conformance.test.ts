import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  formatConformanceReport,
  runBridgeConformance,
  type BridgeConformanceTransport,
} from "@bb/provider-bridge-protocol/conformance";
import {
  captureBridgeJsonRpcOutput,
  type CapturedBridgeJsonRpcOutput,
} from "@bb/provider-bridge-protocol/testing";
import {
  createBridgeDeltaEventCollector,
  toConformanceMessages,
} from "@bb/agent-runtime/test/bridge-delta-assembly";

/**
 * The claude-code bridge's conformance run: drives the bridge through the
 * canonical Provider Bridge Protocol suite against a scripted in-process
 * Claude Agent SDK query (the exact seam the bridge tests use for hermetic
 * sessions: `vi.mock("@anthropic-ai/claude-agent-sdk")` replacing `query`,
 * while SdkSession, session options, and the whole bridge request surface
 * stay real) and asserts a fully green report.
 *
 * The scripted query answers every prompt with a streamed text delta first
 * (`stream_event`), then the full assistant message, then a success result —
 * so the suite exercises the translator's turn lifecycle, delta-first
 * item/started synthesis, and cross-resume id uniqueness (each canonical
 * session gets a fresh entropy-prefixed translator).
 */

const { forkSessionMock, queryMock } = vi.hoisted(() => ({
  forkSessionMock: vi.fn(),
  queryMock: vi.fn(),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: queryMock,
  forkSession: forkSessionMock,
  createSdkMcpServer: vi.fn(() => ({})),
  tool: vi.fn((_name, _desc, _schema, handler) => handler),
}));

import { handleLine } from "./bridge.js";

const CONFORMANCE_THREAD_ID = "thr_conformance_1";

/** The prompt the kit's turn/settles-without-activity scenario sends. */
const ZERO_WORK_PROMPT_TEXT = "/clear";

/** Freeform provider fixture; the bridge translator narrows it by schema. */
function asSdkMessage(message: Record<string, unknown>): SDKMessage {
  return message as unknown as SDKMessage;
}

interface ScriptedClaudeQueryCall {
  prompt: AsyncIterable<SDKUserMessage>;
  options: { resume?: string; sessionId?: string };
}

let scriptedTurnCounter = 0;

/**
 * A Claude SDK query whose message stream answers every consumed prompt with
 * one full scripted turn: a `stream_event` text delta (delta-first, so the
 * translator must synthesize item/started), the assistant message carrying
 * the final text plus usage, then a success result with usage and model
 * context-window data.
 */
function createScriptedClaudeQuery(call: ScriptedClaudeQueryCall) {
  const sessionId =
    call.options.resume ?? call.options.sessionId ?? "scripted-session";
  const outputQueue: SDKMessage[] = [];
  let closed = false;
  let notify: (() => void) | null = null;
  const wake = (): void => {
    const pending = notify;
    notify = null;
    pending?.();
  };
  const push = (message: SDKMessage): void => {
    outputQueue.push(message);
    wake();
  };

  void (async () => {
    for await (const userMessage of call.prompt) {
      // Claude handles `/clear` locally: a bare success result, no assistant
      // message and no stream event, so nothing opens a bb turn (#1431). The
      // kit's zero-work prompt reproduces exactly that shape.
      if (userMessage.message.content === ZERO_WORK_PROMPT_TEXT) {
        push(
          asSdkMessage({
            type: "result",
            subtype: "success",
            session_id: sessionId,
            is_error: false,
            usage: { input_tokens: 0, output_tokens: 0 },
            modelUsage: {},
          }),
        );
        continue;
      }
      scriptedTurnCounter += 1;
      const text = `hello from turn ${scriptedTurnCounter}`;
      push(
        asSdkMessage({
          type: "stream_event",
          session_id: sessionId,
          event: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text },
          },
        }),
      );
      push(
        asSdkMessage({
          type: "assistant",
          session_id: sessionId,
          uuid: `scripted-checkpoint-${scriptedTurnCounter}`,
          message: {
            id: `msg_${scriptedTurnCounter}`,
            role: "assistant",
            content: [{ type: "text", text }],
            usage: { input_tokens: 12, output_tokens: 5 },
          },
        }),
      );
      push(
        asSdkMessage({
          type: "result",
          subtype: "success",
          session_id: sessionId,
          is_error: false,
          usage: { input_tokens: 12, output_tokens: 5 },
          modelUsage: { "claude-sonnet-5": { contextWindow: 200_000 } },
        }),
      );
    }
    closed = true;
    wake();
  })().catch(() => {
    closed = true;
    wake();
  });

  const iterator: AsyncIterator<SDKMessage> = {
    next: async (): Promise<IteratorResult<SDKMessage>> => {
      for (;;) {
        const message = outputQueue.shift();
        if (message !== undefined) {
          return { value: message, done: false };
        }
        if (closed) {
          return { value: undefined, done: true };
        }
        await new Promise<void>((resolveTick) => {
          notify = resolveTick;
        });
      }
    },
    return: async (): Promise<IteratorResult<SDKMessage>> => {
      closed = true;
      wake();
      return { value: undefined, done: true };
    },
  };

  return {
    applyFlagSettings: vi.fn(async () => {}),
    close: vi.fn(() => {
      closed = true;
      wake();
    }),
    initializationResult: vi.fn(),
    interrupt: vi.fn(async () => {}),
    setModel: vi.fn(async () => {}),
    setPermissionMode: vi.fn(async () => {}),
    [Symbol.asyncIterator]() {
      return iterator;
    },
  };
}

let output: CapturedBridgeJsonRpcOutput;
let workspaceDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  scriptedTurnCounter = 0;
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-claude-conformance-ws-"));
  queryMock.mockImplementation((call: ScriptedClaudeQueryCall) =>
    createScriptedClaudeQuery(call),
  );
  output = captureBridgeJsonRpcOutput();
});

afterEach(async () => {
  // Reap the session the kit leaves behind (its last scenario resumes and
  // runs a turn) so no SDK session state outlives the test.
  const cleanupId = 990_001;
  handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: cleanupId,
      method: "thread/stop",
      params: {
        threadId: CONFORMANCE_THREAD_ID,
        providerThreadId: "conformance-cleanup",
        intent: "release",
        activeTurnId: null,
      },
    }),
  );
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (output.messages.some((message) => message.id === cleanupId)) {
      break;
    }
    await new Promise((resolveTick) => setTimeout(resolveTick, 20));
  }
  output.restore();
  rmSync(workspaceDir, { recursive: true, force: true });
});

it("passes the canonical protocol suite against the scripted claude session", async () => {
  let drained = 0;
  // The conformance kit's grammar checks run over canonical ThreadEvents;
  // the claude bridge emits thread/delta. Run deltas through a real assembler
  // (the runtime adapter's exact translation, held stateful across the whole
  // run) and hand the kit its assembled-event notifications.
  const collector = createBridgeDeltaEventCollector("claude-code");
  const transport: BridgeConformanceTransport = {
    send: (line) => handleLine(line),
    takeMessages: () => {
      const fresh = output.messages.slice(drained);
      drained = output.messages.length;
      return fresh.flatMap((message) =>
        toConformanceMessages(message, collector),
      );
    },
  };

  const report = await runBridgeConformance({
    transport,
    session: {
      cwd: workspaceDir,
      promptInput: [{ type: "text", text: "say hello", mentions: [] }],
      zeroWorkPromptInput: [
        { type: "text", text: ZERO_WORK_PROMPT_TEXT, mentions: [] },
      ],
    },
    timeoutMs: 10_000,
  });

  // Keep the human-readable report visible in test output for diagnosing
  // any regression.
  console.info(
    `claude-code bridge conformance:\n${formatConformanceReport(report)}`,
  );

  const statusById = Object.fromEntries(
    report.results.map((result) => [result.id, result.status]),
  );

  expect(statusById).toMatchObject({
    "rpc/unknown-method": "pass",
    "rpc/invalid-params": "pass",
    "rpc/non-json-ignored": "pass",
    "rpc/response-not-request": "pass",
    "handshake/initialize": "pass",
    "session/start-identity": "pass",
    "turn/lifecycle": "pass",
    "events/schema-valid": "pass",
    "item/opens-before-delta": "pass",
    "stop/release-not-interrupted": "pass",
    "session/resume-id-uniqueness": "pass",
    "turn/settles-without-activity": "pass",
  });

  expect(report.passed).toBe(true);
}, 60_000);
