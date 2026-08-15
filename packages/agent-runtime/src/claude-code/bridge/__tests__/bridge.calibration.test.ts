import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { PromptInput, ThreadEvent } from "@bb/domain";
import { DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG } from "@bb/domain";

/**
 * Claude Code dual-path calibration.
 *
 * One scripted Claude session — start, a turn carrying a delta-first assistant
 * message, a tool_use with its tool_result and a thinking block, a mid-turn
 * steer, a second turn, a resume, a post-resume turn, then a stop — is
 * replayed twice through the same bridge module: once in the legacy dialect
 * (whose raw `sdk/message` notifications are fed to the legacy adapter,
 * exactly as the runtime does today) and once in the canonical dialect (whose
 * `thread/event` notifications are already ThreadEvents). One scripted SDK
 * query drives both legs, so the provider output is byte-identical and any
 * diff is a translation or protocol difference rather than fixture drift.
 *
 * The diff must stay empty apart from the documented list at the bottom. That
 * list is the deliberate canonical-vs-legacy delta; changing it is a decision,
 * not an accident.
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

import { createClaudeCodeProviderAdapter } from "../../adapter.js";
import { handleLine } from "../bridge.js";
import { createBridgeJsonRpcTestHarness } from "../../../test/bridge-json-rpc-test-helpers.js";
import {
  describeCalibrationEvents,
  diffCalibrationStreams,
  normalizeCalibrationEvents,
} from "../../../test/calibration-diff.js";

const THREAD_ID = "thr_calibration_1";
const TOOL_USE_ID = "toolu_01AbCdEfGhIjKlMnOpQrStUv";

const FIRST_PROMPT_TEXT = "check the tree";
const STEER_PROMPT_TEXT = "also check git log";
const SECOND_PROMPT_TEXT = "now summarize";
const RESUMED_PROMPT_TEXT = "and once more after the resume";

/** Freeform provider fixture; the bridge translator narrows it by schema. */
function asSdkMessage(message: Record<string, unknown>): SDKMessage {
  return message as unknown as SDKMessage;
}

interface ScriptedClaudeQueryCall {
  prompt: AsyncIterable<SDKUserMessage>;
  options: { resume?: string; sessionId?: string };
}

function textDelta(sessionId: string, text: string): SDKMessage {
  return asSdkMessage({
    type: "stream_event",
    session_id: sessionId,
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    },
  });
}

function assistantText(
  sessionId: string,
  messageId: string,
  text: string,
): SDKMessage {
  return asSdkMessage({
    type: "assistant",
    session_id: sessionId,
    uuid: `calibration-checkpoint-${messageId}`,
    message: {
      id: messageId,
      role: "assistant",
      content: [{ type: "text", text }],
      usage: { input_tokens: 12, output_tokens: 5 },
    },
  });
}

function successResult(sessionId: string): SDKMessage {
  return asSdkMessage({
    type: "result",
    subtype: "success",
    session_id: sessionId,
    is_error: false,
    usage: { input_tokens: 12, output_tokens: 5 },
    modelUsage: { "claude-sonnet-5": { contextWindow: 200_000 } },
  });
}

/**
 * The scripted query. Every prompt the bridge pushes is answered by name, so
 * the script is a pure function of the prompt text and both legs see the same
 * provider output in the same order. The steer lands inside turn 1 — it is
 * the message that finally closes it.
 */
function createScriptedClaudeQuery(call: ScriptedClaudeQueryCall) {
  const sessionId =
    call.options.resume ?? call.options.sessionId ?? "calibration-session";
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
      const text = String(userMessage.message.content);
      if (text === FIRST_PROMPT_TEXT) {
        // Delta-first: the canonical grammar must synthesize item/started.
        push(textDelta(sessionId, "checking the tree"));
        push(assistantText(sessionId, "msg_1", "checking the tree"));
        push(
          asSdkMessage({
            type: "assistant",
            session_id: sessionId,
            uuid: "calibration-checkpoint-tool",
            message: {
              id: "msg_tool_1",
              role: "assistant",
              content: [
                {
                  type: "tool_use",
                  id: TOOL_USE_ID,
                  name: "Bash",
                  input: { command: "git status --short" },
                },
              ],
              usage: { input_tokens: 12, output_tokens: 5 },
            },
          }),
        );
        push(
          asSdkMessage({
            type: "user",
            session_id: sessionId,
            uuid: "calibration-tool-result",
            parent_tool_use_id: null,
            message: {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: TOOL_USE_ID,
                  tool_name: "Bash",
                  content: " M src/app.ts\n",
                },
              ],
            },
          }),
        );
        push(
          asSdkMessage({
            type: "stream_event",
            session_id: sessionId,
            event: {
              type: "content_block_delta",
              index: 1,
              delta: { type: "thinking_delta", thinking: "The tree is dirty." },
            },
          }),
        );
        push(
          asSdkMessage({
            type: "assistant",
            session_id: sessionId,
            uuid: "calibration-checkpoint-thinking",
            message: {
              id: "msg_thinking_1",
              role: "assistant",
              content: [{ type: "thinking", thinking: "The tree is dirty." }],
              usage: { input_tokens: 12, output_tokens: 5 },
            },
          }),
        );
        continue;
      }
      if (text === STEER_PROMPT_TEXT) {
        // The steer is accepted into the running turn, which then settles.
        push(assistantText(sessionId, "msg_2", "git log looks fine"));
        push(successResult(sessionId));
        continue;
      }
      push(textDelta(sessionId, `answered: ${text}`));
      push(assistantText(sessionId, `msg_for_${text}`, `answered: ${text}`));
      push(successResult(sessionId));
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

const CANONICAL_OPTIONS = {
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
} as const;

/** The legacy dialect's field bag, matching what the runtime sends today. */
const LEGACY_SESSION_FIELDS = {
  workflowsEnabled: false,
  claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
  baseInstructions: "test",
  instructionMode: "append",
  permissionEscalation: "ask",
  permissionMode: "default",
  approvedPlanPermissionMode: "default",
  permissionScope: "workspace",
} as const;

/** The legacy runtime's execution context for the steer acknowledgement. */
const LEGACY_EXECUTION_CONTEXT = {
  claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
  workflowsEnabled: false,
} as const;

function promptInput(text: string): PromptInput[] {
  return [{ type: "text", text, mentions: [] }];
}

async function replay(args: {
  dialect: "legacy" | "canonical";
  workspaceDir: string;
}): Promise<ThreadEvent[]> {
  queryMock.mockImplementation((call: ScriptedClaudeQueryCall) =>
    createScriptedClaudeQuery(call),
  );
  const bridge = createBridgeJsonRpcTestHarness(handleLine);
  const canonical = args.dialect === "canonical";
  const adapter = canonical ? null : createClaudeCodeProviderAdapter();
  const events: ThreadEvent[] = [];
  let drained = 0;
  let providerThreadId = "calibration-session";

  const collect = (): void => {
    for (const message of bridge.messages.slice(drained)) {
      if (canonical) {
        if (message.method === "thread/event") {
          const params = message.params;
          if (
            params !== null &&
            typeof params === "object" &&
            "event" in params
          ) {
            events.push(params.event as ThreadEvent);
          }
        }
      } else if (message.method !== undefined && message.id === undefined) {
        events.push(
          ...(adapter?.translateEvent(
            { jsonrpc: "2.0", method: message.method, params: message.params },
            { threadId: THREAD_ID },
          ) ?? []),
        );
      }
    }
    drained = bridge.messages.length;
  };

  const ackSteer = (expectedTurnId: string): void => {
    if (canonical) {
      return;
    }
    // The runtime, not the legacy bridge, acks a steer.
    events.push(
      ...(adapter?.translateAcceptedCommand?.({
        command: {
          type: "turn/steer",
          threadId: THREAD_ID,
          providerThreadId,
          expectedTurnId,
          clientRequestId: "creq_23456789ac",
          input: promptInput(STEER_PROMPT_TEXT),
          options: LEGACY_EXECUTION_CONTEXT,
        },
      }) ?? []),
    );
  };

  try {
    bridge.sendRequest(
      1,
      "thread/start",
      canonical
        ? {
            threadId: THREAD_ID,
            cwd: args.workspaceDir,
            options: CANONICAL_OPTIONS,
            instructionMode: "append",
          }
        : {
            ...LEGACY_SESSION_FIELDS,
            cwd: args.workspaceDir,
            threadId: THREAD_ID,
          },
    );
    const startResponse = await bridge.waitForResponse(1);
    const startResult = startResponse.result;
    if (
      startResult !== null &&
      typeof startResult === "object" &&
      "providerThreadId" in startResult &&
      typeof startResult.providerThreadId === "string"
    ) {
      providerThreadId = startResult.providerThreadId;
    }
    collect();

    bridge.sendRequest(
      2,
      "turn/start",
      canonical
        ? {
            threadId: THREAD_ID,
            providerThreadId,
            input: promptInput(FIRST_PROMPT_TEXT),
            clientRequestId: "creq_23456789ab",
            options: CANONICAL_OPTIONS,
          }
        : {
            permissionEscalation: "ask",
            threadId: THREAD_ID,
            providerThreadId: null,
            input: promptInput(FIRST_PROMPT_TEXT),
          },
    );
    await bridge.waitForResponse(2);
    await bridge.flushWork();
    collect();

    const expectedTurnId = lastTurnId(events) ?? "turn-1";
    bridge.sendRequest(
      3,
      "turn/steer",
      canonical
        ? {
            threadId: THREAD_ID,
            providerThreadId,
            expectedTurnId,
            input: promptInput(STEER_PROMPT_TEXT),
            clientRequestId: "creq_23456789ac",
            options: CANONICAL_OPTIONS,
          }
        : {
            permissionEscalation: "ask",
            threadId: THREAD_ID,
            providerThreadId: null,
            expectedTurnId,
            input: promptInput(STEER_PROMPT_TEXT),
          },
    );
    await bridge.waitForResponse(3);
    await bridge.flushWork();
    collect();
    ackSteer(expectedTurnId);
    await settle(bridge, collect);

    bridge.sendRequest(
      4,
      "turn/start",
      canonical
        ? {
            threadId: THREAD_ID,
            providerThreadId,
            input: promptInput(SECOND_PROMPT_TEXT),
            clientRequestId: "creq_23456789ad",
            options: CANONICAL_OPTIONS,
          }
        : {
            permissionEscalation: "ask",
            threadId: THREAD_ID,
            providerThreadId: null,
            input: promptInput(SECOND_PROMPT_TEXT),
          },
    );
    await bridge.waitForResponse(4);
    await settle(bridge, collect);

    // Resume leg: a canonical resume mints a fresh translator id prefix (the
    // #1224 cross-resume collision fix), which the id interner absorbs. The
    // post-resume turn must still translate identically.
    bridge.sendRequest(
      5,
      "thread/resume",
      canonical
        ? {
            threadId: THREAD_ID,
            cwd: args.workspaceDir,
            providerThreadId,
            options: CANONICAL_OPTIONS,
            instructionMode: "append",
          }
        : {
            ...LEGACY_SESSION_FIELDS,
            cwd: args.workspaceDir,
            providerThreadId,
            threadId: THREAD_ID,
          },
    );
    await bridge.waitForResponse(5);
    collect();

    bridge.sendRequest(
      6,
      "turn/start",
      canonical
        ? {
            threadId: THREAD_ID,
            providerThreadId,
            input: promptInput(RESUMED_PROMPT_TEXT),
            clientRequestId: "creq_23456789ae",
            options: CANONICAL_OPTIONS,
          }
        : {
            permissionEscalation: "ask",
            threadId: THREAD_ID,
            providerThreadId: null,
            input: promptInput(RESUMED_PROMPT_TEXT),
          },
    );
    await bridge.waitForResponse(6);
    await settle(bridge, collect);

    bridge.sendRequest(
      7,
      "thread/stop",
      canonical
        ? {
            threadId: THREAD_ID,
            providerThreadId,
            intent: "release",
            activeTurnId: null,
          }
        : { threadId: THREAD_ID },
    );
    await bridge.waitForResponse(7);
    collect();
  } finally {
    bridge.restore();
  }

  return events;
}

/** Drain a few macrotasks so the SDK loop's pushes reach the bridge. */
async function settle(
  bridge: { flushWork(): Promise<void> },
  collect: () => void,
): Promise<void> {
  for (let tick = 0; tick < 12; tick += 1) {
    await bridge.flushWork();
    collect();
  }
}

function lastTurnId(events: readonly ThreadEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "turn/started" && event.scope.kind === "turn") {
      return event.scope.turnId;
    }
  }
  return undefined;
}

let workspaceDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-claude-calibration-ws-"));
});

afterEach(() => {
  rmSync(workspaceDir, { recursive: true, force: true });
});

/**
 * `turn/input/accepted` is emitted by a different actor on each path — the
 * runtime on the legacy path, the bridge itself on the canonical one — so
 * where it interleaves with provider output is not a protocol property these
 * two legs can be compared on. Split it out and compare it as a set.
 */
function partitionAcks(events: readonly ThreadEvent[]): {
  stream: ThreadEvent[];
  acks: string[];
} {
  const stream: ThreadEvent[] = [];
  const acks: string[] = [];
  for (const event of events) {
    if (event.type === "turn/input/accepted") {
      acks.push(event.clientRequestId);
      continue;
    }
    stream.push(event);
  }
  return { stream, acks };
}

it("replays one scripted claude session identically on both paths", async () => {
  const legacy = partitionAcks(await replay({ dialect: "legacy", workspaceDir }));
  const canonical = partitionAcks(
    await replay({ dialect: "canonical", workspaceDir }),
  );

  // A calibration is worthless if either leg went quiet.
  expect(legacy.stream.length).toBeGreaterThan(10);
  expect(canonical.stream.length).toBeGreaterThan(10);

  const diff = diffCalibrationStreams(
    normalizeCalibrationEvents(legacy.stream),
    normalizeCalibrationEvents(canonical.stream),
  );

  // The one legacy extra: the legacy bridge announces the provider thread as a
  // notification, which the adapter turns into a thread/identity event. The
  // canonical protocol returns that identity in the thread/start *response*
  // instead, so it is not a stream event at all.
  expect(describeCalibrationEvents(diff.onlyInLegacy)).toEqual([
    "thread/identity",
  ]);

  // The canonical extras: claude streams assistant text and thinking
  // delta-first, and the canonical grammar requires every item to open with
  // item/started (`synthesizeItemStarted`), which the legacy shape omits. One
  // per delta-first item across the four turns — everything else, including
  // the tool_use/tool_result pair, the finalized reasoning content, token
  // usage and every turn settlement, matches byte for byte.
  expect(describeCalibrationEvents(diff.onlyInBridge)).toEqual([
    "item/started:agentMessage",
    "item/started:reasoning",
    "item/started:agentMessage",
    "item/started:agentMessage",
  ]);

  // Acknowledgements: the canonical bridge acks every accepted input, the
  // legacy path only the steer (the runtime never acked a claude turn/start).
  // Closing that hole is exactly what protocol grammar rule 2 requires.
  expect(legacy.acks).toEqual(["creq_23456789ac"]);
  expect(canonical.acks).toEqual([
    "creq_23456789ab",
    "creq_23456789ac",
    "creq_23456789ad",
    "creq_23456789ae",
  ]);
}, 60_000);
