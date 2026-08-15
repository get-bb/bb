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
import { DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG } from "@bb/domain";
import { BRIDGE_INBOUND_REQUEST_METHODS } from "@bb/provider-bridge-protocol";

/**
 * Claude Code dual-path calibration.
 *
 * One scripted Claude session — start, a turn carrying a delta-first assistant
 * message, a tool_use with its tool_result and a thinking block, a permission
 * approval and a steer while that turn is open, a second turn, a resume, a
 * post-resume turn, then a release stop — is replayed twice through the same
 * bridge module: once in the legacy dialect (whose raw `sdk/message`
 * notifications are fed to the legacy adapter, exactly as the runtime does
 * today) and once in the canonical dialect (whose `thread/event` notifications
 * are already ThreadEvents). One scripted SDK query drives both legs, so the
 * provider output is byte-identical and any diff is a translation or protocol
 * difference rather than fixture drift.
 *
 * The legacy leg also models what the *runtime* contributes: every accepted
 * command is fed back through `translateAcceptedCommand` right after its
 * response and before the notifications that follow it, exactly as
 * `emitAcceptedCommandEvents` does in runtime.ts. Leaving that out would
 * manufacture a `turn/input/accepted` divergence the shipped runtime does not
 * have.
 *
 * Approvals travel on the JSON-RPC request channel rather than the event
 * stream, so they are compared separately from the diff.
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
import { CLAUDE_PERMISSION_REQUEST_APPROVAL_METHOD } from "../../interactive-contract.js";
import type { AdapterCommand } from "../../../provider-adapter.js";
import { handleLine } from "../bridge.js";
import {
  createBridgeJsonRpcTestHarness,
  type BridgeJsonRpcTestHarness,
} from "../../../test/bridge-json-rpc-test-helpers.js";
import {
  describeCalibrationEvents,
  diffCalibrationStreams,
  normalizeCalibrationEvents,
} from "../../../test/calibration-diff.js";

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

/**
 * The legacy dialect's field bag for that same policy: the canonical session
 * options map onto exactly these values
 * (`buildClaudeCanonicalSessionParams`), so both legs construct an identical
 * provider session.
 */
const LEGACY_SESSION_FIELDS = {
  workflowsEnabled: false,
  claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
  baseInstructions: "test",
  instructionMode: "append",
  permissionEscalation: "ask",
  permissionMode: "auto",
  approvedPlanPermissionMode: "auto",
  permissionScope: "workspace",
} as const;

/** The legacy runtime's execution context for accepted-command acks. */
const LEGACY_EXECUTION_CONTEXT = {
  claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
  permissionMode: "auto",
  permissionScope: "workspace",
  approvalReviewer: "automatic",
  permissionEscalation: "ask",
  workflowsEnabled: false,
  instructions: "test",
} as const;

/** The user's answer to the forwarded approval, identical on both paths. */
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
  /** The payload the path handed the runtime for rendering. */
  payload: unknown;
  /** The bb turn the path correlated the approval with. */
  turnId: string | null;
  /** How the request settled inside the provider process. */
  result: PermissionResult;
  /** The open bb turn at the moment the approval was forwarded. */
  openTurnId: string | undefined;
}

interface ReplayResult {
  approval: ApprovalExchange;
  events: ThreadEvent[];
}

async function replay(args: {
  dialect: "legacy" | "canonical";
  workspaceDir: string;
}): Promise<ReplayResult> {
  const calls: ScriptedClaudeQueryCall[] = [];
  queryMock.mockImplementation((call: ScriptedClaudeQueryCall) => {
    calls.push(call);
    return createScriptedClaudeQuery(call);
  });
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

  /**
   * `emitAcceptedCommandEvents`: what the runtime emits once a command's
   * response arrives, before draining the notifications that followed it —
   * hence every call site acks *before* collecting. Only the legacy path needs
   * it; the canonical bridge emits these itself.
   */
  const ack = (command: AdapterCommand): void => {
    if (canonical) {
      return;
    }
    events.push(
      ...(adapter?.translateAcceptedCommand({ command, providerThreadId }) ??
        []),
    );
  };

  const ackTurnStart = (clientRequestId: string, text: string): void => {
    ack({
      type: "turn/start",
      threadId: THREAD_ID,
      providerThreadId,
      clientRequestId,
      input: promptInput(text),
      options: LEGACY_EXECUTION_CONTEXT,
    });
  };

  /**
   * Drive one permission approval to completion. The legacy path forwards
   * Claude-native params the runtime decodes host-side through the adapter;
   * the canonical bridge maps them internally and sends the finished
   * `PendingInteractionPayload` on `interaction/request`. Both are answered
   * from the same `PendingInteractionResolution`.
   */
  const runApproval = async (): Promise<ApprovalExchange> => {
    const canUseTool = calls.at(-1)?.options.canUseTool;
    if (!canUseTool) {
      throw new Error("Expected the scripted query to receive canUseTool");
    }
    const openTurnId = lastTurnId(events);
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

    const method = canonical
      ? BRIDGE_INBOUND_REQUEST_METHODS.interactionRequest
      : CLAUDE_PERMISSION_REQUEST_APPROVAL_METHOD;
    const request = bridge.messages.find((message) => message.method === method);
    if (request?.id === undefined || !isRecord(request.params)) {
      throw new Error(`Expected a forwarded ${method} request`);
    }

    if (canonical) {
      handleLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: APPROVAL_RESOLUTION,
        }),
      );
      const turnId = request.params.turnId;
      return {
        openTurnId,
        payload: request.params.payload,
        result: await resultPromise,
        turnId: typeof turnId === "string" ? turnId : null,
      };
    }

    const decoded = adapter?.decodeInteractiveRequest?.({
      id: request.id,
      method,
      params: request.params,
    });
    if (!decoded) {
      throw new Error("Expected the legacy adapter to decode the approval");
    }
    handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: adapter?.buildInteractiveResponse?.({
          request: decoded,
          resolution: APPROVAL_RESOLUTION,
        }),
      }),
    );
    return {
      openTurnId,
      payload: decoded.payload,
      result: await resultPromise,
      turnId: decoded.turnId,
    };
  };

  let approval: ApprovalExchange;
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
    ack({
      type: "thread/start",
      threadId: THREAD_ID,
      cwd: args.workspaceDir,
      instructionMode: "append",
      options: LEGACY_EXECUTION_CONTEXT,
    });
    collect();

    bridge.sendRequest(
      2,
      "turn/start",
      canonical
        ? {
            threadId: THREAD_ID,
            providerThreadId,
            input: promptInput(FIRST_PROMPT_TEXT),
            clientRequestId: FIRST_REQUEST_ID,
            options: CANONICAL_OPTIONS,
          }
        : {
            permissionEscalation: "ask",
            threadId: THREAD_ID,
            providerThreadId,
            input: promptInput(FIRST_PROMPT_TEXT),
          },
    );
    await bridge.waitForResponse(2);
    ackTurnStart(FIRST_REQUEST_ID, FIRST_PROMPT_TEXT);
    await settle(bridge, collect);

    // A permission approval while turn 1 is open.
    approval = await runApproval();
    await settle(bridge, collect);

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
            clientRequestId: STEER_REQUEST_ID,
            options: CANONICAL_OPTIONS,
          }
        : {
            permissionEscalation: "ask",
            threadId: THREAD_ID,
            providerThreadId,
            expectedTurnId,
            input: promptInput(STEER_PROMPT_TEXT),
          },
    );
    await bridge.waitForResponse(3);
    ack({
      type: "turn/steer",
      threadId: THREAD_ID,
      providerThreadId,
      expectedTurnId,
      clientRequestId: STEER_REQUEST_ID,
      input: promptInput(STEER_PROMPT_TEXT),
      options: LEGACY_EXECUTION_CONTEXT,
    });
    await settle(bridge, collect);

    bridge.sendRequest(
      4,
      "turn/start",
      canonical
        ? {
            threadId: THREAD_ID,
            providerThreadId,
            input: promptInput(SECOND_PROMPT_TEXT),
            clientRequestId: SECOND_REQUEST_ID,
            options: CANONICAL_OPTIONS,
          }
        : {
            permissionEscalation: "ask",
            threadId: THREAD_ID,
            providerThreadId,
            input: promptInput(SECOND_PROMPT_TEXT),
          },
    );
    await bridge.waitForResponse(4);
    ackTurnStart(SECOND_REQUEST_ID, SECOND_PROMPT_TEXT);
    await settle(bridge, collect);

    // Resume leg: a canonical resume mints a fresh translator id prefix (the
    // #1224 cross-resume collision fix), which the id interner absorbs. The
    // post-resume turn must still translate identically. Claude reports
    // `supportsArchive: false`, so resume — not archive — is the reattachment
    // path worth calibrating.
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
    ack({
      type: "thread/resume",
      threadId: THREAD_ID,
      cwd: args.workspaceDir,
      providerThreadId,
      instructionMode: "append",
      options: LEGACY_EXECUTION_CONTEXT,
    });
    collect();

    bridge.sendRequest(
      6,
      "turn/start",
      canonical
        ? {
            threadId: THREAD_ID,
            providerThreadId,
            input: promptInput(RESUMED_PROMPT_TEXT),
            clientRequestId: RESUMED_REQUEST_ID,
            options: CANONICAL_OPTIONS,
          }
        : {
            permissionEscalation: "ask",
            threadId: THREAD_ID,
            providerThreadId,
            input: promptInput(RESUMED_PROMPT_TEXT),
          },
    );
    await bridge.waitForResponse(6);
    ackTurnStart(RESUMED_REQUEST_ID, RESUMED_PROMPT_TEXT);
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
    ack({
      type: "thread/stop",
      threadId: THREAD_ID,
      providerThreadId,
      activeTurnId: null,
    });
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

let workspaceDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-claude-calibration-ws-"));
});

afterEach(() => {
  rmSync(workspaceDir, { recursive: true, force: true });
});

it("replays one scripted claude session identically on both paths", async () => {
  const legacy = await replay({ dialect: "legacy", workspaceDir });
  const canonical = await replay({ dialect: "canonical", workspaceDir });

  // A calibration is worthless if either leg went quiet.
  expect(legacy.events.length).toBeGreaterThan(10);
  expect(canonical.events.length).toBeGreaterThan(10);

  const diff = diffCalibrationStreams(
    normalizeCalibrationEvents(legacy.events),
    normalizeCalibrationEvents(canonical.events),
  );

  // The one legacy extra: the legacy bridge announces the provider thread as a
  // notification, which the adapter turns into a thread/identity event. The
  // canonical protocol returns that identity in the thread/start *response*
  // instead (and its own identity notification is not a thread/event), so it
  // is not a stream event at all.
  expect(describeCalibrationEvents(diff.onlyInLegacy)).toEqual([
    "thread/identity",
  ]);

  // The canonical extras, in order, are all the same deliberate addition:
  // claude streams assistant text and thinking delta-first, and the canonical
  // grammar requires every item to open with item/started
  // (`synthesizeItemStarted`), which the legacy shape omits. One per
  // delta-first item across the four turns. Everything else — the
  // tool_use/tool_result pair, finalized reasoning, token and context-window
  // usage, every turn settlement, and all four turn/input/accepted acks with
  // their turn correlation — matches byte for byte, across the resume too.
  expect(describeCalibrationEvents(diff.onlyInBridge)).toEqual([
    "item/started:agentMessage",
    "item/started:reasoning",
    "item/started:agentMessage",
    "item/started:agentMessage",
  ]);

  // The approval rides the request channel, not the event stream: both paths
  // must hand the runtime the same payload and correlate it with the turn that
  // was open when it was raised.
  expect(legacy.approval.payload).toMatchObject({
    kind: "approval",
    reason: "Automatic review requires user escalation",
  });
  expect(canonical.approval.payload).toEqual(legacy.approval.payload);
  expect(legacy.approval.turnId).toBe(legacy.approval.openTurnId);
  expect(canonical.approval.turnId).toBe(canonical.approval.openTurnId);
  expect(legacy.approval.result.behavior).toBe("allow");
  expect(canonical.approval.result.behavior).toBe("allow");
}, 60_000);
