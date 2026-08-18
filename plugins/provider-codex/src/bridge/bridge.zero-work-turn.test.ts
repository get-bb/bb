import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ThreadEvent } from "@bb/domain";
import { assembleCapturedThreadEvents } from "@bb/agent-runtime/test/bridge-delta-assembly";
import { createBridgeJsonRpcTestHarness } from "@bb/provider-bridge-protocol/testing";
import type { BridgeJsonRpcTestHarness } from "@bb/provider-bridge-protocol/testing";
import { handleLine } from "./bridge.js";

/**
 * The bridge settles a prompt the app-server accepts and finishes without
 * opening a turn — and only that. Settlement is owned by the queued turn-start
 * correlation, so a real `turn/started` that arrives AFTER the `turn/start`
 * response (the inverted order the fake's `/late-start` prompt produces) must
 * claim the dispatch first and leave exactly one real turn behind. Fabricating
 * a turn from a late signal is the ACP bug 0c2f4cc9a: a phantom active turn
 * blocks every later send.
 */

const THREAD_ID = "thr_zero_work_1";

const fakeAppServerPath = fileURLToPath(
  new URL("./fake-codex-app-server.mjs", import.meta.url),
);

const sessionOptions = {
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
} as const;

let harness: BridgeJsonRpcTestHarness;
let workspaceDir: string;

function threadEvents(): ThreadEvent[] {
  // The bridge emits thread/delta; run the whole capture through a fresh
  // assembler (the runtime adapter's exact translation) for canonical events.
  return assembleCapturedThreadEvents(harness.messages, "codex");
}

async function waitForEvents(
  predicate: (events: ThreadEvent[]) => boolean,
): Promise<ThreadEvent[]> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const events = threadEvents();
    if (predicate(events)) return events;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for thread events");
}

async function startSession(): Promise<string> {
  harness.sendRequest(1, "thread/start", {
    threadId: THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: { ...sessionOptions },
  });
  const response = await harness.waitForResponse(1);
  const providerThreadId = (
    response.result as { providerThreadId: string } | undefined
  )?.providerThreadId;
  if (typeof providerThreadId !== "string") {
    throw new Error(`thread/start failed: ${JSON.stringify(response)}`);
  }
  return providerThreadId;
}

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-zero-work-ws-"));
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
    providerThreadId: "zero-work-cleanup",
    intent: "release",
    activeTurnId: null,
  });
  await harness.waitForResponse(cleanupId).catch(() => undefined);
  harness.restore();
  vi.unstubAllEnvs();
  rmSync(workspaceDir, { recursive: true, force: true });
});

it("settles a prompt the app-server accepts without any turn activity", async () => {
  const providerThreadId = await startSession();
  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    input: [{ type: "text", text: "/clear", mentions: [] }],
    clientRequestId: "creq_zerwrk2345",
    options: { ...sessionOptions },
  });
  await harness.waitForResponse(2);

  const events = await waitForEvents((all) =>
    all.some((event) => event.type === "turn/completed"),
  );
  const started = events.filter((event) => event.type === "turn/started");
  const completed = events.filter((event) => event.type === "turn/completed");
  expect(started).toHaveLength(1);
  expect(completed).toHaveLength(1);
  const turnId =
    started[0]?.scope.kind === "turn" ? started[0].scope.turnId : "";
  expect(turnId).not.toBe("");
  expect(completed[0]).toMatchObject({
    status: "completed",
    scope: { kind: "turn", turnId },
  });
  // A synthetic turn is not a codex fork point.
  expect(completed[0]).not.toHaveProperty("providerCheckpointId");
  // The accepted input is acknowledged against the turn that settles it.
  expect(
    events.filter((event) => event.type === "turn/input/accepted"),
  ).toEqual([
    expect.objectContaining({
      clientRequestId: "creq_zerwrk2345",
      scope: { kind: "turn", turnId },
    }),
  ]);
}, 30_000);

it("lets a turn/started that lands after the turn/start response win the race", async () => {
  const providerThreadId = await startSession();
  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    input: [{ type: "text", text: "/late-start", mentions: [] }],
    clientRequestId: "creq_atestart23",
    options: { ...sessionOptions },
  });
  await harness.waitForResponse(2);

  const events = await waitForEvents((all) =>
    all.some((event) => event.type === "turn/completed"),
  );
  // Settle past the settlement grace window so a synthetic turn would show up.
  await new Promise((resolve) => setTimeout(resolve, 500));
  const settledEvents = threadEvents();

  expect(
    settledEvents.filter((event) => event.type === "turn/started"),
  ).toHaveLength(1);
  expect(
    settledEvents.filter((event) => event.type === "turn/completed"),
  ).toHaveLength(1);
  // The one turn is the provider's real turn: it carries the agent message.
  expect(
    settledEvents.some((event) => event.type === "item/agentMessage/delta"),
  ).toBe(true);
  expect(
    settledEvents.filter((event) => event.type === "turn/input/accepted"),
  ).toHaveLength(1);
  expect(events.length).toBeGreaterThan(0);
}, 30_000);
