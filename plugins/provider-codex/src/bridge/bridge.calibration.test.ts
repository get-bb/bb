import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PromptInput, ThreadEvent } from "@bb/domain";
import {
  BRIDGE_INBOUND_REQUEST_METHODS,
  BRIDGE_JSON_RPC_ERRORS,
  THREAD_DELTA_NOTIFICATION_METHOD,
  interactionRequestParamsSchema,
  type InteractionRequestParams,
} from "@bb/provider-bridge-protocol";
import {
  createBridgeDeltaEventCollector,
  type BridgeDeltaEventCollector,
} from "@bb/agent-runtime/test/bridge-delta-assembly";
import type { ServerNotification as CodexEvent } from "../generated/codex-app-server/schema/ServerNotification.js";
import type { Turn } from "../generated/codex-app-server/schema/v2/Turn.js";
import { handleLine } from "./bridge.js";
import {
  createBridgeJsonRpcTestHarness,
  describeCalibrationEvents,
  normalizeCalibrationEvents,
} from "@bb/provider-bridge-protocol/testing";
import type { BridgeJsonRpcTestHarness } from "@bb/provider-bridge-protocol/testing";
/**
 * Codex scripted-session golden.
 *
 * One scripted app-server session — thread start, a first turn carrying a
 * delta-first agent message, a command execution (with a mid-turn approval
 * request and a streamed output delta) and a reasoning item, a steer, a short
 * second turn whose agent message is NOT delta-first, then a release stop — is
 * handed to `fake-codex-app-server.mjs` as an argv script file, so the bridge
 * really spawns a child, really reads those messages off a pipe, and really
 * translates them. The resulting ThreadEvent stream is pinned as a golden.
 *
 * This was a dual-path calibration until the legacy adapter graduated: the
 * same script was also replayed straight into
 * `createCodexProviderAdapter().translateEvent(...)` and the two streams were
 * diffed. With one path left there is nothing to calibrate, but the scripted
 * session is the only end-to-end assertion over a WHOLE codex session shape —
 * turn boundaries, item identity across a delta-first open, the command
 * execution's started/outputDelta/completed triple, reasoning, the steer's ack
 * drained onto the open turn, and a release stop — so the golden stays.
 * Changing the list below is a decision, not an accident.
 *
 * Approvals travel on their own channel (bridge → runtime requests), so they
 * are asserted separately from the golden.
 */

const THREAD_ID = "thr_codex_calibration_1";
/**
 * The codex thread id the script is written against. The app-server mints its
 * own on `thread/start` and rewrites the script to it, so this value only has
 * to be internally consistent.
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
    // Real Codex denial flows can repeat the exact terminal notification for
    // one item after the approval response. Provider retries must not create a
    // second canonical completion for the same lifecycle edge.
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
    // item/started explicitly reopens an identifier under the canonical event
    // grammar. The next completion is new lifecycle work, not a retry.
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
        aggregatedOutput: "clean\n",
        exitCode: 0,
        durationMs: 8,
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

function promptInput(text: string): PromptInput[] {
  return [{ type: "text", text, mentions: [] }];
}

const FIRST_REQUEST_ID = "creq_23456789ab";
const STEER_REQUEST_ID = "creq_23456789ac";
const SECOND_REQUEST_ID = "creq_23456789ad";

interface ReplayResult {
  approvals: InteractionRequestParams[];
  collector: BridgeDeltaEventCollector;
  events: ThreadEvent[];
}

/**
 * Answer the bridge's inbound requests the way the runtime does. The scripted
 * app-server blocks its turn on the approval, so a leg that never answers
 * would hang rather than fail loudly.
 */
function answerBridgeRequests(
  bridge: BridgeJsonRpcTestHarness,
  from: number,
  approvals: InteractionRequestParams[],
): number {
  for (const message of bridge.messages.slice(from)) {
    if (
      message.method !== BRIDGE_INBOUND_REQUEST_METHODS.interactionRequest ||
      message.id === undefined
    ) {
      continue;
    }
    approvals.push(interactionRequestParamsSchema.parse(message.params));
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
  const approvals: InteractionRequestParams[] = [];
  let drained = 0;
  let answered = 0;

  // The bridge emits thread/delta; one stateful assembler (the runtime
  // adapter's exact translation) turns the capture into canonical events.
  const collector = createBridgeDeltaEventCollector("codex");
  const collect = (): void => {
    for (const message of bridge.messages.slice(drained)) {
      if (message.method !== THREAD_DELTA_NOTIFICATION_METHOD) {
        continue;
      }
      events.push(...collector.assembleMessage(message));
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

    // Steer against the codex-native turn id: the runtime reverse-maps the
    // assembler-minted turn id before dispatch, so this leg does the same
    // through the collector's assembler.
    const bbTurnId = firstTurnId(events);
    const expectedTurnId =
      bbTurnId === undefined
        ? undefined
        : collector.assembler.getProviderTurnId(THREAD_ID, bbTurnId);
    if (expectedTurnId === undefined) {
      throw new Error("Expected a codex-native turn id to steer against");
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

  return { approvals, collector, events };
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
 * The golden event stream for the scripted session above.
 *
 * Turn 1 opens with the synthesized `item/started:agentMessage`: codex streams
 * the delta before opening the item, and the canonical grammar requires every
 * item to open with `item/started` (`synthesizeOpeningItem`). Turn 2's agent
 * message is provider-opened, so a synthesized event THERE would be a bug —
 * that asymmetry is the point of the two-turn script.
 */
const GOLDEN_EVENT_STREAM: string[] = [
  // Session construction: the app-server's own `thread/started`, then the
  // identity event carrying the provider thread id it minted.
  "thread/started",
  "thread/identity",
  // Turn 1: the delta-first agent message (hence the synthesized
  // item/started), then the command execution's started/outputDelta/completed
  // triple with its aggregated output and exit code, then the reasoning item.
  // Reasoning is provider-completed in one shot, so it has no `item/started` —
  // synthesis fires only for an item that streams before it opens.
  "turn/started",
  "turn/input/accepted",
  "item/started:agentMessage",
  "item/agentMessage/delta",
  "item/completed:agentMessage",
  "item/started:commandExecution",
  "item/commandExecution/outputDelta",
  "item/completed:commandExecution",
  "item/started:commandExecution",
  "item/completed:commandExecution",
  "item/completed:reasoning",
  "turn/completed",
  // The steer's ack. Codex never acks a steer itself, so correlation is
  // translator-owned and drains on the next `turn/started` — which is why the
  // ack lands here, after turn 1 settled, rather than inside it.
  "turn/input/accepted",
  // Turn 2: the agent message is provider-opened, so there is NO synthesized
  // `item/started` beyond the provider's own — the other half of the
  // synthesis rule, and the reason the script carries two differently-shaped
  // turns.
  "turn/started",
  "turn/input/accepted",
  "item/started:agentMessage",
  "item/completed:agentMessage",
  "turn/completed",
  // The release stop contributes no events.
];

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

it("replays one scripted codex session onto the golden event stream", async () => {
  const canonical = await replayCanonical(workspaceDir);

  // A golden is worthless if the run went quiet, or if the bridge silently fell
  // back to the fake app-server's own hardcoded turn.
  expect(canonical.events.length).toBeGreaterThan(10);
  expect(
    canonical.events.filter(
      (event) =>
        event.type === "item/completed" &&
        event.item.type === "commandExecution" &&
        event.item.command === "git status --short",
    ),
  ).toHaveLength(2);

  expect(
    describeCalibrationEvents(normalizeCalibrationEvents(canonical.events)),
  ).toEqual(GOLDEN_EVENT_STREAM);

  // Approvals ride a different channel (bridge → runtime requests), so they are
  // asserted here rather than in the golden.
  expect(canonical.approvals).toHaveLength(1);
  const approvalRequest = canonical.approvals[0];
  const canonicalApproval = approvalRequest?.payload;
  if (
    canonicalApproval?.kind !== "approval" ||
    canonicalApproval.subject.kind !== "command"
  ) {
    throw new Error("Expected a canonical command-approval payload");
  }
  // The request carries codex-native ids and says so: the runtime adapter
  // translates the subject's item id through the assembler's map so the app
  // can match the approval to the timeline item it sees.
  expect(approvalRequest?.providerNativeIds).toBe(true);
  expect(canonicalApproval.subject.itemId).toBe(COMMAND_ITEM_ID);
  const commandEventItemId = canonical.events.find(
    (event) =>
      event.type === "item/completed" &&
      event.item.type === "commandExecution" &&
      event.item.command === "git status --short",
  );
  expect(
    canonical.collector.assembler.getBbItemId(THREAD_ID, COMMAND_ITEM_ID),
  ).toBe(
    commandEventItemId?.type === "item/completed"
      ? commandEventItemId.item.id
      : undefined,
  );
  expect(canonicalApproval).toMatchObject({
    kind: "approval",
    reason: "git status touches the workspace",
    subject: { kind: "command", command: "git status --short" },
  });
}, 60_000);

it("surfaces an archived-session resume rejection verbatim", async () => {
  // The error text is the app-server's own: the runtime matches
  // CODEX_ARCHIVED_SESSION_ERROR_PATTERN against it to drive its
  // unarchive-and-retry recovery. The bridge must surface that text VERBATIM
  // (historical fix a4e3011b0) or the recovery silently stops firing.
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
