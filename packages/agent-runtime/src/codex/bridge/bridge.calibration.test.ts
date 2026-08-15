import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PromptInput, ThreadEvent } from "@bb/domain";
import { DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG } from "@bb/domain";
import { createCodexProviderAdapter } from "../adapter.js";
import { handleLine } from "./bridge.js";
import { createBridgeJsonRpcTestHarness } from "../../test/bridge-json-rpc-test-helpers.js";
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
 * notifications to the adapter, while the canonical bridge owns an app-server
 * child of its own. So the shared artifact here is the SCRIPT — one ordered
 * list of app-server notifications, replayed two ways:
 *
 *  - legacy: straight into `adapter.translateEvent`, which is what the runtime
 *    does with the child's stdout today;
 *  - canonical: written to a file the fake app-server replays
 *    (an argv script file), so the bridge really spawns a child, really
 *    reads those notifications off a pipe, and really translates them.
 *
 * Anything the diff reports is a translation or protocol difference.
 */

const THREAD_ID = "thr_calibration_1";
const PROVIDER_THREAD_ID = "codex-thread-placeholder";

const fakeAppServerPath = fileURLToPath(
  new URL("./fake-codex-app-server.mjs", import.meta.url),
);

interface ScriptedNotification {
  method: string;
  params: Record<string, unknown>;
}

function turnStarted(turnId: string): ScriptedNotification {
  return {
    method: "turn/started",
    params: {
      threadId: PROVIDER_THREAD_ID,
      turn: {
        id: turnId,
        items: [],
        itemsView: "full",
        status: "inProgress",
        error: null,
        startedAt: 0,
        completedAt: null,
        durationMs: null,
      },
    },
  };
}

function turnCompleted(turnId: string): ScriptedNotification {
  return {
    method: "turn/completed",
    params: {
      threadId: PROVIDER_THREAD_ID,
      turn: {
        id: turnId,
        items: [],
        itemsView: "full",
        status: "completed",
        error: null,
        startedAt: 0,
        completedAt: null,
        durationMs: null,
      },
    },
  };
}

/**
 * The scripted session. Turn 1 carries a delta-first agent message, a command
 * execution with streamed output, and reasoning; turn 2 is a short follow-up.
 */
const SCRIPT: ScriptedNotification[][] = [
  [
    turnStarted("turn-c1"),
    {
      method: "item/agentMessage/delta",
      params: {
        threadId: PROVIDER_THREAD_ID,
        turnId: "turn-c1",
        itemId: "item-msg-1",
        delta: "checking the tree",
      },
    },
    {
      method: "item/completed",
      params: {
        threadId: PROVIDER_THREAD_ID,
        turnId: "turn-c1",
        completedAtMs: 0,
        item: {
          type: "agentMessage",
          id: "item-msg-1",
          text: "checking the tree",
          phase: null,
          memoryCitation: null,
        },
      },
    },
    {
      method: "item/started",
      params: {
        threadId: PROVIDER_THREAD_ID,
        turnId: "turn-c1",
        startedAtMs: 0,
        item: {
          type: "commandExecution",
          id: "cmd-1",
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
      },
    },
    {
      method: "item/commandExecution/outputDelta",
      params: {
        threadId: PROVIDER_THREAD_ID,
        turnId: "turn-c1",
        itemId: "cmd-1",
        delta: " M src/app.ts\n",
      },
    },
    {
      method: "item/completed",
      params: {
        threadId: PROVIDER_THREAD_ID,
        turnId: "turn-c1",
        completedAtMs: 0,
        item: {
          type: "commandExecution",
          id: "cmd-1",
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
      },
    },
    {
      method: "item/completed",
      params: {
        threadId: PROVIDER_THREAD_ID,
        turnId: "turn-c1",
        completedAtMs: 0,
        item: {
          type: "reasoning",
          id: "reasoning-1",
          summary: ["Read the working tree"],
          content: ["The tree is dirty."],
        },
      },
    },
    turnCompleted("turn-c1"),
  ],
  [
    turnStarted("turn-c2"),
    {
      method: "item/agentMessage/delta",
      params: {
        threadId: PROVIDER_THREAD_ID,
        turnId: "turn-c2",
        itemId: "item-msg-2",
        delta: "all done",
      },
    },
    {
      method: "item/completed",
      params: {
        threadId: PROVIDER_THREAD_ID,
        turnId: "turn-c2",
        completedAtMs: 0,
        item: {
          type: "agentMessage",
          id: "item-msg-2",
          text: "all done",
          phase: null,
          memoryCitation: null,
        },
      },
    },
    turnCompleted("turn-c2"),
  ],
];

const CANONICAL_OPTIONS = {
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
} as const;

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

/**
 * The legacy leg: the runtime's own sequence — queue the turn's client request
 * id, dispatch, then translate every notification the child emitted.
 */
function replayLegacy(): ThreadEvent[] {
  const adapter = createCodexProviderAdapter();
  const events: ThreadEvent[] = [];

  adapter.prepareTurnStart?.({
    type: "turn/start",
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    clientRequestId: FIRST_REQUEST_ID,
    input: promptInput("check the tree"),
    options: LEGACY_EXECUTION_CONTEXT,
  });
  for (const notification of SCRIPT[0]) {
    events.push(
      ...adapter.translateEvent({
        jsonrpc: "2.0",
        method: notification.method,
        params: notification.params,
      }),
    );
  }

  events.push(
    ...(adapter.translateAcceptedCommand?.({
      command: {
        type: "turn/steer",
        threadId: THREAD_ID,
        providerThreadId: PROVIDER_THREAD_ID,
        expectedTurnId: "turn-c1",
        clientRequestId: STEER_REQUEST_ID,
        input: promptInput("also check git log"),
        options: LEGACY_EXECUTION_CONTEXT,
      },
    }) ?? []),
  );

  adapter.prepareTurnStart?.({
    type: "turn/start",
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    clientRequestId: SECOND_REQUEST_ID,
    input: promptInput("now summarize"),
    options: LEGACY_EXECUTION_CONTEXT,
  });
  for (const notification of SCRIPT[1]) {
    events.push(
      ...adapter.translateEvent({
        jsonrpc: "2.0",
        method: notification.method,
        params: notification.params,
      }),
    );
  }

  return events;
}

/** The canonical leg: a real bridge over a real (fake) app-server child. */
async function replayCanonical(workspaceDir: string): Promise<ThreadEvent[]> {
  const bridge = createBridgeJsonRpcTestHarness(handleLine);
  const events: ThreadEvent[] = [];
  let drained = 0;
  let providerThreadId = PROVIDER_THREAD_ID;

  const collect = (): void => {
    for (const message of bridge.messages.slice(drained)) {
      if (message.method !== "thread/event") {
        continue;
      }
      const params = message.params;
      if (params !== null && typeof params === "object" && "event" in params) {
        events.push(params.event as ThreadEvent);
      }
    }
    drained = bridge.messages.length;
  };

  try {
    bridge.sendRequest(1, "thread/start", {
      threadId: THREAD_ID,
      cwd: workspaceDir,
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
      input: promptInput("check the tree"),
      clientRequestId: FIRST_REQUEST_ID,
      options: CANONICAL_OPTIONS,
    });
    await bridge.waitForResponse(2);
    collect();

    bridge.sendRequest(3, "turn/steer", {
      threadId: THREAD_ID,
      providerThreadId,
      expectedTurnId: firstTurnId(events) ?? "turn-c1",
      input: promptInput("also check git log"),
      clientRequestId: STEER_REQUEST_ID,
      options: CANONICAL_OPTIONS,
    });
    await bridge.waitForResponse(3);
    collect();

    bridge.sendRequest(4, "turn/start", {
      threadId: THREAD_ID,
      providerThreadId,
      input: promptInput("now summarize"),
      clientRequestId: SECOND_REQUEST_ID,
      options: CANONICAL_OPTIONS,
    });
    await bridge.waitForResponse(4);
    collect();

    bridge.sendRequest(5, "thread/stop", {
      threadId: THREAD_ID,
      providerThreadId,
      intent: "release",
      activeTurnId: null,
    });
    await bridge.waitForResponse(5);
    collect();
  } finally {
    bridge.restore();
  }

  return events;
}

function firstTurnId(events: readonly ThreadEvent[]): string | undefined {
  for (const event of events) {
    if (event.type === "turn/started" && event.scope.kind === "turn") {
      return event.scope.turnId;
    }
  }
  return undefined;
}

let workspaceDir: string;
let scriptPath: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-calibration-ws-"));
  scriptPath = join(workspaceDir, "calibration-script.json");
  writeFileSync(scriptPath, JSON.stringify({ turns: SCRIPT }), "utf8");
  vi.stubEnv("BB_CODEX_BRIDGE_APP_SERVER_COMMAND", process.execPath);
  vi.stubEnv(
    "BB_CODEX_BRIDGE_APP_SERVER_ARGS",
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

  // A calibration is worthless if either leg went quiet.
  expect(legacy.length).toBeGreaterThan(8);
  expect(canonical.length).toBeGreaterThan(8);

  const diff = diffCalibrationStreams(
    normalizeCalibrationEvents(legacy),
    normalizeCalibrationEvents(canonical),
  );

  // Nothing the legacy path reports goes missing on the canonical one. Note
  // this includes `turn/input/accepted`, compared in-stream rather than as a
  // set (unlike pi and claude): codex correlation is translator-owned via
  // turn/started, so both paths ack at the same point in the sequence.
  expect(describeCalibrationEvents(diff.onlyInLegacy)).toEqual([]);

  // The canonical extras:
  //  - thread/started + thread/identity: session establishment. The legacy leg
  //    replays only turn traffic, because the runtime — not the adapter —
  //    owns session setup on that path, so there is nothing to compare them
  //    against rather than anything being lost.
  //  - one item/started per delta-first agent message: codex streams the delta
  //    before opening the item, and the canonical grammar requires every item
  //    to open with item/started, which the legacy shape omits.
  //
  // Everything else matches byte for byte: both turns' started/completed
  // events, the agent message delta and completion, the command execution's
  // started/outputDelta/completed triple with its aggregated output and exit
  // code, and the reasoning item's summary and content.
  expect(describeCalibrationEvents(diff.onlyInBridge)).toEqual([
    "thread/started",
    "thread/identity",
    "item/started:agentMessage",
    "item/started:agentMessage",
  ]);
}, 60_000);
