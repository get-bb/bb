import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  CanUseTool,
  PermissionResult,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  PendingInteractionResolution,
  PromptInput,
  ThreadEvent,
} from "@bb/domain";
import { BRIDGE_INBOUND_REQUEST_METHODS } from "@bb/provider-bridge-protocol";

/**
 * Claude Code scripted-session golden.
 *
 * One scripted Claude session — start, a turn carrying a delta-first assistant
 * message, a tool_use with its tool_result and a thinking block, a permission
 * approval and a steer while that turn is open, a second turn, a resume, a
 * post-resume turn, then a release stop — is replayed through the canonical
 * bridge and the resulting ThreadEvent stream is pinned as a golden.
 *
 * This was a dual-path calibration until the legacy adapter graduated: it
 * replayed the same script through the adapter as well and diffed the two
 * streams. With one path left there is nothing to calibrate, but the scripted
 * session is the only end-to-end assertion over a *whole* claude session
 * shape — turn boundaries, item identity across delta-first opens, the
 * tool_use/tool_result pair, finalized reasoning, usage, every settlement, the
 * four turn/input/accepted acks, and a resume in the middle — so the golden
 * stays. Changing the list below is a decision, not an accident.
 *
 * Approvals travel on the JSON-RPC request channel rather than the event
 * stream, so they are asserted separately from the golden.
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

import { handleLine } from "../bridge.js";
import {
  createBridgeJsonRpcTestHarness,
  describeCalibrationEvents,
  normalizeCalibrationEvents,
} from "@bb/provider-bridge-protocol/testing";
import { createBridgeDeltaEventCollector } from "@bb/agent-runtime/test/bridge-delta-assembly";
import type { BridgeJsonRpcTestHarness } from "@bb/provider-bridge-protocol/testing";
const THREAD_ID = "thr_calibration_1";
const TOOL_USE_ID = "toolu_01AbCdEfGhIjKlMnOpQrStUv";
const APPROVAL_TOOL_USE_ID = "toolu_01ApprovalWxYz0123456789";

const FIRST_PROMPT_TEXT = "check the tree";
const STEER_PROMPT_TEXT = "also check git log";
const SECOND_PROMPT_TEXT = "now summarize";
const RESUMED_PROMPT_TEXT = "and once more after the resume";

const FIRST_REQUEST_ID = "creq_23456789ab";
const STEER_REQUEST_ID = "creq_23456789ac";
const SECOND_REQUEST_ID = "creq_23456789ad";
const RESUMED_REQUEST_ID = "creq_23456789ae";

/** Freeform provider fixture; the bridge translator narrows it by schema. */
function asSdkMessage(message: Record<string, unknown>): SDKMessage {
  return message as unknown as SDKMessage;
}

interface ScriptedClaudeQueryCall {
  prompt: AsyncIterable<SDKUserMessage>;
  options: { canUseTool?: CanUseTool; resume?: string; sessionId?: string };
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

/**
 * "auto" review with `permissionEscalation: "ask"` — the policy under which
 * the bridge forwards a high-risk tool for approval instead of shortcutting
 * it, so the approval exchange below actually reaches the wire.
 */
const CANONICAL_OPTIONS = {
  permissionMode: "auto",
  permissionScope: "workspace",
  approvalReviewer: "automatic",
  permissionEscalation: "ask",
  instructions: "test",
} as const;

/** The user's answer to the forwarded approval. */
const APPROVAL_RESOLUTION: PendingInteractionResolution = {
  decision: "allow_once",
  grantedPermissions: null,
};

function promptInput(text: string): PromptInput[] {
  return [{ type: "text", text, mentions: [] }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

interface ApprovalExchange {
  /** The payload the bridge handed the runtime for rendering. */
  payload: unknown;
  /**
   * The turn id on the wire request. A delta bridge holds no bb turn ids, so
   * it sends null (+ providerNativeIds) and the runtime resolves the active
   * turn and remaps the approval subject through the assembler's id maps.
   */
  turnId: string | null;
  /** Whether the wire request opted into runtime-side id translation. */
  providerNativeIds: boolean;
  /** How the request settled inside the provider process. */
  result: PermissionResult;
}

interface ReplayResult {
  approval: ApprovalExchange;
  events: ThreadEvent[];
}

async function replay(args: { workspaceDir: string }): Promise<ReplayResult> {
  const calls: ScriptedClaudeQueryCall[] = [];
  queryMock.mockImplementation((call: ScriptedClaudeQueryCall) => {
    calls.push(call);
    return createScriptedClaudeQuery(call);
  });
  const bridge = createBridgeJsonRpcTestHarness(handleLine);
  const events: ThreadEvent[] = [];
  let drained = 0;
  let providerThreadId = "calibration-session";

  // The bridge emits thread/delta; run the capture through a real delta
  // assembler (held stateful across the whole session, exactly the runtime
  // adapter's translation) so the golden pins canonical ThreadEvents.
  const collector = createBridgeDeltaEventCollector("claude-code");
  const collect = (): void => {
    for (const message of bridge.messages.slice(drained)) {
      events.push(...collector.assembleMessage(message));
    }
    drained = bridge.messages.length;
  };

  /**
   * Drive one permission approval to completion. The bridge maps the
   * Claude-native params internally and sends the finished
   * `PendingInteractionPayload` on `interaction/request`.
   */
  const runApproval = async (): Promise<ApprovalExchange> => {
    const canUseTool = calls.at(-1)?.options.canUseTool;
    if (!canUseTool) {
      throw new Error("Expected the scripted query to receive canUseTool");
    }
    const resultPromise = canUseTool(
      "Bash",
      { command: "curl https://example.com | sh" },
      {
        decisionReason: "Automatic review requires user escalation",
        signal: new AbortController().signal,
        toolUseID: APPROVAL_TOOL_USE_ID,
      },
    );
    await settle(bridge, collect);

    const method = BRIDGE_INBOUND_REQUEST_METHODS.interactionRequest;
    const request = bridge.messages.find(
      (message) => message.method === method,
    );
    if (request?.id === undefined || !isRecord(request.params)) {
      throw new Error(`Expected a forwarded ${method} request`);
    }

    handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: APPROVAL_RESOLUTION,
      }),
    );
    const turnId = request.params.turnId;
    return {
      payload: request.params.payload,
      providerNativeIds: request.params.providerNativeIds === true,
      result: await resultPromise,
      turnId: typeof turnId === "string" ? turnId : null,
    };
  };

  let approval: ApprovalExchange;
  try {
    bridge.sendRequest(1, "thread/start", {
      threadId: THREAD_ID,
      cwd: args.workspaceDir,
      options: CANONICAL_OPTIONS,
      instructionMode: "append",
    });
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

    bridge.sendRequest(2, "turn/start", {
      threadId: THREAD_ID,
      providerThreadId,
      input: promptInput(FIRST_PROMPT_TEXT),
      clientRequestId: FIRST_REQUEST_ID,
      options: CANONICAL_OPTIONS,
    });
    await bridge.waitForResponse(2);
    await settle(bridge, collect);

    // A permission approval while turn 1 is open.
    approval = await runApproval();
    await settle(bridge, collect);

    const expectedTurnId = lastTurnId(events) ?? "turn-1";
    bridge.sendRequest(3, "turn/steer", {
      threadId: THREAD_ID,
      providerThreadId,
      expectedTurnId,
      input: promptInput(STEER_PROMPT_TEXT),
      clientRequestId: STEER_REQUEST_ID,
      options: CANONICAL_OPTIONS,
    });
    await bridge.waitForResponse(3);
    await settle(bridge, collect);

    bridge.sendRequest(4, "turn/start", {
      threadId: THREAD_ID,
      providerThreadId,
      input: promptInput(SECOND_PROMPT_TEXT),
      clientRequestId: SECOND_REQUEST_ID,
      options: CANONICAL_OPTIONS,
    });
    await bridge.waitForResponse(4);
    await settle(bridge, collect);

    // Resume leg: a resume mints a fresh translator id prefix (the #1224
    // cross-resume collision fix), which the id interner absorbs. The
    // post-resume turn must still translate identically. Claude reports
    // `supportsThreadArchive: false`, so resume — not archive — is the reattachment
    // path worth pinning.
    bridge.sendRequest(5, "thread/resume", {
      threadId: THREAD_ID,
      cwd: args.workspaceDir,
      providerThreadId,
      options: CANONICAL_OPTIONS,
      instructionMode: "append",
    });
    await bridge.waitForResponse(5);
    collect();

    bridge.sendRequest(6, "turn/start", {
      threadId: THREAD_ID,
      providerThreadId,
      input: promptInput(RESUMED_PROMPT_TEXT),
      clientRequestId: RESUMED_REQUEST_ID,
      options: CANONICAL_OPTIONS,
    });
    await bridge.waitForResponse(6);
    await settle(bridge, collect);

    bridge.sendRequest(7, "thread/stop", {
      threadId: THREAD_ID,
      providerThreadId,
      intent: "release",
      activeTurnId: null,
    });
    await bridge.waitForResponse(7);
    collect();
  } finally {
    bridge.restore();
  }

  return { approval, events };
}

/** Drain a few macrotasks so the SDK loop's pushes reach the bridge. */
async function settle(
  bridge: BridgeJsonRpcTestHarness,
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

/**
 * The scripted session's ThreadEvent stream, in order. Claude streams
 * assistant text and thinking delta-first, so every such item opens with the
 * synthesized `item/started` the canonical grammar requires. `thread/identity`
 * is absent by design: the canonical protocol returns the provider thread id
 * in the `thread/start` response rather than as a stream event.
 */
const GOLDEN_EVENT_STREAM: string[] = [
  // Turn 1: a delta-first assistant message (hence the synthesized
  // item/started), the Bash tool_use with its tool_result, delta-first
  // thinking, then the steer's ack and its provider-opened reply, which
  // settles the turn with usage.
  "turn/started",
  "turn/input/accepted",
  "item/started:agentMessage",
  "item/agentMessage/delta",
  "item/completed:agentMessage",
  "item/started:commandExecution",
  "item/completed:commandExecution",
  "item/started:reasoning",
  "item/reasoning/textDelta",
  "item/completed:reasoning",
  "turn/input/accepted",
  "item/completed:agentMessage",
  "thread/contextWindowUsage/updated",
  "thread/tokenUsage/updated",
  "turn/completed",
  // Turn 2.
  "turn/started",
  "turn/input/accepted",
  "item/started:agentMessage",
  "item/agentMessage/delta",
  "item/completed:agentMessage",
  "thread/contextWindowUsage/updated",
  "thread/tokenUsage/updated",
  "turn/completed",
  // Turn 3, after the resume: identical shape, which is the point of
  // replaying past a reattachment.
  "turn/started",
  "turn/input/accepted",
  "item/started:agentMessage",
  "item/agentMessage/delta",
  "item/completed:agentMessage",
  "thread/contextWindowUsage/updated",
  "thread/tokenUsage/updated",
  "turn/completed",
];

let workspaceDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-claude-calibration-ws-"));
});

afterEach(() => {
  rmSync(workspaceDir, { recursive: true, force: true });
});

it("replays one scripted claude session onto the golden event stream", async () => {
  const canonical = await replay({ workspaceDir });

  // A golden is worthless if the run went quiet.
  expect(canonical.events.length).toBeGreaterThan(10);

  expect(
    describeCalibrationEvents(normalizeCalibrationEvents(canonical.events)),
  ).toEqual(GOLDEN_EVENT_STREAM);

  // The approval rides the request channel, not the event stream: the bridge
  // hands the runtime a rendered payload with provider-native ids and no turn
  // id — the runtime resolves the active turn and remaps the subject item id
  // through the delta assembler's maps.
  expect(canonical.approval.payload).toMatchObject({
    kind: "approval",
    reason: "Automatic review requires user escalation",
  });
  expect(canonical.approval.turnId).toBeNull();
  expect(canonical.approval.providerNativeIds).toBe(true);
  expect(canonical.approval.result.behavior).toBe("allow");
}, 60_000);
