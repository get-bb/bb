import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { z } from "zod";
import { handleLine } from "./bridge.js";
import {
  FULL_ACCESS_SESSION_OPTIONS,
  stubFakeCodexAppServer,
} from "./fake-codex-app-server-harness.js";

const THREAD_ID = "thr_session_lifetime";
let harness: ReturnType<typeof createBridgeJsonRpcTestHarness>;
let workspaceDir: string;
let requestLogPath: string;
let scriptPath: string;
let processLogPath: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-lifetime-"));
  requestLogPath = join(workspaceDir, "requests.jsonl");
  scriptPath = join(workspaceDir, "script.json");
  processLogPath = join(workspaceDir, "process.log");
  writeFileSync(scriptPath, JSON.stringify({ requestLogPath, processLogPath }));
  stubFakeCodexAppServer(scriptPath);
  harness = createBridgeJsonRpcTestHarness(handleLine);
});

afterEach(async () => {
  harness.sendRequest(991_020, "thread/stop", {
    threadId: THREAD_ID,
    providerThreadId: "lifetime-cleanup",
    intent: "release",
    activeTurnId: null,
  });
  await harness.waitForResponse(991_020).catch(() => undefined);
  harness.restore();
  vi.unstubAllEnvs();
  rmSync(workspaceDir, { recursive: true, force: true });
});

function recordedRequests() {
  const schema = z.object({
    method: z.string(),
    params: z.record(z.string(), z.unknown()),
  });
  return readFileSync(requestLogPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => schema.parse(JSON.parse(line)));
}

function start(
  providerSessionLifetime?: "persistent" | "disposable",
  requestId = 1,
) {
  harness.sendRequest(requestId, "thread/start", {
    threadId: THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    ...(providerSessionLifetime === undefined
      ? {}
      : { providerSessionLifetime }),
    options: FULL_ACCESS_SESSION_OPTIONS,
  });
  return harness.waitForResponse(requestId);
}

it("keeps persistent storage and the same UUID on resume by default", async () => {
  const started = await start();
  const { providerThreadId } = z
    .object({
      providerThreadId: z.string(),
      sessionRestorable: z.literal(true),
    })
    .parse(started.result);
  expect(recordedRequests()).toContainEqual({
    method: "thread/start",
    params: expect.objectContaining({ ephemeral: false }),
  });
  harness.sendRequest(2, "thread/stop", {
    threadId: THREAD_ID,
    providerThreadId,
    intent: "release",
    activeTurnId: null,
  });
  expect((await harness.waitForResponse(2)).error).toBeUndefined();
  harness.sendRequest(3, "thread/resume", {
    threadId: THREAD_ID,
    providerThreadId,
    cwd: workspaceDir,
    instructionMode: "append",
    options: FULL_ACCESS_SESSION_OPTIONS,
  });
  expect((await harness.waitForResponse(3)).result).toMatchObject({
    providerThreadId,
    sessionRestorable: true,
  });
  expect(recordedRequests()).toContainEqual({
    method: "thread/resume",
    params: expect.objectContaining({ threadId: providerThreadId }),
  });
}, 30_000);

it("constructs disposable sessions without persistence and reports them nonrestorable", async () => {
  const started = await start("disposable");
  expect(started.error).toBeUndefined();
  expect(started.result).toMatchObject({ sessionRestorable: false });
  expect(recordedRequests()).toContainEqual({
    method: "thread/start",
    params: expect.objectContaining({ ephemeral: true }),
  });
  expect(harness.messages).toContainEqual(
    expect.objectContaining({
      method: "thread/identity",
      params: expect.objectContaining({ sessionRestorable: false }),
    }),
  );
}, 30_000);

it.each([
  { ephemeral: false, path: null },
  { path: null },
  { ephemeral: true },
  { ephemeral: true, path: "/tmp/unexpected-persistent-rollout.jsonl" },
])(
  "rejects unconfirmed disposable storage %j without publishing an identity",
  async (threadStartStorage) => {
    writeFileSync(
      scriptPath,
      JSON.stringify({ requestLogPath, processLogPath, threadStartStorage }),
    );
    const started = await start("disposable");
    expect(started.error).toMatchObject({
      message: expect.stringContaining(
        "did not confirm disposable session storage",
      ),
    });
    expect(harness.messages).not.toContainEqual(
      expect.objectContaining({ method: "thread/identity" }),
    );
    expect(harness.messages).not.toContainEqual(
      expect.objectContaining({ method: "thread/delta" }),
    );
    expect(readFileSync(processLogPath, "utf8")).toMatch(/exit:\d+:\d+/);
    expect(
      recordedRequests().filter((request) =>
        ["thread/archive", "thread/delete"].includes(request.method),
      ),
    ).toEqual([]);
  },
  30_000,
);

it("buffers early thread notifications until disposable storage is confirmed", async () => {
  const gatePath = join(workspaceDir, "release-start-response");
  writeFileSync(
    scriptPath,
    JSON.stringify({
      requestLogPath,
      processLogPath,
      threadStartResponseGatePath: gatePath,
    }),
  );
  const started = start("disposable");
  await vi.waitFor(() => {
    expect(existsSync(processLogPath)).toBe(true);
    expect(readFileSync(processLogPath, "utf8")).toContain("thread-started:");
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(harness.messages).not.toContainEqual(
    expect.objectContaining({ method: "thread/identity" }),
  );
  expect(harness.messages).not.toContainEqual(
    expect.objectContaining({ method: "thread/delta" }),
  );
  writeFileSync(gatePath, "release");
  expect((await started).result).toMatchObject({ sessionRestorable: false });
  const identityIndex = harness.messages.findIndex(
    (message) => "method" in message && message.method === "thread/identity",
  );
  const deltaIndex = harness.messages.findIndex(
    (message) => "method" in message && message.method === "thread/delta",
  );
  expect(identityIndex).toBeGreaterThanOrEqual(0);
  expect(deltaIndex).toBeGreaterThan(identityIndex);
}, 30_000);

it("starts a fresh disposable worker after storage confirmation fails", async () => {
  writeFileSync(
    scriptPath,
    JSON.stringify({
      requestLogPath,
      processLogPath,
      threadStartStorage: { ephemeral: false, path: "/tmp/unexpected.jsonl" },
    }),
  );
  expect((await start("disposable")).error).toBeDefined();
  writeFileSync(scriptPath, JSON.stringify({ requestLogPath, processLogPath }));
  expect((await start("disposable", 2)).result).toMatchObject({
    sessionRestorable: false,
  });
  expect(
    harness.messages.filter(
      (message) => "method" in message && message.method === "thread/identity",
    ),
  ).toHaveLength(1);
  expect(
    recordedRequests().filter((request) => request.method === "thread/start"),
  ).toHaveLength(2);
  expect(
    recordedRequests().filter((request) => request.method === "thread/resume"),
  ).toEqual([]);
}, 30_000);

it("rejects cold disposable resume before constructing a native session", async () => {
  harness.sendRequest(1, "thread/resume", {
    threadId: THREAD_ID,
    providerThreadId: "temporary-native-id",
    providerSessionLifetime: "disposable",
    cwd: workspaceDir,
    instructionMode: "append",
    options: FULL_ACCESS_SESSION_OPTIONS,
  });
  expect((await harness.waitForResponse(1)).error).toMatchObject({
    message: expect.stringMatching(/disposable/i),
  });
}, 30_000);

it("rejects settings changes that require disposable reconstruction and keeps the live session usable", async () => {
  const started = await start("disposable");
  const { providerThreadId } = z
    .object({ providerThreadId: z.string() })
    .parse(started.result);
  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    clientRequestId: "creq_tmpwrk2222",
    input: [{ type: "text", text: "changed settings", mentions: [] }],
    options: { ...FULL_ACCESS_SESSION_OPTIONS, reasoningLevel: "high" },
  });
  expect((await harness.waitForResponse(2)).error).toMatchObject({
    message: expect.stringMatching(/disposable/i),
  });
  expect(
    recordedRequests().filter((request) => request.method === "thread/resume"),
  ).toEqual([]);
  harness.sendRequest(3, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    clientRequestId: "creq_tmpwrk3333",
    input: [{ type: "text", text: "original settings", mentions: [] }],
    options: FULL_ACCESS_SESSION_OPTIONS,
  });
  expect((await harness.waitForResponse(3)).error).toBeUndefined();
}, 30_000);

it("fails after disposable child loss without attempting native resume", async () => {
  const started = await start("disposable");
  const { providerThreadId } = z
    .object({ providerThreadId: z.string() })
    .parse(started.result);
  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    clientRequestId: "creq_tmpwrk4444",
    input: [{ type: "text", text: "/subagent-then-crash", mentions: [] }],
    options: FULL_ACCESS_SESSION_OPTIONS,
  });
  expect((await harness.waitForResponse(2)).error).toBeUndefined();
  await vi.waitFor(
    () =>
      expect(harness.messages).toContainEqual(
        expect.objectContaining({
          method: "error",
          params: expect.objectContaining({
            message: expect.stringContaining("exited unexpectedly"),
          }),
        }),
      ),
    { timeout: 5_000 },
  );
  harness.sendRequest(3, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId,
    clientRequestId: "creq_tmpwrk5555",
    input: [{ type: "text", text: "retry", mentions: [] }],
    options: FULL_ACCESS_SESSION_OPTIONS,
  });
  expect((await harness.waitForResponse(3)).error).toMatchObject({
    message: expect.stringContaining("Disposable"),
  });
  expect(
    recordedRequests().filter((request) => request.method === "thread/resume"),
  ).toEqual([]);
}, 30_000);
