import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BRIDGE_NOTIFICATION_METHODS } from "@get-bb/plugin-sdk/provider-bridge";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import type { BridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { handleLine } from "./bridge.js";
import {
  FULL_ACCESS_SESSION_OPTIONS,
  stubFakeCodexAppServer,
} from "./fake-codex-app-server-harness.js";

const THREAD_ID = "thr_codex_recovery_1";
const PROVIDER_THREAD_ID = "codex-recovery-session";

const UNAUTHORIZED_TURN = [
  {
    method: "turn/started",
    params: { threadId: "x", turn: { id: "turn-401", status: "inProgress" } },
  },
  {
    method: "error",
    params: {
      threadId: "x",
      turnId: "turn-401",
      error: {
        message: "unexpected status 401 Unauthorized: Missing bearer",
        codexErrorInfo: "unauthorized",
      },
      willRetry: false,
    },
  },
  {
    method: "turn/completed",
    params: { threadId: "x", turn: { id: "turn-401", status: "failed" } },
  },
];

function failedTurn(turnId: string, error: Record<string, unknown>) {
  return [
    {
      method: "turn/started",
      params: { threadId: "x", turn: { id: turnId, status: "inProgress" } },
    },
    {
      method: "error",
      params: { threadId: "x", turnId, error, willRetry: false },
    },
    {
      method: "turn/completed",
      params: { threadId: "x", turn: { id: turnId, status: "failed" } },
    },
  ];
}

const AWS_CREDENTIALS_TURN = failedTurn("turn-aws", {
  message:
    "stream disconnected before completion: failed to load AWS credentials: an error occurred while loading credentials",
  codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: null } },
});

const STREAM_DISCONNECTED_TURN = failedTurn("turn-stream", {
  message: "stream disconnected before completion: connection reset by peer",
  codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: null } },
});

const OK_TURN = [
  {
    method: "turn/started",
    params: { threadId: "x", turn: { id: "turn-ok", status: "inProgress" } },
  },
  {
    method: "item/completed",
    params: {
      threadId: "x",
      turnId: "turn-ok",
      item: { type: "agentMessage", id: "item-ok", text: "after reauth" },
    },
  },
  {
    method: "turn/completed",
    params: { threadId: "x", turn: { id: "turn-ok", status: "completed" } },
  },
];

let harness: BridgeJsonRpcTestHarness;
let workspaceDir: string;

function stubFakeAppServer(script: Record<string, unknown>): void {
  const scriptPath = join(workspaceDir, "fake-codex-script.json");
  writeFileSync(scriptPath, JSON.stringify(script), "utf8");
  stubFakeCodexAppServer(scriptPath);
}

function notifications(method: string): unknown[] {
  return harness.messages
    .filter((message) => message.method === method)
    .map((message) => message.params);
}

async function waitForNotification(
  method: string,
  predicate: (params: unknown) => boolean,
): Promise<unknown> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const found = notifications(method).find(predicate);
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `Timed out waiting for ${method}; saw ${JSON.stringify(notifications(method))}`,
  );
}

function threadDeltas(): unknown[] {
  return notifications("thread/delta").flatMap((params) => {
    const deltas = (params as { deltas?: unknown[] } | undefined)?.deltas;
    return Array.isArray(deltas) ? deltas : [];
  });
}

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-recovery-ws-"));
});

afterEach(async () => {
  const cleanupId = 993_001;
  harness.sendRequest(cleanupId, "thread/stop", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    intent: "release",
    activeTurnId: null,
  });
  await harness.waitForResponse(cleanupId).catch(() => undefined);
  harness.restore();
  vi.unstubAllEnvs();
  rmSync(workspaceDir, { recursive: true, force: true });
});

it("raises authRequired on a terminal 401 and rebuilds the child before the next turn", async () => {
  stubFakeAppServer({
    turns: [UNAUTHORIZED_TURN, OK_TURN],
    turnCursorPath: join(workspaceDir, "turn-cursor"),
  });
  harness = createBridgeJsonRpcTestHarness(handleLine);

  harness.sendRequest(1, "thread/resume", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: { ...FULL_ACCESS_SESSION_OPTIONS },
  });
  expect((await harness.waitForResponse(1)).error).toBeUndefined();

  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    clientRequestId: "creq_cdxrcvry22",
    input: [{ type: "text", text: "first", mentions: [] }],
    options: { ...FULL_ACCESS_SESSION_OPTIONS },
  });
  expect((await harness.waitForResponse(2)).error).toBeUndefined();

  const hint = await waitForNotification(
    BRIDGE_NOTIFICATION_METHODS.providerRecovery,
    () => true,
  );
  expect(hint).toEqual({
    threadId: THREAD_ID,
    kind: "authRequired",
    message: expect.stringContaining("401 Unauthorized"),
    retryable: false,
  });
  expect(
    threadDeltas().filter(
      (delta) => (delta as { kind?: string }).kind === "provider.error",
    ),
  ).toHaveLength(1);
  expect(notifications(BRIDGE_NOTIFICATION_METHODS.sessionReplaced)).toEqual(
    [],
  );

  harness.sendRequest(3, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    clientRequestId: "creq_cdxrcvry23",
    input: [{ type: "text", text: "after reauth", mentions: [] }],
    options: { ...FULL_ACCESS_SESSION_OPTIONS },
  });
  expect((await harness.waitForResponse(3)).error).toBeUndefined();

  const replaced = notifications(BRIDGE_NOTIFICATION_METHODS.sessionReplaced);
  expect(replaced).toEqual([
    expect.objectContaining({
      threadId: THREAD_ID,
      providerThreadId: PROVIDER_THREAD_ID,
      reason: expect.stringContaining("authentication failure"),
      contextLost: false,
    }),
  ]);
  await waitForNotification("thread/delta", (params) => {
    const deltas = (params as { deltas?: unknown[] }).deltas ?? [];
    return deltas.some(
      (delta) =>
        (delta as { kind?: string; status?: string }).kind ===
          "turn.boundary" &&
        (delta as { status?: string }).status === "completed",
    );
  });
  expect(
    notifications(BRIDGE_NOTIFICATION_METHODS.providerRecovery),
  ).toHaveLength(1);
}, 30_000);

async function waitForTerminalTurnBoundaries(count: number): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const terminal = threadDeltas().filter(
      (delta) =>
        (delta as { kind?: string }).kind === "turn.boundary" &&
        (delta as { status?: string }).status !== "started",
    );
    if (terminal.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${count} terminal turn boundaries`);
}

async function resumeAndRunTurns(texts: string[]): Promise<void> {
  harness = createBridgeJsonRpcTestHarness(handleLine);
  harness.sendRequest(1, "thread/resume", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: { ...FULL_ACCESS_SESSION_OPTIONS },
  });
  expect((await harness.waitForResponse(1)).error).toBeUndefined();
  for (const [index, text] of texts.entries()) {
    const requestId = index + 2;
    harness.sendRequest(requestId, "turn/start", {
      threadId: THREAD_ID,
      providerThreadId: PROVIDER_THREAD_ID,
      clientRequestId: `creq_cdxawscrd${index + 2}`,
      input: [{ type: "text", text, mentions: [] }],
      options: { ...FULL_ACCESS_SESSION_OPTIONS },
    });
    expect((await harness.waitForResponse(requestId)).error).toBeUndefined();
    await waitForTerminalTurnBoundaries(index + 1);
  }
}

it("rebuilds the child after a stream disconnect caused by failing to load AWS credentials", async () => {
  stubFakeAppServer({
    turns: [AWS_CREDENTIALS_TURN, OK_TURN],
    turnCursorPath: join(workspaceDir, "turn-cursor"),
  });
  await resumeAndRunTurns(["first", "after credentials refresh"]);

  expect(notifications(BRIDGE_NOTIFICATION_METHODS.providerRecovery)).toEqual([
    {
      threadId: THREAD_ID,
      kind: "authRequired",
      message: expect.stringContaining("failed to load AWS credentials"),
      retryable: false,
    },
  ]);
  expect(notifications(BRIDGE_NOTIFICATION_METHODS.sessionReplaced)).toEqual([
    expect.objectContaining({
      threadId: THREAD_ID,
      providerThreadId: PROVIDER_THREAD_ID,
      reason: expect.stringContaining("failed to load provider credentials"),
      contextLost: false,
    }),
  ]);
}, 30_000);

it("does not rebuild the child after an ordinary stream disconnect", async () => {
  stubFakeAppServer({
    turns: [STREAM_DISCONNECTED_TURN, OK_TURN],
    turnCursorPath: join(workspaceDir, "turn-cursor"),
  });
  await resumeAndRunTurns(["first", "second"]);

  expect(notifications(BRIDGE_NOTIFICATION_METHODS.providerRecovery)).toEqual(
    [],
  );
  expect(notifications(BRIDGE_NOTIFICATION_METHODS.sessionReplaced)).toEqual(
    [],
  );
}, 30_000);

it("retries a rename inside the bridge while the rollout is not ready", async () => {
  stubFakeAppServer({ renameEmptyRolloutFailures: 2 });
  harness = createBridgeJsonRpcTestHarness(handleLine);

  harness.sendRequest(1, "thread/resume", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: { ...FULL_ACCESS_SESSION_OPTIONS },
  });
  expect((await harness.waitForResponse(1)).error).toBeUndefined();

  harness.sendRequest(2, "thread/name/set", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    title: "renamed while flushing",
  });
  const response = await harness.waitForResponse(2);
  expect(response.error).toBeUndefined();
  expect(response.result).toEqual({ ok: true });
}, 30_000);

it("fails a rename with a plain error once the ladder is exhausted", async () => {
  stubFakeAppServer({ renameEmptyRolloutFailures: 3 });
  harness = createBridgeJsonRpcTestHarness(handleLine);

  harness.sendRequest(1, "thread/resume", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: { ...FULL_ACCESS_SESSION_OPTIONS },
  });
  expect((await harness.waitForResponse(1)).error).toBeUndefined();

  harness.sendRequest(2, "thread/name/set", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    title: "never flushed",
  });
  const response = await harness.waitForResponse(2);
  expect(response.error?.message).toMatch(/rollout at .+ is empty/);
  expect(response.error?.data).toBeUndefined();
}, 30_000);
