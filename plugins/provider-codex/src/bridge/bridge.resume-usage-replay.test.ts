import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ThreadEvent } from "@bb/domain";
import {
  experimental_assembleCapturedThreadEvents as assembleCapturedThreadEvents,
  experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness,
} from "@get-bb/plugin-sdk/provider-bridge/testing";

import { handleLine } from "./bridge.js";

/**
 * Regression test for get-bb/bb#1727.
 *
 * `codex app-server` replays the rollout's last-turn token usage on
 * `thread/resume` (and `thread/fork`), scoped to that previous turn's Codex
 * turn id, before any new turn starts. The session starts with a reset
 * assembler id space, so the replayed usage would mint a bb turn id that bb
 * never saw a turn/started for, and the server would drop it as an orphan
 * thread-state snapshot.
 *
 * The bridge must instead drop the replayed (turn-only) token usage delta and
 * emit the replayed context-window usage so it assembles thread-scoped.
 */

const THREAD_ID = "thr_1727_resume_usage";
// The fake app-server replays usage on resume for `usage-replay-*` ids.
const PROVIDER_THREAD_ID = "usage-replay-1727";

const fakeAppServerPath = fileURLToPath(
  new URL("./fake-codex-app-server.mjs", import.meta.url),
);

const sessionOptions = {
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
} as const;

let harness: ReturnType<typeof createBridgeJsonRpcTestHarness>;
let workspaceDir: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-1727-ws-"));
  vi.stubEnv("BB_CODEX_BRIDGE_APP_SERVER_COMMAND", process.execPath);
  vi.stubEnv(
    "BB_CODEX_BRIDGE_APP_SERVER_ARGS",
    JSON.stringify([fakeAppServerPath]),
  );
  harness = createBridgeJsonRpcTestHarness(handleLine);
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

function assembledEvents(): ThreadEvent[] {
  return assembleCapturedThreadEvents(harness.messages, "codex");
}

// Assembler entropy is fresh per assembly pass, so ids are only comparable
// WITHIN one assembled snapshot; counts and scopes are stable across passes.
function threadEventsOfType(type: ThreadEvent["type"]): ThreadEvent[] {
  return assembledEvents().filter((event) => event.type === type);
}

function turnIdOf(event: { scope: { kind: string; turnId?: string } }) {
  if (event.scope.kind !== "turn" || event.scope.turnId === undefined) {
    throw new Error(`expected a turn-scoped event, got ${event.scope.kind}`);
  }
  return event.scope.turnId;
}

async function waitFor(predicate: () => boolean, label: string) {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

it("drops replayed token usage and thread-scopes replayed context usage on resume", async () => {
  // Session 1: resume + run one turn. The fake's first turn is `turn-fx-1`,
  // the same Codex turn id it replays usage for on the next resume — exactly
  // the live shape (last completed turn == replayed usage turn).
  harness.sendRequest(1, "thread/resume", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: { ...sessionOptions },
  });
  const resumed1 = await harness.waitForResponse(1);
  expect(resumed1.error).toBeUndefined();

  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    clientRequestId: "creq_a2b3c4d5e6",
    input: [{ type: "text", text: "Reply only with ok.", mentions: [] }],
    options: { ...sessionOptions },
  });
  await harness.waitForResponse(2);
  await waitFor(
    () => threadEventsOfType("turn/completed").length === 1,
    "session 1 turn/completed",
  );

  const session1Events = assembledEvents();
  const [turnStarted1] = session1Events.filter(
    (event) => event.type === "turn/started",
  );
  expect(turnStarted1).toBeDefined();
  const storedTurnId = turnIdOf(turnStarted1!); // what the server persisted
  // The live turn's own usage is turn-scoped to the turn bb stored.
  const liveUsage = session1Events.filter(
    (event) => event.type === "thread/tokenUsage/updated",
  );
  expect(liveUsage.length).toBeGreaterThan(0);
  expect(turnIdOf(liveUsage.at(-1)!)).toBe(storedTurnId);

  // Release the session (idle reap / archive / daemon restart all end here).
  harness.sendRequest(3, "thread/stop", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    intent: "release",
    activeTurnId: null,
  });
  await harness.waitForResponse(3);
  const usageCountBeforeResume = threadEventsOfType(
    "thread/tokenUsage/updated",
  ).length;
  const contextCountBeforeResume = threadEventsOfType(
    "thread/contextWindowUsage/updated",
  ).length;

  // Session 2: resume again. Codex replays the last turn's usage BEFORE any
  // new turn/started exists.
  harness.sendRequest(4, "thread/resume", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: { ...sessionOptions },
  });
  const resumed2 = await harness.waitForResponse(4);
  expect(resumed2.error).toBeUndefined();
  // No turn-scoped token usage is replayed for a turn this session never
  // started, and the replayed context-window usage arrives thread-scoped
  // (allowed by the scope policy) so the server stores it.
  await waitFor(
    () =>
      threadEventsOfType("thread/contextWindowUsage/updated").length >
      contextCountBeforeResume,
    "replayed context usage after resume",
  );
  expect(threadEventsOfType("thread/tokenUsage/updated").length).toBe(
    usageCountBeforeResume,
  );
  const replayedContext = threadEventsOfType(
    "thread/contextWindowUsage/updated",
  ).at(-1)!;
  expect(replayedContext.scope).toEqual({ kind: "thread" });
}, 30_000);

it("drops replayed token usage and thread-scopes replayed context usage on fork", async () => {
  // A native fork opens a new session for a new bb thread; codex replays the
  // SOURCE rollout's last-turn usage under the forked thread id, naming a
  // turn that neither this session nor bb ever started for that thread.
  harness.sendRequest(1, "thread/fork", {
    threadId: THREAD_ID,
    sourceProviderThreadId: PROVIDER_THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: { ...sessionOptions },
  });
  const forked = await harness.waitForResponse(1);
  expect(forked.error).toBeUndefined();
  const forkedProviderThreadId = (forked.result as { providerThreadId: string })
    .providerThreadId;

  await waitFor(
    () => threadEventsOfType("thread/contextWindowUsage/updated").length === 1,
    "replayed context usage after fork",
  );
  expect(threadEventsOfType("thread/tokenUsage/updated")).toHaveLength(0);
  expect(
    threadEventsOfType("thread/contextWindowUsage/updated")[0]!.scope,
  ).toEqual({
    kind: "thread",
  });

  // The forked thread's own first turn still reports turn-scoped usage.
  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId: forkedProviderThreadId,
    clientRequestId: "creq_fkr2k3d4e5",
    input: [{ type: "text", text: "Reply only with ok.", mentions: [] }],
    options: { ...sessionOptions },
  });
  const turnResponse = await harness.waitForResponse(2);
  expect(turnResponse.error).toBeUndefined();
  await waitFor(
    () => threadEventsOfType("turn/completed").length === 1,
    "fork turn/completed",
  );
  const forkEvents = assembledEvents();
  const [turnStarted] = forkEvents.filter(
    (event) => event.type === "turn/started",
  );
  const ownUsage = forkEvents.filter(
    (event) => event.type === "thread/tokenUsage/updated",
  );
  expect(ownUsage.length).toBeGreaterThan(0);
  expect(turnIdOf(ownUsage.at(-1)!)).toBe(turnIdOf(turnStarted!));
}, 30_000);
