/**
 * The preamble every pi bridge suite shares: a temp workspace with its
 * session dir, the fake `pi --mode rpc` child (fake-pi-rpc.mjs) behind the
 * launch seam a live run uses (`BB_PI_BRIDGE_COMMAND` / `_ARGS`), the
 * bridge's stdout captured through the SDK's JSON-RPC harness, and the
 * `initialize` handshake — plus the driver helpers the suites share: a
 * thread start, the 20 s waits over deltas and messages, and the fake's
 * process log. Suites stub their remaining fault knobs (`FAKE_PI_*`) after
 * `startFakePiBridge` returns; the handshake spawns nothing.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import { z } from "zod";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import type {
  BridgeJsonRpcId,
  BridgeJsonRpcObject,
  BridgeJsonRpcOutputMessage,
} from "@get-bb/plugin-sdk/provider-bridge/testing";
import { experimental_closeAllForTests, handleLine } from "./bridge.js";
import { PI_BRIDGE_ARGS_ENV, PI_BRIDGE_COMMAND_ENV } from "./rpc-child.js";
import { PI_BRIDGE_SESSION_DIR_ENV } from "./session-paths.js";

export const fakePiPath = fileURLToPath(
  new URL("./fake-pi-rpc.mjs", import.meta.url),
);

/** The execution options a full-mode thread runs with. */
export const FULL_PERMISSION_OPTIONS = {
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
} as const;

/** The handshake's request id; suites number their own requests from 1 or 1001. */
const INITIALIZE_ID = 100;
/** `startThread` numbers its requests from here, clear of any suite's own ids. */
const FIRST_HARNESS_REQUEST_ID = 1_000_000;
/** Longer than the kit's 15 s: every request here may cold-start a real child. */
/**
 * How long a request may take before the harness calls it unanswered. A
 * construction the bridge retries (up to eight spawns through the
 * transient-auth window, each a node child that imports the extension) runs
 * several seconds per attempt on a starved CI runner, and the bridge's own
 * readiness budget per attempt is a minute: the harness must outlive what
 * the bridge is still legitimately waiting for, or it reports a response
 * that was on its way as missing.
 */
const RESPONSE_DEADLINE_MS = 60_000;

const threadDeltaParamsSchema = z.object({
  threadId: z.string(),
  deltas: z.array(z.record(z.string(), z.unknown())),
});

export interface StartFakePiBridgeOptions {
  /** `mkdtemp` prefix of the workspace (a thread's cwd). */
  prefix: string;
  /** Where the fake keeps session files; `<workspace>/sessions` when omitted. */
  sessionDir?: (workspaceDir: string) => string;
  /** Send `initialize` before returning. The conformance kit sends its own. */
  initialize: boolean;
  /**
   * Have the fake record every child spawn and exit (`FAKE_PI_PROCESS_LOG`)
   * for `readProcessLog`; without it the fake keeps no process log.
   */
  processLog?: boolean;
}

export interface FakePiBridgeHarness {
  workspaceDir: string;
  sessionDir: string;
  /** Every JSON-RPC message the bridge wrote to stdout, in order. */
  messages: BridgeJsonRpcOutputMessage[];
  /** Every message since the last call: the conformance transport's drain. */
  takeMessages(): BridgeJsonRpcOutputMessage[];
  /** Send a request and wait for its response. */
  request(
    id: BridgeJsonRpcId,
    method: string,
    params: BridgeJsonRpcObject,
  ): Promise<BridgeJsonRpcOutputMessage>;
  /**
   * `thread/start` on the workspace in full mode (`extra` overrides and
   * extends the params), answered; the request id is the harness's own.
   */
  startThread(
    threadId: string,
    extra?: BridgeJsonRpcObject,
  ): Promise<BridgeJsonRpcOutputMessage>;
  /** The `thread/delta` payloads addressed to `threadId`, flattened in order. */
  deltasOf(threadId: string): Record<string, unknown>[];
  /** Poll until `predicate` holds; `what` names the wait in the timeout error. */
  waitFor(predicate: () => boolean, what: string): Promise<void>;
  /** Wait for a delta of `threadId` (from index `since`) matching `predicate`. */
  waitForDelta(
    threadId: string,
    predicate: (delta: Record<string, unknown>) => boolean,
    since?: number,
  ): Promise<void>;
  /**
   * Wait for a `turn.boundary` of `threadId` from delta index `since`;
   * resolves with the delta count, the `since` of the next wait.
   */
  waitForTurnBoundary(threadId: string, since?: number): Promise<number>;
  /** Wait for the first captured message matching `predicate`. */
  waitForMessage(
    predicate: (message: BridgeJsonRpcOutputMessage) => boolean,
    what: string,
  ): Promise<BridgeJsonRpcOutputMessage>;
  /** The pids the fake logged (`processLog: true`), by step. */
  readProcessLog(): { spawned: number[]; exited: number[] };
  /** End every child, restore stdout and the env, remove the workspace. */
  teardown(): Promise<void>;
}

export async function startFakePiBridge(
  options: StartFakePiBridgeOptions,
): Promise<FakePiBridgeHarness> {
  const workspaceDir = mkdtempSync(join(tmpdir(), options.prefix));
  const sessionDir =
    options.sessionDir === undefined
      ? join(workspaceDir, "sessions")
      : options.sessionDir(workspaceDir);
  const processLogPath = join(workspaceDir, "process.log");
  vi.stubEnv(PI_BRIDGE_COMMAND_ENV, process.execPath);
  vi.stubEnv(PI_BRIDGE_ARGS_ENV, JSON.stringify([fakePiPath]));
  vi.stubEnv(PI_BRIDGE_SESSION_DIR_ENV, sessionDir);
  if (options.processLog === true) {
    vi.stubEnv("FAKE_PI_PROCESS_LOG", processLogPath);
  }
  const harness = createBridgeJsonRpcTestHarness(handleLine);
  let nextHarnessRequestId = FIRST_HARNESS_REQUEST_ID;
  const bridge: FakePiBridgeHarness = {
    workspaceDir,
    sessionDir,
    messages: harness.messages,
    takeMessages: harness.takeMessages,
    async request(id, method, params) {
      harness.sendRequest(id, method, params);
      const deadline = Date.now() + RESPONSE_DEADLINE_MS;
      while (Date.now() < deadline) {
        const response = harness.messages.find((message) => message.id === id);
        if (response !== undefined) return response;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`no response to ${method}`);
    },
    startThread(threadId, extra = {}) {
      nextHarnessRequestId += 1;
      return bridge.request(nextHarnessRequestId, "thread/start", {
        threadId,
        cwd: workspaceDir,
        instructionMode: "append",
        options: FULL_PERMISSION_OPTIONS,
        ...extra,
      });
    },
    deltasOf(threadId) {
      return harness.messages
        .filter((message) => message.method === "thread/delta")
        .map((message) => threadDeltaParamsSchema.parse(message.params))
        .filter((params) => params.threadId === threadId)
        .flatMap((params) => params.deltas);
    },
    async waitFor(predicate, what) {
      const deadline = Date.now() + RESPONSE_DEADLINE_MS;
      while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`timed out waiting for ${what}`);
    },
    waitForDelta(threadId, predicate, since = 0) {
      return bridge.waitFor(
        () => bridge.deltasOf(threadId).slice(since).some(predicate),
        `a delta of ${threadId}`,
      );
    },
    async waitForTurnBoundary(threadId, since = 0) {
      await bridge.waitFor(
        () =>
          bridge
            .deltasOf(threadId)
            .slice(since)
            .some((delta) => delta.kind === "turn.boundary"),
        `the turn of ${threadId} to end`,
      );
      return bridge.deltasOf(threadId).length;
    },
    async waitForMessage(predicate, what) {
      await bridge.waitFor(() => harness.messages.some(predicate), what);
      const found = harness.messages.find(predicate);
      if (found === undefined) throw new Error(`timed out waiting for ${what}`);
      return found;
    },
    readProcessLog() {
      const lines = existsSync(processLogPath)
        ? readFileSync(processLogPath, "utf8").split("\n").filter(Boolean)
        : [];
      const spawned: number[] = [];
      const exited: number[] = [];
      for (const line of lines) {
        const [step, pid] = line.split(":");
        (step === "spawn" ? spawned : exited).push(Number(pid));
      }
      return { spawned, exited };
    },
    async teardown() {
      await experimental_closeAllForTests();
      harness.restore();
      vi.unstubAllEnvs();
      rmSync(workspaceDir, { recursive: true, force: true });
    },
  };
  if (options.initialize) {
    try {
      await bridge.request(INITIALIZE_ID, "initialize", {
        protocolVersion: 2,
        client: { name: "test", version: "0" },
        grammarVersions: [3, 3],
      });
    } catch (error) {
      await bridge.teardown();
      throw error;
    }
  }
  return bridge;
}
