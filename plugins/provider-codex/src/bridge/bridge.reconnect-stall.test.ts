import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BRIDGE_NOTIFICATION_METHODS } from "@get-bb/plugin-sdk/provider-bridge";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import type { BridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import {
  experimental_setReconnectStallTimeoutMsForTests as setReconnectStallTimeoutMs,
  handleLine,
} from "./bridge.js";
import {
  FULL_ACCESS_SESSION_OPTIONS,
  stubFakeCodexAppServer,
} from "./fake-codex-app-server-harness.js";

const THREAD_ID = "thr_codex_reconnect_stall";
const PROVIDER_THREAD_ID = "codex-reconnect-stall-session";
const STALL_TIMEOUT_MS = 300;

function poolRetryError(turnId: string, attempt: number) {
  return {
    method: "error",
    params: {
      threadId: "x",
      turnId,
      error: {
        message: `Reconnecting... ${attempt}/5`,
        additionalDetails:
          "unexpected status 502 Bad Gateway: Account Pooler could not reach ChatGPT., url: http://127.0.0.1:38886/api/v1/plugins/account-pool/http/v1/responses",
        codexErrorInfo: {
          responseStreamDisconnected: { httpStatusCode: 502 },
        },
      },
      willRetry: true,
    },
  };
}

const STALLED_TURN = [
  {
    method: "turn/started",
    params: { threadId: "x", turn: { id: "turn-stall", status: "inProgress" } },
  },
  poolRetryError("turn-stall", 1),
  poolRetryError("turn-stall", 2),
  poolRetryError("turn-stall", 3),
];

const RECOVERED_TURN = [
  {
    method: "turn/started",
    params: {
      threadId: "x",
      turn: { id: "turn-recovered", status: "inProgress" },
    },
  },
  poolRetryError("turn-recovered", 1),
  {
    method: "item/completed",
    params: {
      threadId: "x",
      turnId: "turn-recovered",
      item: { type: "agentMessage", id: "item-recovered", text: "still going" },
    },
  },
];

const OK_TURN = [
  {
    method: "turn/started",
    params: { threadId: "x", turn: { id: "turn-ok", status: "inProgress" } },
  },
  {
    method: "turn/completed",
    params: { threadId: "x", turn: { id: "turn-ok", status: "completed" } },
  },
];

interface DeltaShape {
  kind?: string;
  status?: string;
  providerTurnId?: string;
  message?: string;
  detail?: string;
  willRetry?: boolean;
  errorInfo?: { category?: string };
}

let harness: BridgeJsonRpcTestHarness;
let workspaceDir: string;

function stubFakeAppServer(turns: unknown[]): void {
  const scriptPath = join(workspaceDir, "fake-codex-script.json");
  writeFileSync(
    scriptPath,
    JSON.stringify({ turns, turnCursorPath: join(workspaceDir, "cursor") }),
    "utf8",
  );
  stubFakeCodexAppServer(scriptPath);
}

function notifications(method: string): unknown[] {
  return harness.messages
    .filter((message) => message.method === method)
    .map((message) => message.params);
}

function threadDeltas(): DeltaShape[] {
  return notifications("thread/delta").flatMap((params) => {
    const deltas = (params as { deltas?: DeltaShape[] } | undefined)?.deltas;
    return Array.isArray(deltas) ? deltas : [];
  });
}

async function waitForDelta(
  predicate: (delta: DeltaShape) => boolean,
): Promise<DeltaShape> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const found = threadDeltas().find(predicate);
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `Timed out waiting for delta; saw ${JSON.stringify(threadDeltas())}`,
  );
}

async function startTurn(id: number, text: string): Promise<void> {
  harness.sendRequest(id, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    clientRequestId: `creq_rcnstuckx${id}`,
    input: [{ type: "text", text, mentions: [] }],
    options: { ...FULL_ACCESS_SESSION_OPTIONS },
  });
  expect((await harness.waitForResponse(id)).error).toBeUndefined();
}

async function resumeThread(): Promise<void> {
  harness.sendRequest(1, "thread/resume", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: { ...FULL_ACCESS_SESSION_OPTIONS },
  });
  expect((await harness.waitForResponse(1)).error).toBeUndefined();
}

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-reconnect-stall-"));
  setReconnectStallTimeoutMs(STALL_TIMEOUT_MS);
});

afterEach(async () => {
  const cleanupId = 993_101;
  harness.sendRequest(cleanupId, "thread/stop", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    intent: "release",
    activeTurnId: null,
  });
  await harness.waitForResponse(cleanupId).catch(() => undefined);
  harness.restore();
  setReconnectStallTimeoutMs(null);
  vi.unstubAllEnvs();
  rmSync(workspaceDir, { recursive: true, force: true });
});

it("fails a turn left silent mid-reconnect and resumes the session for the next turn", async () => {
  stubFakeAppServer([STALLED_TURN, OK_TURN]);
  harness = createBridgeJsonRpcTestHarness(handleLine);
  await resumeThread();
  await startTurn(2, "stalls");

  const boundary = await waitForDelta(
    (delta) =>
      delta.kind === "turn.boundary" && delta.providerTurnId === "turn-stall",
  );
  expect(boundary.status).toBe("failed");
  const terminalErrors = threadDeltas().filter(
    (delta) => delta.kind === "provider.error" && delta.willRetry === false,
  );
  expect(terminalErrors).toEqual([
    expect.objectContaining({
      message: "Account pool unavailable",
      detail: expect.stringContaining("Reconnecting... 3/5"),
      providerTurnId: "turn-stall",
      errorInfo: expect.objectContaining({ category: "stream-disconnected" }),
    }),
  ]);

  await startTurn(3, "after stall");
  expect(notifications(BRIDGE_NOTIFICATION_METHODS.sessionReplaced)).toEqual([
    expect.objectContaining({
      threadId: THREAD_ID,
      providerThreadId: PROVIDER_THREAD_ID,
    }),
  ]);
  await waitForDelta(
    (delta) =>
      delta.kind === "turn.boundary" &&
      delta.providerTurnId === "turn-ok" &&
      delta.status === "completed",
  );
}, 30_000);

it("leaves a turn open once it makes progress after a reconnect", async () => {
  stubFakeAppServer([RECOVERED_TURN]);
  harness = createBridgeJsonRpcTestHarness(handleLine);
  await resumeThread();
  await startTurn(2, "recovers");

  await waitForDelta(
    (delta) =>
      delta.kind === "provider.error" &&
      delta.willRetry === true &&
      delta.providerTurnId === "turn-recovered",
  );
  await waitForDelta(
    (delta) => delta.kind === "item.close" || delta.kind === "item.open",
  );
  await new Promise((resolve) => setTimeout(resolve, STALL_TIMEOUT_MS * 3));

  expect(
    threadDeltas().filter(
      (delta) =>
        delta.kind === "turn.boundary" ||
        (delta.kind === "provider.error" && delta.willRetry === false),
    ),
  ).toEqual([]);
}, 30_000);
