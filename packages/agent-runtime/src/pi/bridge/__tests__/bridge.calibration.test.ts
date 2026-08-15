import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PromptInput, ThreadEvent } from "@bb/domain";
import { DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG } from "@bb/domain";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

/**
 * Pi dual-path calibration.
 *
 * One scripted Pi session — start, a turn carrying an assistant message, a
 * bash tool call and reasoning, a steer, a second turn, then a release stop —
 * is replayed twice through the same bridge module: once in the legacy dialect
 * (whose `sdk/message` notifications are fed to the legacy adapter, exactly as
 * the runtime does today) and once in the canonical dialect (whose
 * `thread/event` notifications are already ThreadEvents). Driving both legs
 * from one bridge and one fake SDK session means the two legs see
 * byte-identical provider output; anything the diff reports is a translation
 * or protocol difference, not fixture drift.
 *
 * The diff must stay empty apart from the documented list below. That list is
 * the deliberate canonical-vs-legacy delta, and shrinking or growing it is a
 * decision, not an accident.
 */

const { mockCreateAgentSession, mockCreateAgentSessionServices, mockGetPiModelRuntime } =
  vi.hoisted(() => {
    const mockModelRuntime = {
      getAvailable: vi.fn(async () => []),
      getModel: vi.fn(() => undefined),
      getModels: vi.fn(() => []),
      hasConfiguredAuth: vi.fn(() => false),
      refresh: vi.fn(async () => ({ aborted: false, errors: new Map() })),
    };
    const mockSettingsManager = {
      getShellCommandPrefix: vi.fn(() => undefined),
      getShellPath: vi.fn(() => undefined),
    };
    return {
      mockCreateAgentSession: vi.fn(),
      mockCreateAgentSessionServices: vi.fn(
        async (options: {
          agentDir?: string;
          cwd: string;
          resourceLoaderOptions: Record<string, unknown>;
        }) => ({
          agentDir: options.agentDir ?? "/tmp/pi-agent",
          cwd: options.cwd,
          diagnostics: [],
          modelRuntime: mockModelRuntime,
          resourceLoader: { options: options.resourceLoaderOptions },
          settingsManager: mockSettingsManager,
        }),
      ),
      mockGetPiModelRuntime: vi.fn(async () => mockModelRuntime),
    };
  });

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...actual,
    createAgentSessionFromServices: mockCreateAgentSession,
    createAgentSessionServices: mockCreateAgentSessionServices,
    getAgentDir: vi.fn(() => "/tmp/pi-agent"),
  };
});

vi.mock("../configured-services.js", () => ({
  createConfiguredPiServices: mockCreateAgentSessionServices,
}));

vi.mock("../model-runtime.js", () => ({
  getPiModelRuntime: mockGetPiModelRuntime,
}));

import { createPiProviderAdapter } from "../../adapter.js";
import { handleLine } from "../bridge.js";
import { PI_BRIDGE_SESSION_DIR_ENV } from "../session-paths.js";
import { createBridgeJsonRpcTestHarness } from "../../../test/bridge-json-rpc-test-helpers.js";
import {
  describeCalibrationEvents,
  diffCalibrationStreams,
  normalizeCalibrationEvents,
} from "../../../test/calibration-diff.js";

const THREAD_ID = "thr_calibration_1";
const TOOL_CALL_ID = "tc_01a2b3c4d5e6f7g8h9i0j1k2";

/** Freeform provider fixture; the translator narrows it by schema. */
function asPiSdkEvent(event: Record<string, unknown>): AgentSessionEvent {
  return event as unknown as AgentSessionEvent;
}

interface ScriptedPiSession {
  emit(event: AgentSessionEvent): void;
  finishFirstTurn(): void;
  isStreaming: boolean;
  prompt: ReturnType<typeof vi.fn>;
  [key: string]: unknown;
}

/**
 * The scripted session. Turn 1 streams an assistant message, a bash tool call
 * and reasoning, then stays open so the steer lands mid-turn; releasing it
 * emits agent_end. Turn 2 is a short second turn.
 */
function createScriptedPiSession(): ScriptedPiSession {
  const listeners: ((event: AgentSessionEvent) => void)[] = [];
  let releaseFirstTurn: (() => void) | undefined;
  let promptCount = 0;
  const emit = (event: AgentSessionEvent): void => {
    for (const listener of [...listeners]) {
      listener(event);
    }
  };

  const session: ScriptedPiSession = {
    abort: vi.fn(async () => {}),
    bindExtensions: vi.fn(async () => {}),
    compact: vi.fn(async () => {}),
    dispose: vi.fn(),
    emit,
    extensionRunner: { emit: vi.fn(async () => undefined) },
    finishFirstTurn(): void {
      if (!releaseFirstTurn) {
        throw new Error("Expected the first pi turn to be open");
      }
      const release = releaseFirstTurn;
      releaseFirstTurn = undefined;
      release();
    },
    getActiveToolNames: vi.fn(() => []),
    getContextUsage: vi.fn(() => undefined),
    hasExtensionHandlers: vi.fn(() => false),
    isStreaming: false,
    prompt: vi.fn(
      async (_text: string, options?: { streamingBehavior?: string }) => {
        if (options?.streamingBehavior === "steer") {
          emit(asPiSdkEvent({ type: "queue_update", steering: [], followUp: [] }));
          return;
        }
        promptCount += 1;
        if (promptCount === 1) {
          emit(asPiSdkEvent({ type: "agent_start" }));
          emit(
            asPiSdkEvent({
              type: "message_update",
              assistantMessageEvent: {
                type: "text_delta",
                contentIndex: 0,
                delta: "checking the tree",
              },
            }),
          );
          emit(
            asPiSdkEvent({
              type: "tool_execution_start",
              toolCallId: TOOL_CALL_ID,
              toolName: "bash",
              args: { command: "git status --short", cwd: "/tmp/project" },
            }),
          );
          emit(
            asPiSdkEvent({
              type: "tool_execution_end",
              toolCallId: TOOL_CALL_ID,
              toolName: "bash",
              result: { content: [{ type: "text", text: " M src/app.ts\n" }] },
              isError: false,
            }),
          );
          emit(
            asPiSdkEvent({
              type: "message_update",
              assistantMessageEvent: {
                type: "thinking_delta",
                contentIndex: 1,
                delta: "The tree is dirty.",
              },
            }),
          );
          emit(
            asPiSdkEvent({
              type: "message_update",
              assistantMessageEvent: {
                type: "thinking_end",
                contentIndex: 1,
                content: "The tree is dirty.",
              },
            }),
          );
          await new Promise<void>((resolve) => {
            releaseFirstTurn = resolve;
          });
          emit(
            asPiSdkEvent({ type: "agent_end", messages: [], willRetry: false }),
          );
          return;
        }
        emit(asPiSdkEvent({ type: "agent_start" }));
        emit(
          asPiSdkEvent({
            type: "message_update",
            assistantMessageEvent: {
              type: "text_delta",
              contentIndex: 0,
              delta: "done",
            },
          }),
        );
        emit(
          asPiSdkEvent({ type: "agent_end", messages: [], willRetry: false }),
        );
      },
    ),
    sessionManager: { getLeafId: vi.fn(() => "pi-calibration-checkpoint") },
    setActiveToolsByName: vi.fn(),
    subscribe: vi.fn((listener: (event: AgentSessionEvent) => void) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index !== -1) {
          listeners.splice(index, 1);
        }
      };
    }),
  };
  return session;
}

const CANONICAL_OPTIONS = {
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
} as const;

const PROMPT_INPUT: PromptInput[] = [
  { type: "text", text: "check the tree", mentions: [] },
];
const STEER_INPUT: PromptInput[] = [
  { type: "text", text: "also check git log", mentions: [] },
];
const SECOND_PROMPT_INPUT: PromptInput[] = [
  { type: "text", text: "now summarize", mentions: [] },
];

/** The legacy runtime's execution context for the steer acknowledgement. */
const LEGACY_EXECUTION_CONTEXT = {
  claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
  workflowsEnabled: false,
} as const;

interface ReplayResult {
  events: ThreadEvent[];
}

/**
 * Run the scripted session end to end against one dialect. The request
 * sequence is identical; only the params shape (and therefore the bridge's
 * output channel) differs.
 */
async function replay(args: {
  dialect: "legacy" | "canonical";
  workspaceDir: string;
}): Promise<ReplayResult> {
  const session = createScriptedPiSession();
  mockCreateAgentSession.mockImplementation(async () => ({ session }));
  const bridge = createBridgeJsonRpcTestHarness(handleLine);
  const canonical = args.dialect === "canonical";
  const adapter = canonical ? null : createPiProviderAdapter();
  const events: ThreadEvent[] = [];
  let drained = 0;

  // Fold everything the bridge emitted since the last call into the stream
  // under test: raw provider notifications go through the legacy adapter,
  // canonical thread/events are already ThreadEvents.
  const collect = (): void => {
    for (const message of bridge.messages.slice(drained)) {
      if (canonical) {
        if (message.method === "thread/event") {
          const params = message.params;
          if (params !== null && typeof params === "object" && "event" in params) {
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
        : { threadId: THREAD_ID, cwd: args.workspaceDir },
    );
    await bridge.waitForResponse(1);
    collect();

    bridge.sendRequest(
      2,
      "turn/start",
      canonical
        ? {
            threadId: THREAD_ID,
            providerThreadId: THREAD_ID,
            input: PROMPT_INPUT,
            clientRequestId: "creq_23456789ab",
            options: CANONICAL_OPTIONS,
          }
        : { threadId: THREAD_ID, input: PROMPT_INPUT },
    );
    await bridge.flushWork();
    collect();

    // Steer mid-turn: pi only accepts a steer while the agent is streaming.
    session.isStreaming = true;
    const expectedTurnId = lastTurnId(events) ?? "turn-1";
    bridge.sendRequest(
      3,
      "turn/steer",
      canonical
        ? {
            threadId: THREAD_ID,
            providerThreadId: THREAD_ID,
            expectedTurnId,
            input: STEER_INPUT,
            clientRequestId: "creq_23456789ac",
            options: CANONICAL_OPTIONS,
          }
        : { threadId: THREAD_ID, expectedTurnId, input: STEER_INPUT },
    );
    await bridge.waitForResponse(3);
    collect();
    if (!canonical) {
      // The runtime, not the bridge, acks a legacy steer.
      events.push(
        ...(adapter?.translateAcceptedCommand?.({
          command: {
            type: "turn/steer",
            threadId: THREAD_ID,
            providerThreadId: THREAD_ID,
            expectedTurnId,
            clientRequestId: "creq_23456789ac",
            input: STEER_INPUT,
            options: LEGACY_EXECUTION_CONTEXT,
          },
        }) ?? []),
      );
    }

    session.isStreaming = false;
    session.finishFirstTurn();
    await bridge.waitForResponse(2);
    collect();

    bridge.sendRequest(
      4,
      "turn/start",
      canonical
        ? {
            threadId: THREAD_ID,
            providerThreadId: THREAD_ID,
            input: SECOND_PROMPT_INPUT,
            clientRequestId: "creq_23456789ad",
            options: CANONICAL_OPTIONS,
          }
        : { threadId: THREAD_ID, input: SECOND_PROMPT_INPUT },
    );
    await bridge.waitForResponse(4);
    collect();

    bridge.sendRequest(
      5,
      "thread/stop",
      canonical
        ? {
            threadId: THREAD_ID,
            providerThreadId: THREAD_ID,
            intent: "release",
            activeTurnId: null,
          }
        : { threadId: THREAD_ID },
    );
    await bridge.waitForResponse(5);
    collect();
  } finally {
    bridge.restore();
  }

  return { events };
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

const originalSessionDir = process.env[PI_BRIDGE_SESSION_DIR_ENV];
let workspaceDir: string;
let sessionDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-pi-calibration-ws-"));
  sessionDir = mkdtempSync(join(tmpdir(), "bb-pi-calibration-sessions-"));
  process.env[PI_BRIDGE_SESSION_DIR_ENV] = sessionDir;
});

afterEach(() => {
  rmSync(workspaceDir, { recursive: true, force: true });
  rmSync(sessionDir, { recursive: true, force: true });
  if (originalSessionDir === undefined) {
    delete process.env[PI_BRIDGE_SESSION_DIR_ENV];
  } else {
    process.env[PI_BRIDGE_SESSION_DIR_ENV] = originalSessionDir;
  }
});

it("replays one scripted pi session identically on both paths", async () => {
  const legacy = await replay({ dialect: "legacy", workspaceDir });
  const canonical = await replay({ dialect: "canonical", workspaceDir });

  const diff = diffCalibrationStreams(
    normalizeCalibrationEvents(legacy.events),
    normalizeCalibrationEvents(canonical.events),
  );

  // The one legacy extra: the legacy bridge announces the provider thread as a
  // notification, which the adapter turns into a thread/identity event. The
  // canonical protocol returns that identity in the thread/start *response*
  // instead, so it is not a stream event at all.
  expect(describeCalibrationEvents(diff.onlyInLegacy)).toEqual([
    "thread/identity",
  ]);

  // The canonical extras, in order. Each is a deliberate protocol addition:
  //  - turn/input/accepted per turn/start: the bridge acks the turn it
  //    accepted. On the legacy path only a steer is acked, and by the runtime
  //    rather than the provider process.
  //  - item/started for the assistant and reasoning items: pi streams
  //    delta-first, and the canonical grammar requires every item to open with
  //    item/started (`synthesizeItemStarted`), which the legacy shape omits.
  expect(describeCalibrationEvents(diff.onlyInBridge)).toEqual([
    "turn/input/accepted",
    "item/started:agentMessage",
    "item/started:reasoning",
    "turn/input/accepted",
    "item/started:agentMessage",
  ]);
}, 30_000);
