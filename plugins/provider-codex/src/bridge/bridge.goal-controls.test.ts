import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { z } from "zod";
import { handleLine } from "./bridge.js";
import {
  FULL_ACCESS_SESSION_OPTIONS,
  NO_SESSION_SETTINGS_CHANGE,
  stubFakeCodexAppServer,
} from "./fake-codex-app-server-harness.js";

const THREAD_ID = "thr_goal_pause";

const recordedRequestSchema = z.object({
  method: z.string(),
  params: z.record(z.string(), z.unknown()),
});

const deltaSchema = z.record(z.string(), z.unknown());

let harness: ReturnType<typeof createBridgeJsonRpcTestHarness>;
let workspaceDir: string;
let requestLogPath: string;
let scriptPath: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-goal-controls-"));
  requestLogPath = join(workspaceDir, "requests.jsonl");
  scriptPath = join(workspaceDir, "script.json");
});

afterEach(async () => {
  const cleanupId = 991_002;
  harness.sendRequest(cleanupId, "thread/stop", {
    threadId: THREAD_ID,
    providerThreadId: "goal-controls-cleanup",
    intent: "release",
    activeTurnId: null,
  });
  await harness.waitForResponse(cleanupId).catch(() => undefined);
  harness.restore();
  vi.unstubAllEnvs();
  rmSync(workspaceDir, { recursive: true, force: true });
});

function recordedRequests() {
  return readFileSync(requestLogPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => recordedRequestSchema.parse(JSON.parse(line)));
}

function deltasSent() {
  return harness.messages.flatMap((message) =>
    message.method === "thread/delta"
      ? z.object({ deltas: z.array(deltaSchema) }).parse(message.params).deltas
      : [],
  );
}

function goalStatesSent() {
  return deltasSent().flatMap((delta) =>
    delta.kind === "extension.state" &&
    delta.extensionKind === "provider-codex/goal"
      ? [z.object({ status: z.string() }).parse(delta.payload).status]
      : [],
  );
}

function acceptedTurnIdFor(clientRequestId: string) {
  const accepted = deltasSent().find(
    (delta) =>
      delta.kind === "input.accepted" &&
      delta.clientRequestId === clientRequestId,
  );
  return accepted === undefined
    ? undefined
    : z.string().parse(accepted.providerTurnId);
}

async function startThread(
  initialGoalStatus: string | null,
  script: Record<string, unknown> = {},
) {
  writeFileSync(
    scriptPath,
    JSON.stringify({
      requestLogPath,
      steerRequiresActiveTurn: true,
      ...script,
      ...(initialGoalStatus === null ? {} : { initialGoalStatus }),
    }),
  );
  stubFakeCodexAppServer(scriptPath);
  harness = createBridgeJsonRpcTestHarness(handleLine);
  harness.sendRequest(1, "thread/start", {
    threadId: THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: FULL_ACCESS_SESSION_OPTIONS,
  });
  const started = await harness.waitForResponse(1);
  const { providerThreadId } = z
    .object({ providerThreadId: z.string() })
    .parse(started.result);
  if (initialGoalStatus !== null) {
    await vi.waitFor(() =>
      expect(goalStatesSent()).toEqual([initialGoalStatus]),
    );
  }
  return providerThreadId;
}

function sendUserTurn(
  providerThreadId: string,
  requestId: number,
  clientRequestId: string,
  text: string,
) {
  harness.sendRequest(requestId, "turn/start", {
    apply: NO_SESSION_SETTINGS_CHANGE,
    threadId: THREAD_ID,
    providerThreadId,
    clientRequestId,
    input: [{ type: "text", text, mentions: [] }],
    options: FULL_ACCESS_SESSION_OPTIONS,
  });
  return harness.waitForResponse(requestId);
}

async function stopRunningTurn(providerThreadId: string) {
  const started = await sendUserTurn(
    providerThreadId,
    2,
    "creq_gapause2zz",
    "/wait-for-interrupt",
  );
  expect(started.error).toBeUndefined();
  harness.sendRequest(3, "thread/stop", {
    threadId: THREAD_ID,
    providerThreadId,
    intent: "interrupt",
    activeTurnId: "turn-fx-1",
  });
  expect((await harness.waitForResponse(3)).error).toBeUndefined();
}

function goalSetParams() {
  return recordedRequests()
    .filter((request) => request.method === "thread/goal/set")
    .map((request) => request.params);
}

it("pauses an active goal before interrupting the turn so a later resume cannot continue it", async () => {
  const providerThreadId = await startThread("active");

  await stopRunningTurn(providerThreadId);

  const methods = recordedRequests().map((request) => request.method);
  expect(methods.indexOf("thread/goal/set")).toBeGreaterThanOrEqual(0);
  expect(methods.indexOf("thread/goal/set")).toBeLessThan(
    methods.indexOf("turn/interrupt"),
  );
  expect(goalSetParams()).toEqual([
    { threadId: providerThreadId, origin: "user", status: "paused" },
  ]);
  expect(goalStatesSent()[0]).toBe("active");
  expect(goalStatesSent().at(-1)).toBe("paused");
});

it("leaves a thread without an active goal alone when stopping it", async () => {
  const providerThreadId = await startThread("complete");

  await stopRunningTurn(providerThreadId);

  expect(goalSetParams()).toEqual([]);
  expect(goalStatesSent()).toEqual(["complete"]);
});

function acceptedBeforeResponse(clientRequestId: string, requestId: number) {
  const acceptedIndex = harness.messages.findIndex(
    (message) =>
      message.method === "thread/delta" &&
      JSON.stringify(message.params).includes(
        `"clientRequestId":"${clientRequestId}"`,
      ),
  );
  const responseIndex = harness.messages.findIndex(
    (message) => message.id === requestId && message.method === undefined,
  );
  return acceptedIndex !== -1 && acceptedIndex < responseIndex;
}

function turnLifecycleFor(clientRequestId: string) {
  const turnId = acceptedTurnIdFor(clientRequestId);
  return deltasSent()
    .filter(
      (delta) =>
        delta.providerTurnId === turnId &&
        (delta.kind === "turn.open" ||
          delta.kind === "input.accepted" ||
          delta.kind === "turn.boundary"),
    )
    .map((delta) =>
      delta.kind === "turn.boundary"
        ? `${delta.kind}:${String(delta.status)}`
        : delta.kind,
    );
}

it.each([
  { order: "before", script: {} },
  { order: "after", script: { goalTurnStartDelayMs: 50 } },
])(
  "binds /goal resume to the Goal turn Codex starts when Codex reports that turn $order it answers which turn is active",
  async ({ script }) => {
    const providerThreadId = await startThread("paused", script);

    const response = await sendUserTurn(
      providerThreadId,
      2,
      "creq_garesume5z",
      "/goal resume",
    );

    expect(response.result).toEqual({ admission: "accepted" });
    expect(acceptedBeforeResponse("creq_garesume5z", 2)).toBe(true);
    expect(acceptedTurnIdFor("creq_garesume5z")).toMatch(/^turn-fx-/u);
    await vi.waitFor(() =>
      expect(turnLifecycleFor("creq_garesume5z")).toEqual([
        "turn.open",
        "input.accepted",
        "turn.boundary:completed",
      ]),
    );
    expect(
      deltasSent().some(
        (delta) =>
          delta.kind === "turn.open" &&
          String(delta.providerTurnId).startsWith("zero-work-"),
      ),
    ).toBe(false);
    expect(goalSetParams()).toEqual([
      { threadId: providerThreadId, origin: "user", status: "active" },
    ]);
    expect(
      recordedRequests().some((request) => request.method === "turn/start"),
    ).toBe(false);
  },
);

it("finishes /goal resume with an empty turn when Codex starts no Goal turn", async () => {
  const providerThreadId = await startThread("paused", {
    goalResumeStartsNoTurn: true,
  });

  const response = await sendUserTurn(
    providerThreadId,
    2,
    "creq_garesume2z",
    "/goal resume",
  );

  expect(response.result).toEqual({ admission: "accepted" });
  expect(acceptedBeforeResponse("creq_garesume2z", 2)).toBe(true);
  expect(acceptedTurnIdFor("creq_garesume2z")).toMatch(/^zero-work-/u);
  expect(turnLifecycleFor("creq_garesume2z")).toEqual([
    "turn.open",
    "input.accepted",
    "turn.boundary:completed",
  ]);
  expect(goalStatesSent().at(-1)).toBe("active");
});

it.each([
  { command: "clear", status: "paused", method: "thread/goal/clear" },
  { command: "pause", status: "active", method: "thread/goal/set" },
])(
  "settles /goal $command on the Codex reply without starting a Codex turn",
  async ({ command, status, method }) => {
    const providerThreadId = await startThread(status);

    const response = await sendUserTurn(
      providerThreadId,
      2,
      "creq_gawipe22zz",
      `/goal ${command}`,
    );

    expect(response.result).toEqual({ admission: "accepted" });
    expect(acceptedBeforeResponse("creq_gawipe22zz", 2)).toBe(true);
    expect(turnLifecycleFor("creq_gawipe22zz")).toEqual([
      "turn.open",
      "input.accepted",
      "turn.boundary:completed",
    ]);
    const methods = recordedRequests().map((request) => request.method);
    expect(methods).toContain(method);
    expect(methods).not.toContain("turn/start");
  },
);

it("rejects /goal resume when the goal is already active without opening a turn", async () => {
  const providerThreadId = await startThread("active");

  const response = await sendUserTurn(
    providerThreadId,
    2,
    "creq_garesume3z",
    "/goal resume",
  );

  expect(response.result).toEqual({
    admission: "rejected",
    message: "The Goal is already active.",
  });
  expect(goalSetParams()).toEqual([]);
  expect(acceptedTurnIdFor("creq_garesume3z")).toBeUndefined();
  expect(deltasSent().some((delta) => delta.kind === "turn.open")).toBe(false);
});

it("sends other /goal text to Codex as a normal prompt", async () => {
  const providerThreadId = await startThread(null);

  const response = await sendUserTurn(
    providerThreadId,
    2,
    "creq_gaprmpt2zz",
    "/goal ship the release notes",
  );

  expect(response.error).toBeUndefined();
  expect(
    recordedRequests().some((request) => request.method === "turn/start"),
  ).toBe(true);
  expect(
    recordedRequests().some((request) =>
      request.method.startsWith("thread/goal/"),
    ),
  ).toBe(false);
});
