import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { JsonObject } from "@bb/domain";
import {
  experimental_captureBridgeJsonRpcOutput as captureBridgeJsonRpcOutput,
  experimental_formatConformanceReport as formatConformanceReport,
  experimental_runBridgeConformance as runBridgeConformance,
} from "@get-bb/plugin-sdk/provider-bridge/testing";
import type { CapturedBridgeJsonRpcOutput } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { installClaudeSdkDependencies } from "./claude-sdk-dependencies.js";

const forkSessionMock = vi.fn();
const queryMock = vi.fn();
const restoreClaudeSdkDependencies = installClaudeSdkDependencies({
  query: (params) => queryMock(params),
  forkSession: (sessionId, options) => forkSessionMock(sessionId, options),
});

afterAll(restoreClaudeSdkDependencies);

import { handleLine } from "./bridge.js";

const ZERO_WORK_PROMPT_TEXT = "/clear";

function asSdkMessage(message: JsonObject): SDKMessage {
  // SAFETY: The scripted objects contain the fields that the bridge reads for these test cases.
  return message as SDKMessage;
}

interface ScriptedClaudeQueryCall {
  prompt: AsyncIterable<SDKUserMessage>;
  options: { resume?: string; sessionId?: string };
}

let scriptedTurnCounter = 0;

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
  forkSessionMock.mockImplementation((sessionId: string) =>
    Promise.resolve({ sessionId: `${sessionId}-fork` }),
  );
  output = captureBridgeJsonRpcOutput();
});

afterEach(() => {
  output.restore();
  rmSync(workspaceDir, { recursive: true, force: true });
});

it("passes the canonical protocol suite against the scripted claude session", async () => {
  const report = await runBridgeConformance({
    transport: { send: handleLine, takeMessages: output.takeMessages },
    providerId: "claude-code",
    session: {
      cwd: workspaceDir,
      promptInput: [{ type: "text", text: "say hello", mentions: [] }],
      zeroWorkPromptInput: [
        { type: "text", text: ZERO_WORK_PROMPT_TEXT, mentions: [] },
      ],
    },
    timeoutMs: 10_000,
  });

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
    "skills/configure-declared": "pass",
    "session/start-identity": "pass",
    "turn/lifecycle": "pass",
    "events/schema-valid": "pass",
    "item/opens-before-delta": "pass",
    "stop/release-not-interrupted": "pass",
    "session/resume-identity": "pass",
    "session/resume-id-uniqueness": "pass",
    "session/fork-identity": "pass",
    "turn/settles-without-activity": "pass",
  });

  expect(report.passed).toBe(true);
}, 60_000);
