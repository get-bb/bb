import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { handleLine } from "./bridge.js";
import {
  cleanupBridgeProcessTest,
  spawnedAppServerPids,
  waitForAppServerProcessStep,
} from "./bridge-process.test-support.js";

const THREAD_ID = "thr_writer_lock_1";
const PROVIDER_THREAD_ID = "codex-writer-lock-1";

const fakeAppServerPath = fileURLToPath(
  new URL("./fake-codex-app-server.mjs", import.meta.url),
);

const sessionOptions = {
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
  reasoningLevel: "low",
} as const;

const changedSessionOptions = {
  ...sessionOptions,
  reasoningLevel: "high",
} as const;

let harness: ReturnType<typeof createBridgeJsonRpcTestHarness>;
let workspaceDir = "";
let processLogPath = "";
let writerLockPath = "";

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-writer-lock-"));
  processLogPath = join(workspaceDir, "app-server-processes.log");
  writerLockPath = join(workspaceDir, "writer.lock");
  const scriptPath = join(workspaceDir, "fake-codex-script.json");
  writeFileSync(
    scriptPath,
    JSON.stringify({
      processLogPath,
      writerLockPath,
      sigtermDelayMs: 500,
    }),
  );
  vi.stubEnv("BB_CODEX_BRIDGE_APP_SERVER_COMMAND", process.execPath);
  vi.stubEnv(
    "BB_CODEX_BRIDGE_APP_SERVER_ARGS",
    JSON.stringify([fakeAppServerPath, scriptPath]),
  );
  harness = createBridgeJsonRpcTestHarness(handleLine);
});

afterEach(async () => {
  await cleanupBridgeProcessTest({
    harness,
    cleanupId: 995_001,
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    processLogPath,
    workspaceDir,
    unstubEnvs: vi.unstubAllEnvs,
  });
});

async function resumeThread(id: number): Promise<void> {
  harness.sendRequest(id, "thread/resume", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: sessionOptions,
  });
  expect((await harness.waitForResponse(id)).error).toBeUndefined();
}

it("waits for the previous writer before resuming during a settings rebuild", async () => {
  await resumeThread(1);

  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    clientRequestId: "creq_abcdefghjk",
    input: [{ type: "text", text: "hello", mentions: [] }],
    options: changedSessionOptions,
  });
  const rebuiltTurn = await harness.waitForResponse(2);

  expect(rebuiltTurn.error).toBeUndefined();
  expect(rebuiltTurn.result).toEqual({ threadId: THREAD_ID });
}, 30_000);

it("finishes releasing the writer before acknowledging thread stop", async () => {
  await resumeThread(1);

  harness.sendRequest(2, "thread/stop", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    intent: "release",
    activeTurnId: null,
  });
  expect((await harness.waitForResponse(2)).error).toBeUndefined();
  expect(existsSync(writerLockPath)).toBe(false);

  await resumeThread(3);
}, 30_000);

it("does not install a replacement after a concurrent release is acknowledged", async () => {
  await resumeThread(1);

  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    clientRequestId: "creq_abcdefghjk",
    input: [{ type: "text", text: "hello", mentions: [] }],
    options: changedSessionOptions,
  });
  await waitForAppServerProcessStep(processLogPath, "sigterm");

  harness.sendRequest(3, "thread/stop", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    intent: "release",
    activeTurnId: null,
  });
  expect((await harness.waitForResponse(3)).error).toBeUndefined();
  expect(existsSync(writerLockPath)).toBe(false);

  const rebuiltTurn = await harness.waitForResponse(2);
  expect(rebuiltTurn.error).toBeDefined();
  expect(
    harness.messages.filter((message) => message.method === "session/replaced"),
  ).toHaveLength(0);
  expect(spawnedAppServerPids(processLogPath)).toHaveLength(1);
}, 30_000);

it("does not install a replacement after concurrent discard maintenance settles", async () => {
  await resumeThread(1);

  harness.sendRequest(2, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    clientRequestId: "creq_abcdefghjk",
    input: [{ type: "text", text: "hello", mentions: [] }],
    options: changedSessionOptions,
  });
  await waitForAppServerProcessStep(processLogPath, "sigterm");

  harness.sendRequest(3, "thread/discard", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
  });
  expect((await harness.waitForResponse(3)).result).toEqual({ ok: true });
  expect(existsSync(writerLockPath)).toBe(false);

  const rebuiltTurn = await harness.waitForResponse(2);
  expect(rebuiltTurn.error).toBeDefined();
  expect(
    harness.messages.filter((message) => message.method === "session/replaced"),
  ).toHaveLength(0);
  expect(spawnedAppServerPids(processLogPath)).toHaveLength(2);
}, 30_000);

it("retries a resume while another Codex process is releasing the writer", async () => {
  writeFileSync(writerLockPath, String(process.pid));
  const stderrWrite = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(() => true);

  try {
    harness.sendRequest(1, "thread/resume", {
      threadId: THREAD_ID,
      providerThreadId: PROVIDER_THREAD_ID,
      cwd: workspaceDir,
      instructionMode: "append",
      options: sessionOptions,
    });
    await waitForAppServerProcessStep(processLogPath, "writer-conflict");
    rmSync(writerLockPath, { force: true });
    const resumed = await harness.waitForResponse(1);

    expect(resumed.error).toBeUndefined();
    expect(resumed.result).toEqual({
      providerThreadId: PROVIDER_THREAD_ID,
      sessionRestorable: true,
    });
    expect(stderrWrite).toHaveBeenCalledWith(
      "codex thread/resume found an active rollout writer; retrying in 100ms (1/3).\n",
    );
  } finally {
    stderrWrite.mockRestore();
    rmSync(writerLockPath, { force: true });
  }
}, 30_000);

it("explains persistent writer contention and resumes after the owner closes", async () => {
  writeFileSync(writerLockPath, String(process.pid));

  harness.sendRequest(1, "thread/resume", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: sessionOptions,
  });
  const blocked = await harness.waitForResponse(1);
  rmSync(writerLockPath, { force: true });

  expect(blocked.error?.message).toBe(
    `thread ${PROVIDER_THREAD_ID} already has an active writer. Another Codex process still owns this thread. Close any other Codex session using it; if none is open, wait for a previous Codex process to finish shutting down or stop the leftover codex app-server process, then retry.`,
  );
  await resumeThread(2);
}, 30_000);
