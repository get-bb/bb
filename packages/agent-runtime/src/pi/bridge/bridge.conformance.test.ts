import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
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
} from "@bb/provider-bridge-protocol/testing";

/**
 * The pi bridge's conformance run: drives the bridge through the canonical
 * Provider Bridge Protocol suite against a scripted in-process Pi SDK session
 * (the same mocking seam the pi bridge tests use for hermetic sessions:
 * `createAgentSessionFromServices` and the configured-services factory are
 * replaced, while SessionManager stays real so session files genuinely
 * materialize in a temp dir) and asserts a fully green report.
 *
 * The scripted session answers every prompt with agent_start → a streamed
 * text delta → agent_end, so the suite exercises the translator's turn
 * lifecycle, delta-first item synthesis, and cross-resume id uniqueness
 * (each canonical session gets a fresh entropy-prefixed translator).
 */

const {
  mockCreateAgentSession,
  mockCreateAgentSessionServices,
  mockGetPiModelRuntime,
} = vi.hoisted(() => {
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
  // Real SessionManager: session files genuinely open/persist in the temp
  // session dir, so thread/resume exercises a true reopen.
  return {
    ...actual,
    createAgentSessionFromServices: mockCreateAgentSession,
    createAgentSessionServices: mockCreateAgentSessionServices,
    getAgentDir: vi.fn(() => "/tmp/pi-agent"),
  };
});

vi.mock("./configured-services.js", () => ({
  createConfiguredPiServices: mockCreateAgentSessionServices,
}));

vi.mock("./model-runtime.js", () => ({
  getPiModelRuntime: mockGetPiModelRuntime,
}));

import { handleLine } from "./bridge.js";
import { PI_BRIDGE_SESSION_DIR_ENV } from "./session-paths.js";

const CONFORMANCE_THREAD_ID = "thr_conformance_1";

/** The prompt the kit's turn/settles-without-activity scenario sends. */
const ZERO_WORK_PROMPT_TEXT = "/clear";

/** Freeform provider fixture; the bridge translator narrows it by schema. */
function asPiSdkEvent(event: Record<string, unknown>): AgentSessionEvent {
  return event as unknown as AgentSessionEvent;
}

interface ScriptedPiAgentSession {
  abort: ReturnType<typeof vi.fn>;
  bindExtensions: ReturnType<typeof vi.fn>;
  compact: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  extensionRunner: { emit: ReturnType<typeof vi.fn> };
  getActiveToolNames: ReturnType<typeof vi.fn>;
  getContextUsage: ReturnType<typeof vi.fn>;
  hasExtensionHandlers: ReturnType<typeof vi.fn>;
  isStreaming: boolean;
  prompt: ReturnType<typeof vi.fn>;
  sessionManager: { getLeafId: ReturnType<typeof vi.fn> };
  setActiveToolsByName: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
}

let scriptedTurnCounter = 0;

/**
 * A pi SDK session whose prompt answers with one full scripted turn:
 * agent_start, a streamed assistant text delta (delta-first, so the
 * translator must synthesize item/started), then agent_end carrying the
 * final assistant message and usage.
 */
function createScriptedPiAgentSession(): ScriptedPiAgentSession {
  const listeners: ((event: AgentSessionEvent) => void)[] = [];
  const emit = (event: AgentSessionEvent): void => {
    for (const listener of [...listeners]) {
      listener(event);
    }
  };
  return {
    abort: vi.fn(async () => {}),
    bindExtensions: vi.fn(async () => {}),
    compact: vi.fn(async () => {}),
    dispose: vi.fn(),
    extensionRunner: { emit: vi.fn(async () => undefined) },
    getActiveToolNames: vi.fn(() => []),
    getContextUsage: vi.fn(() => undefined),
    hasExtensionHandlers: vi.fn(() => false),
    isStreaming: false,
    prompt: vi.fn(
      async (
        promptText: string,
        options?: { preflightResult?: (accepted: boolean) => void },
      ) => {
        // Pi accepts a prompt it is about to run in preflight, which is what
        // tells the bridge the input was consumed rather than queued.
        options?.preflightResult?.(true);
        // A prompt the agent handles without emitting a single SDK event: the
        // bridge's own pi/prompt/settled report is then the only signal that
        // can settle the turn (#1431).
        if (promptText === ZERO_WORK_PROMPT_TEXT) {
          return;
        }
        scriptedTurnCounter += 1;
        const text = `hello from turn ${scriptedTurnCounter}`;
        emit(asPiSdkEvent({ type: "agent_start" }));
        emit(
          asPiSdkEvent({
            type: "message_update",
            assistantMessageEvent: {
              type: "text_delta",
              contentIndex: 0,
              delta: text,
            },
          }),
        );
        emit(
          asPiSdkEvent({
            type: "agent_end",
            messages: [
              {
                role: "assistant",
                content: [{ type: "text", text }],
                usage: { input: 12, output: 5 },
              },
            ],
            willRetry: false,
          }),
        );
      },
    ),
    sessionManager: { getLeafId: vi.fn(() => "pi-conformance-checkpoint") },
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
}

const originalPiBridgeSessionDir = process.env[PI_BRIDGE_SESSION_DIR_ENV];

let output: CapturedBridgeJsonRpcOutput;
let workspaceDir: string;
let sessionDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  scriptedTurnCounter = 0;
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-pi-conformance-ws-"));
  sessionDir = mkdtempSync(join(tmpdir(), "bb-pi-conformance-sessions-"));
  process.env[PI_BRIDGE_SESSION_DIR_ENV] = sessionDir;
  mockCreateAgentSession.mockImplementation(async () => ({
    session: createScriptedPiAgentSession(),
  }));
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
        providerThreadId: CONFORMANCE_THREAD_ID,
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
  rmSync(sessionDir, { recursive: true, force: true });
  if (originalPiBridgeSessionDir === undefined) {
    delete process.env[PI_BRIDGE_SESSION_DIR_ENV];
  } else {
    process.env[PI_BRIDGE_SESSION_DIR_ENV] = originalPiBridgeSessionDir;
  }
});

it("passes the canonical protocol suite against the scripted pi session", async () => {
  let drained = 0;
  // The conformance kit's grammar checks run over canonical ThreadEvents; the
  // pi bridge emits thread/delta. Run deltas through a real assembler (the
  // runtime adapter's exact translation, held stateful across the whole run)
  // and hand the kit its assembled-event notifications.
  const collector = createBridgeDeltaEventCollector();
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
  console.info(`pi bridge conformance:\n${formatConformanceReport(report)}`);

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
