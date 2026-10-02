import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PromptInput } from "@get-bb/plugin-sdk/provider-bridge";
import {
  experimental_assembleCapturedThreadEvents as assembleCapturedThreadEvents,
  experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness,
} from "@get-bb/plugin-sdk/provider-bridge/testing";
import type {
  BridgeJsonRpcTestHarness,
  ThreadEvent,
} from "@get-bb/plugin-sdk/provider-bridge/testing";

import { handleLine } from "./bridge.js";
import {
  FULL_ACCESS_SESSION_OPTIONS,
  stubFakeCodexAppServer,
} from "./fake-codex-app-server-harness.js";

const THREAD_ID = "thr_zero_work_1";

let harness: BridgeJsonRpcTestHarness;
let workspaceDir: string;

function compactCommandInput(): PromptInput[] {
  return [
    {
      type: "text",
      text: "/compact",
      mentions: [
        {
          start: 0,
          end: "/compact".length,
          resource: {
            kind: "command",
            trigger: "/",
            name: "compact",
            source: "command",
            origin: "builtin",
            label: "compact",
            argumentHint: null,
          },
        },
      ],
    },
  ];
}

function threadEvents(): ThreadEvent[] {
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
    options: { ...FULL_ACCESS_SESSION_OPTIONS },
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
  stubFakeCodexAppServer();
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
    options: { ...FULL_ACCESS_SESSION_OPTIONS },
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
  expect(completed[0]).not.toHaveProperty("providerCheckpointId");
  expect(
    events.filter((event) => event.type === "turn/input/accepted"),
  ).toEqual([
    expect.objectContaining({
      clientRequestId: "creq_zerwrk2345",
      scope: { kind: "turn", turnId },
    }),
  ]);
}, 30_000);

it("preserves the native checkpoint when thread/stop interrupts a turn", async () => {
  const providerThreadId = await startSession();
  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    input: [{ type: "text", text: "/wait-for-interrupt", mentions: [] }],
    clientRequestId: "creq_a2b3c4d5e6",
    options: { ...FULL_ACCESS_SESSION_OPTIONS },
  });
  await harness.waitForResponse(2);
  await waitForEvents((events) =>
    events.some((event) => event.type === "turn/started"),
  );

  harness.sendRequest(3, "thread/stop", {
    threadId: THREAD_ID,
    providerThreadId,
    intent: "interrupt",
    activeTurnId: "turn-fx-1",
  });
  await harness.waitForResponse(3);

  const events = await waitForEvents((all) =>
    all.some(
      (event) =>
        event.type === "turn/completed" && event.status === "interrupted",
    ),
  );
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "turn/completed",
      status: "interrupted",
      providerCheckpointId: "turn-fx-1",
    }),
  );
}, 30_000);

it("keeps one lifecycle when turn/started lags the turn/start response past the grace window", async () => {
  const providerThreadId = await startSession();
  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    input: [{ type: "text", text: "/late-start", mentions: [] }],
    clientRequestId: "creq_atestart23",
    options: { ...FULL_ACCESS_SESSION_OPTIONS },
  });
  await harness.waitForResponse(2);

  const events = await waitForEvents((all) =>
    all.some((event) => event.type === "turn/completed"),
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  const settledEvents = threadEvents();

  const started = settledEvents.filter(
    (event) => event.type === "turn/started",
  );
  const completed = settledEvents.filter(
    (event) => event.type === "turn/completed",
  );
  expect(started).toHaveLength(1);
  expect(completed).toHaveLength(1);
  const turnId =
    started[0]?.scope.kind === "turn" ? started[0].scope.turnId : "";
  expect(turnId).not.toBe("");
  expect(completed[0]).toMatchObject({
    status: "completed",
    providerCheckpointId: "turn-fx-1",
    scope: { kind: "turn", turnId },
  });
  expect(
    settledEvents.some((event) => event.type === "item/agentMessage/delta"),
  ).toBe(true);
  expect(
    settledEvents.filter((event) => event.type === "turn/input/accepted"),
  ).toEqual([
    expect.objectContaining({
      clientRequestId: "creq_atestart23",
      scope: { kind: "turn", turnId },
    }),
  ]);
  expect(events.length).toBeGreaterThan(0);
}, 30_000);

it("settles a response-proved turn as failed when codex dies before turn/started", async () => {
  const providerThreadId = await startSession();
  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    input: [{ type: "text", text: "/respond-then-exit", mentions: [] }],
    clientRequestId: "creq_dies234567",
    options: { ...FULL_ACCESS_SESSION_OPTIONS },
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
    status: "failed",
    scope: { kind: "turn", turnId },
  });
  expect(
    events.filter((event) => event.type === "turn/input/accepted"),
  ).toEqual([
    expect.objectContaining({
      clientRequestId: "creq_dies234567",
      scope: { kind: "turn", turnId },
    }),
  ]);
}, 30_000);

it("settles a turn the turn/start response reports as already completed", async () => {
  const providerThreadId = await startSession();
  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    input: [{ type: "text", text: "/respond-completed", mentions: [] }],
    clientRequestId: "creq_instdn2345",
    options: { ...FULL_ACCESS_SESSION_OPTIONS },
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
    providerCheckpointId: "turn-fx-1",
    scope: { kind: "turn", turnId },
  });
  expect(
    events.filter((event) => event.type === "turn/input/accepted"),
  ).toEqual([
    expect.objectContaining({
      clientRequestId: "creq_instdn2345",
      scope: { kind: "turn", turnId },
    }),
  ]);
}, 30_000);

it("acknowledges a dispatch codex steers into the already-running turn", async () => {
  const providerThreadId = await startSession();
  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    input: [{ type: "text", text: "/wait-for-interrupt", mentions: [] }],
    clientRequestId: "creq_first23456",
    options: { ...FULL_ACCESS_SESSION_OPTIONS },
  });
  await harness.waitForResponse(2);
  await waitForEvents((events) =>
    events.some((event) => event.type === "turn/started"),
  );

  harness.sendRequest(3, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    input: [{ type: "text", text: "/steer-into-active", mentions: [] }],
    clientRequestId: "creq_steer23456",
    options: { ...FULL_ACCESS_SESSION_OPTIONS },
  });
  await harness.waitForResponse(3);
  const events = await waitForEvents(
    (all) =>
      all.filter((event) => event.type === "turn/input/accepted").length === 2,
  );

  const started = events.filter((event) => event.type === "turn/started");
  expect(started).toHaveLength(1);
  const turnId =
    started[0]?.scope.kind === "turn" ? started[0].scope.turnId : "";
  expect(turnId).not.toBe("");
  expect(
    events.filter((event) => event.type === "turn/input/accepted"),
  ).toEqual([
    expect.objectContaining({
      clientRequestId: "creq_first23456",
      scope: { kind: "turn", turnId },
    }),
    expect.objectContaining({
      clientRequestId: "creq_steer23456",
      scope: { kind: "turn", turnId },
    }),
  ]);
  expect(events.filter((event) => event.type === "turn/completed")).toEqual([]);

  harness.sendRequest(4, "thread/stop", {
    threadId: THREAD_ID,
    providerThreadId,
    intent: "interrupt",
    activeTurnId: "turn-fx-1",
  });
  await harness.waitForResponse(4);
  await waitForEvents((all) =>
    all.some(
      (event) =>
        event.type === "turn/completed" && event.status === "interrupted",
    ),
  );
}, 30_000);

it("does not resurrect a response-opened turn settled before its turn/started arrives", async () => {
  const providerThreadId = await startSession();
  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    input: [{ type: "text", text: "/interrupt-before-start", mentions: [] }],
    clientRequestId: "creq_prestart23",
    options: { ...FULL_ACCESS_SESSION_OPTIONS },
  });
  await harness.waitForResponse(2);
  await waitForEvents((events) =>
    events.some((event) => event.type === "turn/started"),
  );

  harness.sendRequest(3, "thread/stop", {
    threadId: THREAD_ID,
    providerThreadId,
    intent: "interrupt",
    activeTurnId: "turn-fx-1",
  });
  await harness.waitForResponse(3);
  await new Promise((resolve) => setTimeout(resolve, 200));

  const events = threadEvents();
  const started = events.filter((event) => event.type === "turn/started");
  expect(started).toHaveLength(1);
  const turnId =
    started[0]?.scope.kind === "turn" ? started[0].scope.turnId : "";
  expect(turnId).not.toBe("");
  const completed = events.filter((event) => event.type === "turn/completed");
  expect(completed).toHaveLength(1);
  expect(completed[0]).toMatchObject({
    status: "interrupted",
    scope: { kind: "turn", turnId },
  });
  expect(
    events.filter((event) => event.type === "turn/input/accepted"),
  ).toEqual([
    expect.objectContaining({
      clientRequestId: "creq_prestart23",
      scope: { kind: "turn", turnId },
    }),
  ]);
}, 30_000);

it("interrupts a response-opened turn once codex reports it started", async () => {
  const providerThreadId = await startSession();
  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    input: [{ type: "text", text: "/late-start-interruptible", mentions: [] }],
    clientRequestId: "creq_ntrptate23",
    options: { ...FULL_ACCESS_SESSION_OPTIONS },
  });
  await harness.waitForResponse(2);
  await waitForEvents((events) =>
    events.some((event) => event.type === "turn/started"),
  );

  harness.sendRequest(3, "thread/stop", {
    threadId: THREAD_ID,
    providerThreadId,
    intent: "interrupt",
    activeTurnId: "turn-fx-1",
  });
  const stopped = await harness.waitForResponse(3);
  expect(stopped.error).toBeUndefined();

  const events = await waitForEvents((all) =>
    all.some((event) => event.type === "turn/completed"),
  );
  expect(events.filter((event) => event.type === "turn/started")).toHaveLength(
    1,
  );
  expect(events.filter((event) => event.type === "turn/completed")).toEqual([
    expect.objectContaining({ status: "interrupted" }),
  ]);
}, 30_000);

async function compactAndWaitForCompletion(
  clientRequestId: string,
): Promise<ThreadEvent[]> {
  const providerThreadId = await startSession();
  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    input: compactCommandInput(),
    clientRequestId,
    options: { ...FULL_ACCESS_SESSION_OPTIONS },
  });
  const response = await harness.waitForResponse(2);
  expect(response.error).toBeUndefined();
  await waitForEvents((all) =>
    all.some((event) => event.type === "turn/completed"),
  );
  await new Promise((resolve) => setTimeout(resolve, 400));
  return threadEvents();
}

it("waits for a compaction turn that starts long after the empty compact response", async () => {
  vi.stubEnv("FAKE_CODEX_COMPACTION_TURN_DELAY_MS", "600");
  const events = await compactAndWaitForCompletion("creq_cmpktate23");

  const started = events.filter((event) => event.type === "turn/started");
  const completed = events.filter((event) => event.type === "turn/completed");
  expect(started).toHaveLength(1);
  expect(completed).toHaveLength(1);
  const turnId =
    started[0]?.scope.kind === "turn" ? started[0].scope.turnId : "";
  expect(turnId).not.toMatch(/zero-work/);
  expect(completed[0]).toMatchObject({
    status: "completed",
    scope: { kind: "turn", turnId },
  });
  expect(
    events.filter((event) => event.type === "turn/input/accepted"),
  ).toEqual([
    expect.objectContaining({
      clientRequestId: "creq_cmpktate23",
      scope: { kind: "turn", turnId },
    }),
  ]);
}, 30_000);

it("settles a compaction when codex reports the thread idle without starting a turn", async () => {
  vi.stubEnv("FAKE_CODEX_COMPACTION_MODE", "idle-without-turn");
  const events = await compactAndWaitForCompletion("creq_cmpktdey23");

  const completed = events.filter((event) => event.type === "turn/completed");
  expect(events.filter((event) => event.type === "turn/started")).toHaveLength(
    1,
  );
  expect(completed).toEqual([expect.objectContaining({ status: "completed" })]);
  expect(
    events.filter((event) => event.type === "turn/input/accepted"),
  ).toEqual([expect.objectContaining({ clientRequestId: "creq_cmpktdey23" })]);
}, 30_000);

it("fails a compaction when the app-server exits before its turn starts", async () => {
  vi.stubEnv("FAKE_CODEX_COMPACTION_MODE", "exit-before-turn");
  const events = await compactAndWaitForCompletion("creq_cmpktext23");

  expect(events.filter((event) => event.type === "turn/completed")).toEqual([
    expect.objectContaining({ status: "failed" }),
  ]);
  expect(
    events.filter((event) => event.type === "turn/input/accepted"),
  ).toEqual([expect.objectContaining({ clientRequestId: "creq_cmpktext23" })]);
}, 30_000);

it.each([
  { code: -32603, message: "interrupt storage failure" },
  { code: -32603, message: "no active turn to interrupt" },
])(
  "does not retry an unrelated interrupt rejection $code $message",
  async (error) => {
    const requestLogPath = join(workspaceDir, "requests.jsonl");
    const scriptPath = join(workspaceDir, "script.json");
    writeFileSync(
      scriptPath,
      JSON.stringify({ requestLogPath, interruptError: error }),
    );
    stubFakeCodexAppServer(scriptPath);
    const providerThreadId = await startSession();
    harness.sendRequest(2, "turn/start", {
      threadId: THREAD_ID,
      providerThreadId,
      input: [
        { type: "text", text: "/late-start-interruptible", mentions: [] },
      ],
      clientRequestId: "creq_nretry2345",
      options: { ...FULL_ACCESS_SESSION_OPTIONS },
    });
    expect((await harness.waitForResponse(2)).error).toBeUndefined();
    await waitForEvents((events) =>
      events.some((event) => event.type === "turn/started"),
    );
    harness.sendRequest(3, "thread/stop", {
      threadId: THREAD_ID,
      providerThreadId,
      intent: "interrupt",
      activeTurnId: "turn-fx-1",
    });
    const stopped = await harness.waitForResponse(3);
    expect(stopped.error).toMatchObject({ message: error.message });
    expect(
      readFileSync(requestLogPath, "utf8")
        .split("\n")
        .filter((line) => line.includes('"method":"turn/interrupt"')),
    ).toHaveLength(1);
    expect(
      threadEvents().filter((event) => event.type === "turn/completed"),
    ).toHaveLength(0);
  },
);

it.each([
  "idle-before-response",
  "error-before-response",
  "error-without-turn",
])(
  "settles compaction on %s",
  async (mode) => {
    vi.stubEnv("FAKE_CODEX_COMPACTION_MODE", mode);
    const events = await compactAndWaitForCompletion("creq_cmpkrace23");
    expect(
      events.filter((event) => event.type === "turn/started"),
    ).toHaveLength(1);
    expect(events.filter((event) => event.type === "turn/completed")).toEqual([
      expect.objectContaining({
        status: mode.startsWith("idle") ? "completed" : "failed",
      }),
    ]);
    expect(
      events.filter((event) => event.type === "turn/input/accepted"),
    ).toEqual([
      expect.objectContaining({ clientRequestId: "creq_cmpkrace23" }),
    ]);
  },
  30_000,
);

it.each([
  {
    name: "native activation before stop",
    delay: 450,
    script: {},
    attempts: 1,
    succeeds: false,
  },
  {
    name: "native activation before rejection",
    delay: 0,
    script: { startBeforeInterruptError: true },
    attempts: 2,
    succeeds: true,
  },
  {
    name: "second rejection",
    delay: 0,
    script: { interruptErrorCount: 2 },
    attempts: 2,
    succeeds: false,
  },
  {
    name: "completion before rejection",
    delay: 0,
    script: { settleBeforeInterruptError: true },
    attempts: 1,
    succeeds: true,
  },
  {
    name: "activation timeout",
    delay: 0,
    script: { neverStart: true },
    attempts: 1,
    succeeds: false,
  },
])(
  "bounds interrupt retry for $name",
  async ({ delay, script, attempts, succeeds }) => {
    const requestLogPath = join(workspaceDir, "requests.jsonl");
    const scriptPath = join(workspaceDir, "script.json");
    writeFileSync(
      scriptPath,
      JSON.stringify({
        requestLogPath,
        interruptError: {
          code: -32600,
          message: "no active turn to interrupt",
        },
        ...script,
      }),
    );
    stubFakeCodexAppServer(scriptPath);
    const providerThreadId = await startSession();
    harness.sendRequest(2, "turn/start", {
      threadId: THREAD_ID,
      providerThreadId,
      input: [
        { type: "text", text: "/late-start-interruptible", mentions: [] },
      ],
      clientRequestId: "creq_bnded23456",
      options: { ...FULL_ACCESS_SESSION_OPTIONS },
    });
    expect((await harness.waitForResponse(2)).error).toBeUndefined();
    await waitForEvents((events) =>
      events.some((event) => event.type === "turn/started"),
    );
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    harness.sendRequest(3, "thread/stop", {
      threadId: THREAD_ID,
      providerThreadId,
      intent: "interrupt",
      activeTurnId: "turn-fx-1",
    });
    const stopped = await harness.waitForResponse(3);
    if (succeeds) {
      expect(stopped.error).toBeUndefined();
    } else {
      expect(stopped.error).toMatchObject({
        message: "no active turn to interrupt",
      });
      expect(
        threadEvents().filter((event) => event.type === "turn/completed"),
      ).toHaveLength(0);
    }
    expect(
      readFileSync(requestLogPath, "utf8")
        .split("\n")
        .filter((line) => line.includes('"method":"turn/interrupt"')),
    ).toHaveLength(attempts);
  },
  20_000,
);

it("binds delayed tool work to the accepted request on consecutive turns", async () => {
  const scriptPath = join(workspaceDir, "script.json");
  writeFileSync(scriptPath, JSON.stringify({ lateStartTool: true }));
  stubFakeCodexAppServer(scriptPath);
  const providerThreadId = await startSession();
  const requests = ["creq_first23456", "creq_after23456"];
  for (const [index, clientRequestId] of requests.entries()) {
    harness.sendRequest(index + 2, "turn/start", {
      threadId: THREAD_ID,
      providerThreadId,
      clientRequestId,
      input: [{ type: "text", text: "/late-start", mentions: [] }],
      options: { ...FULL_ACCESS_SESSION_OPTIONS },
    });
    expect((await harness.waitForResponse(index + 2)).error).toBeUndefined();
    await waitForEvents(
      (events) =>
        events.filter((event) => event.type === "turn/completed").length ===
        index + 1,
    );
  }
  const events = threadEvents();
  expect(events.filter((event) => event.type === "turn/started")).toHaveLength(
    2,
  );
  const work = events.filter(
    (event) =>
      event.type === "item/started" && event.item.type === "commandExecution",
  );
  expect(work).toHaveLength(2);
  for (const [index, item] of work.entries()) {
    const accepted = events.find(
      (event) =>
        event.type === "turn/input/accepted" &&
        event.clientRequestId === requests[index],
    );
    expect(accepted).toBeDefined();
    if (accepted === undefined) throw new Error("Missing accepted input");
    expect(accepted.scope).toEqual(item.scope);
    expect(events.indexOf(accepted)).toBeLessThan(events.indexOf(item));
  }
});

it("does not acknowledge a rejected compaction after an early idle status", async () => {
  vi.stubEnv("FAKE_CODEX_COMPACTION_MODE", "idle-before-rejection");
  const providerThreadId = await startSession();
  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    input: compactCommandInput(),
    clientRequestId: "creq_reject2345",
    options: { ...FULL_ACCESS_SESSION_OPTIONS },
  });
  expect((await harness.waitForResponse(2)).error).toMatchObject({
    message: "compaction rejected",
  });
  expect(
    threadEvents().filter(
      (event) =>
        event.type === "turn/started" ||
        event.type === "turn/input/accepted" ||
        event.type === "turn/completed",
    ),
  ).toEqual([]);
});
