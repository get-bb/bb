import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BRIDGE_NOTIFICATION_METHODS } from "@bb/provider-bridge-protocol";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import type { BridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { handleLine } from "./bridge.js";

/**
 * The codex bridge's own recovery: a terminal account error on a turn raises
 * an unsolicited `provider/recovery` hint (the runtime acts on the kind, never
 * on codex's wording) and marks the session so its next turn rebuilds the
 * app-server child from the rollout — codex caches credentials per process,
 * and that rebuild is how an external `codex login` takes effect. The rename
 * retry for a not-yet-flushed rollout lives here too: the runtime never
 * retries a rename.
 */

const THREAD_ID = "thr_codex_recovery_1";
const PROVIDER_THREAD_ID = "codex-recovery-session";

const fakeAppServerPath = fileURLToPath(
  new URL("./fake-codex-app-server.mjs", import.meta.url),
);

const sessionOptions = {
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
} as const;

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
  vi.stubEnv("BB_CODEX_BRIDGE_APP_SERVER_COMMAND", process.execPath);
  vi.stubEnv(
    "BB_CODEX_BRIDGE_APP_SERVER_ARGS",
    JSON.stringify([fakeAppServerPath, scriptPath]),
  );
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
    // The second turn runs on the rebuilt child; the cursor must follow.
    turnCursorPath: join(workspaceDir, "turn-cursor"),
  });
  harness = createBridgeJsonRpcTestHarness(handleLine);

  harness.sendRequest(1, "thread/resume", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: { ...sessionOptions },
  });
  expect((await harness.waitForResponse(1)).error).toBeUndefined();

  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    clientRequestId: "creq_cdxrcvry22",
    input: [{ type: "text", text: "first", mentions: [] }],
    options: { ...sessionOptions },
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
  // Unsolicited only: the hint rides no request, and the turn's own
  // provider.error row still carries the user-visible failure.
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
    options: { ...sessionOptions },
  });
  expect((await harness.waitForResponse(3)).error).toBeUndefined();

  // The next turn ran on a rebuilt child: the bridge announced the
  // replacement, and the scripted second turn answered on the new process.
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
  // One hint per failure, not one per turn.
  expect(
    notifications(BRIDGE_NOTIFICATION_METHODS.providerRecovery),
  ).toHaveLength(1);
}, 30_000);

it("retries a rename inside the bridge while the rollout is not ready", async () => {
  stubFakeAppServer({ renameEmptyRolloutFailures: 2 });
  harness = createBridgeJsonRpcTestHarness(handleLine);

  harness.sendRequest(1, "thread/resume", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: { ...sessionOptions },
  });
  expect((await harness.waitForResponse(1)).error).toBeUndefined();

  harness.sendRequest(2, "thread/name/set", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    title: "renamed while flushing",
  });
  const response = await harness.waitForResponse(2);
  // Two failures fit inside the 50/200 ms ladder; the final attempt succeeds
  // and the runtime sees one plain success.
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
    options: { ...sessionOptions },
  });
  expect((await harness.waitForResponse(1)).error).toBeUndefined();

  harness.sendRequest(2, "thread/name/set", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    title: "never flushed",
  });
  const response = await harness.waitForResponse(2);
  expect(response.error?.message).toMatch(/rollout at .+ is empty/);
  // A not-ready rollout is no recovery kind: plain error, no hint.
  expect(response.error?.data).toBeUndefined();
}, 30_000);
