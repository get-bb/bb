import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  PendingInteractionPayload,
  PromptInput,
  ThreadEvent,
} from "@bb/domain";
import { DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG } from "@bb/domain";
import {
  BRIDGE_INBOUND_REQUEST_METHODS,
  BRIDGE_JSON_RPC_ERRORS,
  interactionRequestParamsSchema,
} from "@bb/provider-bridge-protocol";
import { createCodexProviderAdapter } from "../adapter.js";
import type { CodexEvent } from "../adapter.js";
import type { Turn } from "../generated/codex-app-server/schema/v2/Turn.js";
import { handleLine } from "./bridge.js";
import { createBridgeJsonRpcTestHarness } from "../../test/bridge-json-rpc-test-helpers.js";
import type { BridgeJsonRpcTestHarness } from "../../test/bridge-json-rpc-test-helpers.js";
import {
  describeCalibrationEvents,
  diffCalibrationStreams,
  normalizeCalibrationEvents,
} from "../../test/calibration-diff.js";

/**
 * Codex dual-path calibration.
 *
 * Codex is structurally unlike pi and claude: it has no legacy bridge process.
 * The legacy runtime speaks to `codex app-server` directly and feeds its
 * notifications to `createCodexProviderAdapter().translateEvent(...)`, while
 * the canonical bridge owns an app-server child of its own. The two legs
 * therefore cannot share one live provider process; what they share is the
 * SCRIPT — one ordered list of app-server messages, replayed twice:
 *
 *  - legacy: straight into the adapter, interleaving `prepareTurnStart` per
 *    turn and `translateAcceptedCommand` for the steer, exactly as the runtime
 *    drives it around the child's stdout today;
 *  - canonical: handed to `fake-codex-app-server.mjs` as an argv script file,
 *    so the bridge really spawns a child, really reads those same messages off
 *    a pipe, and really translates them.
 *
 * The session: thread start, a first turn carrying a delta-first agent
 * message, a command execution (with a mid-turn approval request and a
 * streamed output delta) and a reasoning item, a steer, a short second turn
 * whose agent message is NOT delta-first, then a release stop.
 *
 * Anything the diff reports is a translation or protocol difference, not
 * fixture drift, and the divergence lists below are the deliberate
 * canonical-vs-legacy delta: shrinking or growing them is a decision, not an
 * accident. Approvals travel on their own channel (bridge → runtime requests),
 * so they are compared separately from the event stream.
 */

const THREAD_ID = "thr_codex_calibration_1";
/**
 * The codex thread id the legacy leg sees. The canonical leg's app-server
 * mints its own and rewrites the script to it; normalization blanks
 * `threadId`/`providerThreadId`, so both legs stay comparable.
 */
const SCRIPT_THREAD_ID = "codex-script-thread";
const FIRST_TURN_ID = "turn-cal-1";
const SECOND_TURN_ID = "turn-cal-2";
const COMMAND_ITEM_ID = "cmd-cal-1";

const ARCHIVED_PROVIDER_THREAD_ID = "archived-calibration-1";
/** Must match what fake-codex-app-server.mjs emits for `archived-` thread ids. */
const ARCHIVED_ERROR_TEXT = `session ${ARCHIVED_PROVIDER_THREAD_ID} is archived; unarchive it and retry`;
/** Copy of runtime.ts's CODEX_ARCHIVED_SESSION_ERROR_PATTERN (not exported). */
const RUNTIME_UNARCHIVE_RETRY_PATTERN =
  /\b(?:session|thread)\s+\S+\s+is archived\b/i;

const fakeAppServerPath = fileURLToPath(
  new URL("./fake-codex-app-server.mjs", import.meta.url),
);

/** One scripted app-server message: a notification, or a request it blocks on. */
interface ScriptedNotification {
  kind?: "notify";
  method: CodexEvent["method"];
  params: CodexEvent["params"];
}

interface ScriptedRequest {
  kind: "request";
  method: string;
  params: Record<string, string | number | null | string[]>;
}

/** Freeform provider fixture; the translator narrows it by schema. */
function codexNotification<M extends CodexEvent["method"]>(
  method: M,
  params: Extract<CodexEvent, { method: M }>["params"],
): ScriptedNotification {
  return { method, params };
}

function codexTurn(id: string, status: Turn["status"]): Turn {
  return {
    id,
    items: [],
    itemsView: "full",
    status,
    error: null,
    startedAt: 0,
    completedAt: null,
    durationMs: null,
  };
}

/**
 * The approval the app-server raises mid-turn for its command execution. It is
 * the only place either path exercises a provider-originated JSON-RPC request.
 */
const APPROVAL_REQUEST: ScriptedRequest = {
  kind: "request",
  method: "item/commandExecution/requestApproval",
  params: {
    threadId: SCRIPT_THREAD_ID,
    turnId: FIRST_TURN_ID,
    itemId: COMMAND_ITEM_ID,
    reason: "git status touches the workspace",
    command: "git status --short",
    cwd: "/tmp/project",
    commandActions: [],
    availableDecisions: ["accept", "acceptForSession", "decline"],
  },
};

/**
 * The scripted session, grouped per turn: the Nth accepted `turn/start` plays
 * the Nth group. Turn 1 is deliberately delta-first (an
 * `item/agentMessage/delta` before that item is ever opened) so the bridge's
 * `item/started` synthesis is exercised against a path that emits none; turn
 * 2's message is provider-opened, so a synthesized event there would be a bug.
 */
const SCRIPT: (ScriptedNotification | ScriptedRequest)[][] = [
  [
    codexNotification("turn/started", {
      threadId: SCRIPT_THREAD_ID,
      turn: codexTurn(FIRST_TURN_ID, "inProgress"),
    }),
    codexNotification("item/agentMessage/delta", {
      threadId: SCRIPT_THREAD_ID,
      turnId: FIRST_TURN_ID,
      itemId: "msg-cal-1",
      delta: "checking the tree",
    }),
    codexNotification("item/completed", {
      threadId: SCRIPT_THREAD_ID,
      turnId: FIRST_TURN_ID,
      completedAtMs: 0,
      item: {
        type: "agentMessage",
        id: "msg-cal-1",
        text: "checking the tree",
        phase: null,
        memoryCitation: null,
      },
    }),
    APPROVAL_REQUEST,
    codexNotification("item/started", {
      threadId: SCRIPT_THREAD_ID,
      turnId: FIRST_TURN_ID,
      startedAtMs: 0,
      item: {
        type: "commandExecution",
        id: COMMAND_ITEM_ID,
        command: "git status --short",
        cwd: "/tmp/project",
        processId: null,
        source: "agent",
        status: "inProgress",
        commandActions: [],
        aggregatedOutput: null,
        exitCode: null,
        durationMs: null,
      },
    }),
    codexNotification("item/commandExecution/outputDelta", {
      threadId: SCRIPT_THREAD_ID,
      turnId: FIRST_TURN_ID,
      itemId: COMMAND_ITEM_ID,
      delta: " M src/app.ts\n",
    }),
    codexNotification("item/completed", {
      threadId: SCRIPT_THREAD_ID,
      turnId: FIRST_TURN_ID,
      completedAtMs: 0,
      item: {
        type: "commandExecution",
        id: COMMAND_ITEM_ID,
        command: "git status --short",
        cwd: "/tmp/project",
        processId: null,
        source: "agent",
        status: "completed",
        commandActions: [],
        aggregatedOutput: " M src/app.ts\n",
        exitCode: 0,
        durationMs: 12,
      },
    }),
    codexNotification("item/completed", {
      threadId: SCRIPT_THREAD_ID,
      turnId: FIRST_TURN_ID,
      completedAtMs: 0,
      item: {
        type: "reasoning",
        id: "reasoning-cal-1",
        summary: ["Read the working tree"],
        content: ["The tree is dirty."],
      },
    }),
    codexNotification("turn/completed", {
      threadId: SCRIPT_THREAD_ID,
      turn: codexTurn(FIRST_TURN_ID, "completed"),
    }),
  ],
  [
    codexNotification("turn/started", {
      threadId: SCRIPT_THREAD_ID,
      turn: codexTurn(SECOND_TURN_ID, "inProgress"),
    }),
    codexNotification("item/started", {
      threadId: SCRIPT_THREAD_ID,
      turnId: SECOND_TURN_ID,
      startedAtMs: 0,
      item: {
        type: "agentMessage",
        id: "msg-cal-2",
        text: "",
        phase: null,
        memoryCitation: null,
      },
    }),
    codexNotification("item/completed", {
      threadId: SCRIPT_THREAD_ID,
      turnId: SECOND_TURN_ID,
      completedAtMs: 0,
      item: {
        type: "agentMessage",
        id: "msg-cal-2",
        text: "all done",
        phase: null,
        memoryCitation: null,
      },
    }),
    codexNotification("turn/completed", {
      threadId: SCRIPT_THREAD_ID,
      turn: codexTurn(SECOND_TURN_ID, "completed"),
    }),
  ],
];

const CANONICAL_OPTIONS = {
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
} as const;

/** The legacy runtime's execution context for adapter commands. */
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

const FIRST_REQUEST_ID = "creq_23456789ab";
const STEER_REQUEST_ID = "creq_23456789ac";
const SECOND_REQUEST_ID = "creq_23456789ad";

interface ReplayResult {
  approvals: PendingInteractionPayload[];
  events: ThreadEvent[];
}

function isScriptedRequest(
  entry: ScriptedNotification | ScriptedRequest,
): entry is ScriptedRequest {
  return entry.kind === "request";
}

/**
 * The legacy leg: the runtime's own sequence — announce the provider thread,
 * queue each turn's client request id, translate every notification the child
 * emitted, decode every request it raised, and ack the steer itself (codex
 * never acks one).
 */
function replayLegacy(): ReplayResult {
  const adapter = createCodexProviderAdapter();
  const events: ThreadEvent[] = [];
  const approvals: PendingInteractionPayload[] = [];

  // The identity notification the fake app-server emits on thread/start,
  // carrying only the thread id exactly as the fake does.
  events.push(
    ...adapter.translateEvent({
      jsonrpc: "2.0",
      method: "thread/started",
      params: { thread: { id: SCRIPT_THREAD_ID } },
    }),
  );

  const runTurn = (turnIndex: number, clientRequestId: string): void => {
    adapter.prepareTurnStart?.({
      type: "turn/start",
      threadId: THREAD_ID,
      providerThreadId: SCRIPT_THREAD_ID,
      clientRequestId,
      input: promptInput("check the tree"),
      options: LEGACY_EXECUTION_CONTEXT,
    });
    for (const entry of SCRIPT[turnIndex]) {
      if (isScriptedRequest(entry)) {
        const decoded = adapter.decodeInteractiveRequest?.({
          id: 1,
          method: entry.method,
          params: entry.params,
        });
        if (!decoded) {
          throw new Error(`Legacy path could not decode ${entry.method}`);
        }
        approvals.push(decoded.payload);
        continue;
      }
      events.push(
        ...adapter.translateEvent({
          jsonrpc: "2.0",
          method: entry.method,
          params: entry.params,
        }),
      );
    }
  };

  runTurn(0, FIRST_REQUEST_ID);

  events.push(
    ...(adapter.translateAcceptedCommand?.({
      command: {
        type: "turn/steer",
        threadId: THREAD_ID,
        providerThreadId: SCRIPT_THREAD_ID,
        expectedTurnId: FIRST_TURN_ID,
        clientRequestId: STEER_REQUEST_ID,
        input: promptInput("also check git log"),
        options: LEGACY_EXECUTION_CONTEXT,
      },
    }) ?? []),
  );

  runTurn(1, SECOND_REQUEST_ID);

  // A release stop with no active turn plans nothing on the legacy path, so it
  // contributes no events.
  return { approvals, events };
}

/**
 * Answer the bridge's inbound requests the way the runtime does. The scripted
 * app-server blocks its turn on the approval, so a leg that never answers
 * would hang rather than fail loudly.
 */
function answerBridgeRequests(
  bridge: BridgeJsonRpcTestHarness,
  from: number,
  approvals: PendingInteractionPayload[],
): number {
  for (const message of bridge.messages.slice(from)) {
    if (
      message.method !== BRIDGE_INBOUND_REQUEST_METHODS.interactionRequest ||
      message.id === undefined
    ) {
      continue;
    }
    approvals.push(interactionRequestParamsSchema.parse(message.params).payload);
    handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: { decision: "allow_once", grantedPermissions: null },
      }),
    );
  }
  return bridge.messages.length;
}

/** The canonical leg: a real bridge over a real (fake) app-server child. */
async function replayCanonical(workspaceDir: string): Promise<ReplayResult> {
  const bridge = createBridgeJsonRpcTestHarness(handleLine);
  const events: ThreadEvent[] = [];
  const approvals: PendingInteractionPayload[] = [];
  let drained = 0;
  let answered = 0;

  const collect = (): void => {
    for (const message of bridge.messages.slice(drained)) {
      if (message.method !== "thread/event") {
        continue;
      }
      const params = message.params;
      if (params !== null && typeof params === "object" && "event" in params) {
        // Freeform wire payload: the ThreadEvent the bridge just serialized.
        events.push(params.event as unknown as ThreadEvent);
      }
    }
    drained = bridge.messages.length;
  };

  /** Await a response while answering anything the bridge asks in the meantime. */
  const settle = async (id: number): Promise<void> => {
    while (!bridge.hasResponse(id)) {
      answered = answerBridgeRequests(bridge, answered, approvals);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    answered = bridge.messages.length;
    collect();
  };

  try {
    bridge.sendRequest(1, "thread/start", {
      threadId: THREAD_ID,
      cwd: workspaceDir,
      instructionMode: "append",
      options: { ...CANONICAL_OPTIONS },
    });
    await settle(1);

    bridge.sendRequest(2, "turn/start", {
      threadId: THREAD_ID,
      providerThreadId: THREAD_ID,
      input: promptInput("check the tree"),
      clientRequestId: FIRST_REQUEST_ID,
      options: { ...CANONICAL_OPTIONS },
    });
    await settle(2);

    // Steer against the turn the bridge reported, in ITS id space.
    const expectedTurnId = firstTurnId(events);
    if (expectedTurnId === undefined) {
      throw new Error("Expected a bridge-minted turn id to steer against");
    }
    bridge.sendRequest(3, "turn/steer", {
      threadId: THREAD_ID,
      providerThreadId: THREAD_ID,
      expectedTurnId,
      input: promptInput("also check git log"),
      clientRequestId: STEER_REQUEST_ID,
      options: { ...CANONICAL_OPTIONS },
    });
    await settle(3);

    bridge.sendRequest(4, "turn/start", {
      threadId: THREAD_ID,
      providerThreadId: THREAD_ID,
      input: promptInput("now summarize"),
      clientRequestId: SECOND_REQUEST_ID,
      options: { ...CANONICAL_OPTIONS },
    });
    await settle(4);

    bridge.sendRequest(5, "thread/stop", {
      threadId: THREAD_ID,
      providerThreadId: THREAD_ID,
      intent: "release",
      activeTurnId: null,
    });
    await settle(5);
  } finally {
    bridge.restore();
  }

  return { approvals, events };
}

function firstTurnId(events: readonly ThreadEvent[]): string | undefined {
  for (const event of events) {
    if (event.type === "turn/started" && event.scope.kind === "turn") {
      return event.scope.turnId;
    }
  }
  return undefined;
}

/**
 * The bridge stamps its session prefix on every id it hands out, including the
 * approval subject's item id. Strip it so the payloads compare as payloads.
 */
function withoutBridgeIdPrefix(
  payload: PendingInteractionPayload,
): PendingInteractionPayload {
  if (payload.kind !== "approval" || payload.subject.kind !== "command") {
    return payload;
  }
  return {
    ...payload,
    subject: {
      ...payload.subject,
      itemId: payload.subject.itemId.replace(/^bt[0-9a-f]{8}-\d+-/, ""),
    },
  };
}

let workspaceDir: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-calibration-ws-"));
  const scriptPath = join(workspaceDir, "calibration-script.json");
  writeFileSync(scriptPath, JSON.stringify({ turns: SCRIPT }), "utf8");
  vi.stubEnv("BB_CODEX_BRIDGE_APP_SERVER_COMMAND", process.execPath);
  vi.stubEnv(
    "BB_CODEX_BRIDGE_APP_SERVER_ARGS",
    // The script path rides argv: the bridge builds its child's environment
    // from an allowlist that strips every BB_-prefixed variable, so an env-var
    // seam would never reach the app-server.
    JSON.stringify([fakeAppServerPath, scriptPath]),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(workspaceDir, { recursive: true, force: true });
});

it("replays one scripted codex session identically on both paths", async () => {
  const legacy = replayLegacy();
  const canonical = await replayCanonical(workspaceDir);

  // A calibration is worthless if either leg went quiet, or if the canonical
  // leg silently fell back to the fake app-server's own hardcoded turn.
  expect(legacy.events.length).toBeGreaterThan(10);
  expect(canonical.events.length).toBeGreaterThan(10);
  expect(
    canonical.events.some(
      (event) =>
        event.type === "item/completed" &&
        event.item.type === "commandExecution" &&
        event.item.command === "git status --short",
    ),
  ).toBe(true);

  const diff = diffCalibrationStreams(
    normalizeCalibrationEvents(legacy.events),
    normalizeCalibrationEvents(canonical.events),
  );

  // Nothing the legacy path reports goes missing on the canonical one — not
  // even `turn/input/accepted`, which (unlike pi and claude) is compared
  // in-stream here: codex correlation is translator-owned and drains on
  // `turn/started`, so both paths ack at the same point in the sequence.
  expect(describeCalibrationEvents(diff.onlyInLegacy)).toEqual([]);

  // The one canonical extra: the delta-first agent message in turn 1. Codex
  // streams the delta before opening the item, and the canonical grammar
  // requires every item to open with `item/started`
  // (`synthesizeOpeningItem`), which the legacy shape omits. Turn 2's
  // provider-opened message is NOT duplicated, which is the other half of that
  // rule.
  //
  // Everything else matches byte for byte: thread started/identity, both
  // turns' started/completed events (`providerCheckpointId` excepted — a
  // bridge-only fact the normalizer drops), the agent-message delta and
  // completion, the command execution's started/outputDelta/completed triple
  // with its aggregated output and exit code, and the reasoning item.
  expect(describeCalibrationEvents(diff.onlyInBridge)).toEqual([
    "item/started:agentMessage",
  ]);

  // Approvals ride a different channel (bridge → runtime requests, decoded
  // in-process by the adapter on the legacy path), so they are compared here
  // rather than in the stream diff. Both paths must produce the same canonical
  // payload for the same provider request.
  expect(legacy.approvals).toHaveLength(1);
  const canonicalApproval = canonical.approvals[0];
  if (
    canonicalApproval?.kind !== "approval" ||
    canonicalApproval.subject.kind !== "command"
  ) {
    throw new Error("Expected a canonical command-approval payload");
  }
  // The subject's item id is bridge-minted (the same prefix its item events
  // carry), so the runtime can match the approval to the item it sees.
  expect(canonicalApproval.subject.itemId).toMatch(
    new RegExp(`^bt[0-9a-f]{8}-\\d+-${COMMAND_ITEM_ID}$`),
  );
  expect(canonical.approvals.map(withoutBridgeIdPrefix)).toEqual(
    legacy.approvals,
  );
}, 60_000);

it("reports an archived-session resume rejection identically on both paths", async () => {
  // The legacy path is the app-server's own error text: the runtime matches
  // CODEX_ARCHIVED_SESSION_ERROR_PATTERN against it to drive its
  // unarchive-and-retry recovery. The canonical path must surface that text
  // VERBATIM (historical fix a4e3011b0) or the recovery silently stops firing.
  const bridge = createBridgeJsonRpcTestHarness(handleLine);
  try {
    bridge.sendRequest(1, "thread/resume", {
      threadId: THREAD_ID,
      providerThreadId: ARCHIVED_PROVIDER_THREAD_ID,
      cwd: workspaceDir,
      instructionMode: "append",
      options: { ...CANONICAL_OPTIONS },
    });
    const response = await bridge.waitForResponse(1);

    expect(response.error?.code).toBe(
      BRIDGE_JSON_RPC_ERRORS.SESSION_NOT_RESTORABLE,
    );
    expect(response.error?.message).toBe(ARCHIVED_ERROR_TEXT);
    expect(ARCHIVED_ERROR_TEXT).toMatch(RUNTIME_UNARCHIVE_RETRY_PATTERN);
    expect(response.error?.message).toMatch(RUNTIME_UNARCHIVE_RETRY_PATTERN);
  } finally {
    bridge.restore();
  }
}, 30_000);
