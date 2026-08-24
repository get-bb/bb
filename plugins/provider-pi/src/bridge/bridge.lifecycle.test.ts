import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  experimental_closeAllForTests,
  experimental_scratchDirForTests,
} from "./bridge.js";
import { FULL_PERMISSION_OPTIONS, type FakePiBridgeHarness, startFakePiBridge } from "./test-support.js";

/**
 * Protocol rule 6 at the process level: after every path that detaches a
 * thread (stop{interrupt}, stop{release}, discard, a failed construction,
 * the fork helper, the catalog's close) the pi child it served is gone —
 * not merely unowned. The fake loads the real extension, so the fd-4 reader
 * that kept pi's exit waiting lives in these children too; the process log
 * records each spawn and exit, and the pid is probed afterwards.
 */


let harness: FakePiBridgeHarness;

beforeEach(async () => {
  harness = await startFakePiBridge({ prefix: "bb-pi-lifecycle-", initialize: true, processLog: true });
}, 90_000);

afterEach(async () => {
  await harness.teardown();
}, 90_000);

let nextId = 1000;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function expectEveryChildGone(expectedSpawns: number): Promise<void> {
  // A child that ignores EOF is SIGTERMed after 4 s and SIGKILLed after
  // another 4 s; the exit then has to reach the process log. Leave room for
  // that whole escalation on a starved runner.
  const deadline = Date.now() + 30_000;
  for (;;) {
    const log = harness.readProcessLog();
    const allExited =
      log.spawned.length >= expectedSpawns &&
      log.spawned.every((pid) => log.exited.includes(pid) && !isAlive(pid));
    if (allExited) {
      expect(log.spawned.length).toBe(expectedSpawns);
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `pi children still running: spawned ${JSON.stringify(log.spawned)}, exited ${JSON.stringify(log.exited)}, alive ${JSON.stringify(log.spawned.filter(isAlive))}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function startThread(threadId: string): Promise<void> {
  const response = await harness.startThread(threadId, {
    dynamicTools: [
      {
        name: "bb_probe",
        description: "A bb tool.",
        inputSchema: { type: "object", properties: { value: { type: "string" } } },
      },
    ],
  });
  expect(response.result).toMatchObject({ providerThreadId: threadId });
}

it("stop{release} ends the child", async () => {
  await startThread("thr_lc_release");
  await harness.request((nextId += 1), "turn/start", {
    threadId: "thr_lc_release",
    providerThreadId: "thr_lc_release",
    clientRequestId: "creq_ab23456789",
    input: [{ type: "text", text: "hello", mentions: [] }],
    options: FULL_PERMISSION_OPTIONS,
  });
  await harness.waitForTurnBoundary("thr_lc_release", 0);
  const stop = await harness.request((nextId += 1), "thread/stop", {
    threadId: "thr_lc_release",
    providerThreadId: "thr_lc_release",
    intent: "release",
    activeTurnId: null,
  });
  expect(stop.result).toMatchObject({ ok: true, providerCheckpointId: "leaf-1" });
  await expectEveryChildGone(1);
}, 90_000);

it("stop{interrupt} of a live run ends the child, and the turn settled before the result", async () => {
  await startThread("thr_lc_interrupt");
  await harness.request((nextId += 1), "turn/start", {
    threadId: "thr_lc_interrupt",
    providerThreadId: "thr_lc_interrupt",
    clientRequestId: "creq_cd23456789",
    input: [{ type: "text", text: "/hold", mentions: [] }],
    options: FULL_PERMISSION_OPTIONS,
  });
  const stop = await harness.request((nextId += 1), "thread/stop", {
    threadId: "thr_lc_interrupt",
    providerThreadId: "thr_lc_interrupt",
    intent: "interrupt",
    activeTurnId: "turn-1",
  });
  expect(stop.result).toMatchObject({ ok: true });
  await expectEveryChildGone(1);
}, 90_000);

it("discard ends the child and removes the session file", async () => {
  await startThread("thr_lc_discard");
  const sessionFile = join(harness.workspaceDir, "sessions", "thr_lc_discard.jsonl");
  expect(existsSync(sessionFile)).toBe(true);
  const discard = await harness.request((nextId += 1), "thread/discard", {
    threadId: "thr_lc_discard",
    providerThreadId: "thr_lc_discard",
  });
  expect(discard.result).toEqual({ ok: true });
  expect(existsSync(sessionFile)).toBe(false);
  await expectEveryChildGone(1);
}, 90_000);

it("a failed construction leaves no child", async () => {
  // A provider the catalog does not know passes the up-front check (pi may
  // serve providers the catalog omits); the fake then starts on its default
  // model, the bridge sees the mismatch after get_state, retries the spawn
  // through the transient-auth window, and fails.
  const response = await harness.request((nextId += 1), "thread/start", {
    threadId: "thr_lc_failed",
    cwd: harness.workspaceDir,
    instructionMode: "append",
    options: { ...FULL_PERMISSION_OPTIONS, model: "other-provider/no-such-model" },
  });
  expect(response.error).toMatchObject({
    message: expect.stringContaining('did not start with model "other-provider/no-such-model"'),
  });
  const log = harness.readProcessLog();
  expect(log.spawned.length).toBeGreaterThan(1);
  await expectEveryChildGone(log.spawned.length);
}, 90_000);

it("the fork helper child exits once the fork is done", async () => {
  // The fake's extension runs the real SessionManager fork, so the source
  // is a real pi session written by pi's own SessionManager.
  const sessionDir = join(harness.workspaceDir, "sessions");
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const source = SessionManager.create(harness.workspaceDir, sessionDir);
  source.appendMessage({ role: "user", content: "first", timestamp: 1 });
  source.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "ready" }],
    api: "openai-responses",
    provider: "fake-provider",
    model: "fake-model",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: 2,
  });
  const sourceFile = source.getSessionFile()!;
  const sourceBefore = readFileSync(sourceFile, "utf8");
  mkdirSync(sessionDir, { recursive: true });
  copyFileSync(sourceFile, join(sessionDir, "thr_lc_src.jsonl"));
  const forkResponse = await harness.request((nextId += 1), "thread/fork", {
    threadId: "thr_lc_fork",
    cwd: harness.workspaceDir,
    sourceProviderThreadId: "thr_lc_src",
    options: FULL_PERMISSION_OPTIONS,
    instructionMode: "append",
  });
  expect(forkResponse.result).toMatchObject({ providerThreadId: "thr_lc_fork" });
  // The helper read the source and wrote only the fork.
  expect(readFileSync(join(sessionDir, "thr_lc_src.jsonl"), "utf8")).toBe(sourceBefore);
  expect(existsSync(join(sessionDir, "thr_lc_fork.jsonl"))).toBe(true);
  await harness.request((nextId += 1), "thread/stop", {
    threadId: "thr_lc_fork",
    providerThreadId: "thr_lc_fork",
    intent: "release",
    activeTurnId: null,
  });
  // The helper child and the session child.
  await expectEveryChildGone(2);
}, 90_000);

/** The per-child scratch files; the extension file lives for the process. */
function scratchFiles(): string[] {
  return readdirSync(experimental_scratchDirForTests())
    .filter((name) => name !== "bb-pi-extension.mjs")
    .sort();
}

async function expectScratchFilesGone(): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (scratchFiles().length > 0) {
    if (Date.now() > deadline) {
      throw new Error(
        `scratch files left behind: ${scratchFiles().join(", ")}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

it("a child's tool and prompt files go with the child, for a released thread and for every attempt of a failed construction", async () => {
  // The bridge process outlives every pi child it spawns, so a file written
  // for one child must not wait for the bridge's own temp dir to be removed.
  await harness.startThread("thr_lc_scratch", {
    options: { ...FULL_PERMISSION_OPTIONS, instructions: "be brief" },
    dynamicTools: [
      { name: "bb_probe", description: "A bb tool.", inputSchema: { type: "object" } },
    ],
  });
  expect(scratchFiles()).toEqual([
    expect.stringMatching(/^pi-append-.*\.md$/),
    expect.stringMatching(/^pi-tools-.*\.json$/),
  ]);
  await harness.request((nextId += 1), "thread/stop", {
    threadId: "thr_lc_scratch",
    providerThreadId: "thr_lc_scratch",
    intent: "release",
    activeTurnId: null,
  });
  await expectEveryChildGone(1);
  await expectScratchFilesGone();

  // Every retry of the transient-auth window wrote its own set; each went
  // with its detached child.
  const failed = await harness.request((nextId += 1), "thread/start", {
    threadId: "thr_lc_scratch_failed",
    cwd: harness.workspaceDir,
    instructionMode: "append",
    options: { ...FULL_PERMISSION_OPTIONS, instructions: "be brief", model: "other-provider/no-such-model" },
  });
  expect(failed.error).toBeDefined();
  const log = harness.readProcessLog();
  expect(log.spawned.length).toBeGreaterThan(2);
  await expectEveryChildGone(log.spawned.length);
  await expectScratchFilesGone();
}, 60_000);

it("closing the catalog ends its child", async () => {
  const models = await harness.request((nextId += 1), "model/list", { cwd: harness.workspaceDir });
  expect(models.result).toMatchObject({ models: expect.any(Array) });
  await experimental_closeAllForTests();
  await expectEveryChildGone(1);
}, 90_000);

it("a child that ignores EOF and SIGTERM is SIGKILLed", async () => {
  vi.stubEnv("FAKE_PI_HANG_ON_CLOSE", "1");
  await startThread("thr_lc_kill");
  const { spawned } = harness.readProcessLog();
  const pid = spawned[0]!;
  const stop = await harness.request((nextId += 1), "thread/stop", {
    threadId: "thr_lc_kill",
    providerThreadId: "thr_lc_kill",
    intent: "release",
    activeTurnId: null,
  });
  expect(stop.result).toMatchObject({ ok: true });
  // stdin EOF (ignored) → SIGTERM after the grace (ignored) → SIGKILL.
  expect(isAlive(pid)).toBe(true);
  const deadline = Date.now() + 15_000;
  while (isAlive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect(isAlive(pid)).toBe(false);
}, 90_000);
