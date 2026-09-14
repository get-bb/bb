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
import {
  FULL_PERMISSION_OPTIONS,
  type FakePiBridgeHarness,
  startFakePiBridge,
} from "./test-support.js";

let harness: FakePiBridgeHarness;

beforeEach(async () => {
  harness = await startFakePiBridge({
    prefix: "bb-pi-lifecycle-",
    initialize: true,
    processLog: true,
  });
}, 90_000);

afterEach(async () => {
  await harness.teardown();
}, 90_000);

let nextId = 1000;

function resultProviderThreadId(result: unknown): string {
  const providerThreadId = (result as { providerThreadId?: unknown }).providerThreadId;
  expect(typeof providerThreadId).toBe("string");
  if (typeof providerThreadId !== "string") throw new Error("missing providerThreadId");
  return providerThreadId;
}

function providerThreadIdFor(threadId: string): string {
  const identity = [...harness.messages]
    .reverse()
    .find((message) => message.method === "thread/identity" && (message.params as { threadId?: unknown }).threadId === threadId);
  return resultProviderThreadId(identity?.params);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function expectEveryChildGone(expectedSpawns: number): Promise<void> {
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

async function startThread(threadId: string): Promise<string> {
  const response = await harness.startThread(threadId, {
    dynamicTools: [
      {
        name: "bb_probe",
        description: "A bb tool.",
        inputSchema: {
          type: "object",
          properties: { value: { type: "string" } },
        },
      },
    ],
  });
  const providerThreadId = resultProviderThreadId(response.result);
  expect(providerThreadId).toMatch(/^pi_/u);
  expect(response.result).toMatchObject({ providerThreadId });
  return providerThreadId;
}

it("stop{release} ends the child after a local-file-only turn", async () => {
  const threadId = "thr_lc_release";
  const filePath = join(harness.workspaceDir, "notes.md");
  const providerThreadId = await startThread(threadId);
  const turn = await harness.request((nextId += 1), "turn/start", {
    threadId,
    providerThreadId,
    clientRequestId: "creq_ab23456789",
    input: [
      {
        type: "localFile",
        path: filePath,
        name: "notes.md",
        sizeBytes: 6,
        mimeType: "text/markdown",
      },
    ],
    options: FULL_PERMISSION_OPTIONS,
  });
  expect(turn.result).toEqual({ threadId });
  await harness.waitForTurnBoundary(threadId, 0);
  expect(
    harness
      .deltasOf(threadId)
      .some(
        (delta) =>
          delta.kind === "item.textDelta" &&
          String(delta.text).includes(`[Attached file: ${filePath}]`),
      ),
  ).toBe(true);
  const stop = await harness.request((nextId += 1), "thread/stop", {
    threadId,
    providerThreadId,
    intent: "release",
    activeTurnId: null,
  });
  expect(stop.result).toMatchObject({
    ok: true,
    providerCheckpointId: "leaf-1",
  });
  await expectEveryChildGone(1);
}, 90_000);

it("stop{interrupt} of a live run ends the child, and the turn settled before the result", async () => {
  await startThread("thr_lc_interrupt");
  await harness.request((nextId += 1), "turn/start", {
    threadId: "thr_lc_interrupt",
    providerThreadId: providerThreadIdFor("thr_lc_interrupt"),
    clientRequestId: "creq_cd23456789",
    input: [{ type: "text", text: "/hold", mentions: [] }],
    options: FULL_PERMISSION_OPTIONS,
  });
  const stop = await harness.request((nextId += 1), "thread/stop", {
    threadId: "thr_lc_interrupt",
    providerThreadId: providerThreadIdFor("thr_lc_interrupt"),
    intent: "interrupt",
    activeTurnId: "turn-1",
  });
  expect(stop.result).toMatchObject({ ok: true });
  await expectEveryChildGone(1);
}, 90_000);

it("discard ends the child and removes the session file", async () => {
  await startThread("thr_lc_discard");
  const sessionFile = join(
    harness.workspaceDir,
    "sessions",
    `${providerThreadIdFor("thr_lc_discard")}.jsonl`,
  );
  expect(existsSync(sessionFile)).toBe(true);
  const discard = await harness.request((nextId += 1), "thread/discard", {
    threadId: "thr_lc_discard",
    providerThreadId: providerThreadIdFor("thr_lc_discard"),
  });
  expect(discard.result).toEqual({ ok: true });
  expect(existsSync(sessionFile)).toBe(false);
  await expectEveryChildGone(1);
}, 90_000);

it("a failed construction leaves no child", async () => {
  vi.stubEnv("FAKE_PI_EXIT_BEFORE_FIRST_RESPONSE", "1");
  const response = await harness.request((nextId += 1), "thread/start", {
    threadId: "thr_lc_failed",
    cwd: harness.workspaceDir,
    instructionMode: "append",
    options: FULL_PERMISSION_OPTIONS,
  });
  expect(response.error).toMatchObject({
    message: expect.stringContaining("pi exited"),
  });
  const log = harness.readProcessLog();
  expect(log.spawned).toHaveLength(1);
  await expectEveryChildGone(1);
}, 90_000);

it("the fork helper child exits once the fork is done", async () => {
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
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
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
  expect(forkResponse.result).toMatchObject({
    providerThreadId: "thr_lc_fork",
  });
  expect(readFileSync(join(sessionDir, "thr_lc_src.jsonl"), "utf8")).toBe(
    sourceBefore,
  );
  expect(existsSync(join(sessionDir, "thr_lc_fork.jsonl"))).toBe(true);
  await harness.request((nextId += 1), "thread/stop", {
    threadId: "thr_lc_fork",
    providerThreadId: "thr_lc_fork",
    intent: "release",
    activeTurnId: null,
  });
  await expectEveryChildGone(2);
}, 90_000);

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

it("start_after_release_selects_fresh_pi_session", async () => {
  const threadId = "thr_lc_start_fresh";
  const sentinel = "legacy session sentinel";
  const first = await harness.startThread(threadId);
  const oldProviderThreadId = resultProviderThreadId(first.result);
  const oldSessionFile = join(
    harness.sessionDir,
    `${oldProviderThreadId}.jsonl`,
  );
  expect(existsSync(oldSessionFile)).toBe(true);

  const released = await harness.request((nextId += 1), "thread/stop", {
    threadId,
    providerThreadId: oldProviderThreadId,
    intent: "release",
    activeTurnId: null,
  });
  expect(released.result).toMatchObject({ ok: true });
  await expectEveryChildGone(1);
  await expectScratchFilesGone();

  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const session = SessionManager.open(
    oldSessionFile,
    harness.sessionDir,
    harness.workspaceDir,
  );
  session.appendMessage({ role: "user", content: sentinel, timestamp: 3 });
  const reopened = SessionManager.open(
    oldSessionFile,
    harness.sessionDir,
    harness.workspaceDir,
  );
  expect(reopened.getEntries().some((entry) => JSON.stringify(entry).includes(sentinel))).toBe(true);
  const oldBytes = readFileSync(oldSessionFile, "utf8");

  const second = await harness.startThread(threadId, {
    options: { ...FULL_PERMISSION_OPTIONS, instructions: "fresh instructions" },
  });
  const newProviderThreadId = resultProviderThreadId(second.result);
  expect(newProviderThreadId).not.toBe(oldProviderThreadId);
  expect(oldProviderThreadId).toMatch(/^pi_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  expect(newProviderThreadId).toMatch(/^pi_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  expect(readFileSync(oldSessionFile, "utf8")).toBe(oldBytes);
  const freshSessionFile = join(
    harness.sessionDir,
    `${newProviderThreadId}.jsonl`,
  );
  expect(freshSessionFile).not.toBe(oldSessionFile);
  expect(existsSync(freshSessionFile)).toBe(true);
  const freshSession = SessionManager.open(
    freshSessionFile,
    harness.sessionDir,
    harness.workspaceDir,
  );
  const freshContext = freshSession.buildSessionContext();
  expect(freshContext.messages).toEqual([]);
  const identities = harness.messages
    .filter((message) => message.method === "thread/identity")
    .map((message) => message.params as { threadId?: unknown; providerThreadId?: unknown })
    .filter((params) => params.threadId === threadId);
  expect(identities).toHaveLength(2);
  expect(identities.map((params) => params.providerThreadId)).toEqual([
    oldProviderThreadId,
    newProviderThreadId,
  ]);
  await harness.request((nextId += 1), "thread/stop", {
    threadId,
    providerThreadId: newProviderThreadId,
    intent: "release",
    activeTurnId: null,
  });
  await expectEveryChildGone(2);
  await expectScratchFilesGone();
}, 90_000);

it("release_resume_preserves_pi_session_and_replaces_configuration", async () => {
  const threadId = "thr_lc_facet_switch";
  const oldInstructions = "planner instructions: only plan the work";
  const newInstructions = "orchestrator instructions: implement the approved plan";
  const oldTool = {
    name: "planner_only_tool",
    description: "Only available to the planner facet.",
    inputSchema: { type: "object", properties: { plan: { type: "string" } } },
  };
  const newTool = {
    name: "orchestrator_only_tool",
    description: "Only available to the orchestrator facet.",
    inputSchema: { type: "object", properties: { task: { type: "string" } } },
  };

  const started = await harness.startThread(threadId, {
    options: { ...FULL_PERMISSION_OPTIONS, instructions: oldInstructions },
    dynamicTools: [oldTool],
  });
  const providerThreadId = resultProviderThreadId(started.result);
  expect(providerThreadId).toMatch(/^pi_/u);
  const sessionFile = join(harness.sessionDir, `${providerThreadId}.jsonl`);
  expect(existsSync(sessionFile)).toBe(true);
  const initialHeader = JSON.parse(readFileSync(sessionFile, "utf8").split("\n", 1)[0]!);
  const initialFiles = scratchFiles();
  expect(initialFiles).toHaveLength(2);
  expect(readFileSync(join(experimental_scratchDirForTests(), initialFiles.find((name) => name.endsWith(".md"))!), "utf8")).toContain(oldInstructions);
  expect(JSON.parse(readFileSync(join(experimental_scratchDirForTests(), initialFiles.find((name) => name.endsWith(".json"))!), "utf8")).map((tool: { name: string }) => tool.name)).toContain(oldTool.name);

  const turn = await harness.request((nextId += 1), "turn/start", {
    threadId,
    providerThreadId,
    clientRequestId: "creq_facet23456",
    input: [{ type: "text", text: "plan this change", mentions: [] }],
    options: FULL_PERMISSION_OPTIONS,
  });
  expect(turn.error).toBeUndefined();
  await harness.waitForTurnBoundary(threadId);
  const released = await harness.request((nextId += 1), "thread/stop", {
    threadId,
    providerThreadId,
    intent: "release",
    activeTurnId: null,
  });
  expect(released.result).toMatchObject({ ok: true });
  await expectEveryChildGone(1);
  await expectScratchFilesGone();
  expect(existsSync(sessionFile)).toBe(true);
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const sentinel = "facet switch persisted sentinel";
  const seeded = SessionManager.open(
    sessionFile,
    harness.sessionDir,
    harness.workspaceDir,
  );
  seeded.appendMessage({ role: "user", content: sentinel, timestamp: 10 });
  const independentlySeeded = SessionManager.open(
    sessionFile,
    harness.sessionDir,
    harness.workspaceDir,
  );
  expect(JSON.stringify(independentlySeeded.buildSessionContext().messages)).toContain(sentinel);

  const resumed = await harness.request((nextId += 1), "thread/resume", {
    threadId,
    providerThreadId,
    cwd: harness.workspaceDir,
    instructionMode: "append",
    options: { ...FULL_PERMISSION_OPTIONS, instructions: newInstructions },
    dynamicTools: [newTool],
  });
  expect(resumed.result).toMatchObject({ providerThreadId });
  expect(existsSync(sessionFile)).toBe(true);
  const resumedBytes = readFileSync(sessionFile, "utf8");
  const resumedHeader = JSON.parse(resumedBytes.split("\n", 1)[0]!);
  expect(resumedHeader).toEqual(initialHeader);
  const independentlyResumed = SessionManager.open(
    sessionFile,
    harness.sessionDir,
    harness.workspaceDir,
  );
  expect(JSON.stringify(independentlyResumed.buildSessionContext().messages)).toContain(sentinel);
  const resumedFiles = scratchFiles();
  expect(resumedFiles).toHaveLength(2);
  const resumedPrompt = readFileSync(join(experimental_scratchDirForTests(), resumedFiles.find((name) => name.endsWith(".md"))!), "utf8");
  const resumedTools = JSON.parse(readFileSync(join(experimental_scratchDirForTests(), resumedFiles.find((name) => name.endsWith(".json"))!), "utf8"));
  expect(resumedPrompt).toContain(newInstructions);
  expect(resumedPrompt).not.toContain(oldInstructions);
  expect(resumedTools.map((tool: { name: string }) => tool.name)).toContain(newTool.name);
  expect(resumedTools.map((tool: { name: string }) => tool.name)).not.toContain(oldTool.name);

  const resumedTurn = await harness.request((nextId += 1), "turn/start", {
    threadId,
    providerThreadId,
    clientRequestId: "creq_facet34567",
    input: [{ type: "text", text: "implement the change", mentions: [] }],
    options: FULL_PERMISSION_OPTIONS,
  });
  expect(resumedTurn.error).toBeUndefined();
  await harness.waitForTurnBoundary(threadId);
  await harness.request((nextId += 1), "thread/stop", {
    threadId,
    providerThreadId,
    intent: "release",
    activeTurnId: null,
  });
  await expectEveryChildGone(2);
  await expectScratchFilesGone();
}, 90_000);

it("resume_legacy_pi_session", async () => {
  const threadId = "thr_lc_legacy_resume";
  const legacyProviderThreadId = "thr_lc_legacy_file";
  const sentinel = "legacy resume sentinel";
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const source = SessionManager.create(harness.workspaceDir, harness.sessionDir);
  source.appendMessage({ role: "user", content: sentinel, timestamp: 1 });
  source.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "legacy answer" }],
    api: "openai-responses",
    provider: "fake-provider",
    model: "fake-model",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: 2,
  });
  const legacyFile = join(harness.sessionDir, `${legacyProviderThreadId}.jsonl`);
  copyFileSync(source.getSessionFile()!, legacyFile);
  const before = readFileSync(legacyFile, "utf8");
  const reopened = SessionManager.open(legacyFile, harness.sessionDir, harness.workspaceDir);
  expect(JSON.stringify(reopened.buildSessionContext().messages)).toContain(sentinel);

  const resumed = await harness.request((nextId += 1), "thread/resume", {
    threadId,
    providerThreadId: legacyProviderThreadId,
    cwd: harness.workspaceDir,
    instructionMode: "append",
    options: FULL_PERMISSION_OPTIONS,
  });
  expect(resumed.result).toMatchObject({ providerThreadId: legacyProviderThreadId });
  const after = readFileSync(legacyFile, "utf8");
  expect(after).toBe(before);
  expect(JSON.parse(after.split("\n", 1)[0]!)).toEqual(JSON.parse(before.split("\n", 1)[0]!));
  expect(after).toContain(sentinel);
  const afterReopen = SessionManager.open(legacyFile, harness.sessionDir, harness.workspaceDir);
  expect(JSON.stringify(afterReopen.buildSessionContext().messages)).toContain(sentinel);
  const identity = harness.messages.find((message) => message.method === "thread/identity" && (message.params as { threadId?: unknown }).threadId === threadId);
  expect(identity?.params).toMatchObject({ threadId, providerThreadId: legacyProviderThreadId });
  await harness.request((nextId += 1), "thread/stop", { threadId, providerThreadId: legacyProviderThreadId, intent: "release", activeTurnId: null });
  await expectEveryChildGone(1);
}, 90_000);

it("a child's tool and prompt files go with the child after release and failed construction", async () => {
  await harness.startThread("thr_lc_scratch", {
    options: { ...FULL_PERMISSION_OPTIONS, instructions: "be brief" },
    dynamicTools: [
      {
        name: "bb_probe",
        description: "A bb tool.",
        inputSchema: { type: "object" },
      },
    ],
  });
  expect(scratchFiles()).toEqual([
    expect.stringMatching(/^pi-append-.*\.md$/),
    expect.stringMatching(/^pi-tools-.*\.json$/),
  ]);
  await harness.request((nextId += 1), "thread/stop", {
    threadId: "thr_lc_scratch",
    providerThreadId: providerThreadIdFor("thr_lc_scratch"),
    intent: "release",
    activeTurnId: null,
  });
  await expectEveryChildGone(1);
  await expectScratchFilesGone();

  vi.stubEnv("FAKE_PI_EXIT_BEFORE_FIRST_RESPONSE", "1");
  const failed = await harness.request((nextId += 1), "thread/start", {
    threadId: "thr_lc_scratch_failed",
    cwd: harness.workspaceDir,
    instructionMode: "append",
    options: { ...FULL_PERMISSION_OPTIONS, instructions: "be brief" },
  });
  expect(failed.error).toBeDefined();
  const log = harness.readProcessLog();
  expect(log.spawned).toHaveLength(2);
  await expectEveryChildGone(2);
  await expectScratchFilesGone();
}, 60_000);

it("closing the catalog waits for its child to exit", async () => {
  const models = await harness.request((nextId += 1), "model/list", {
    cwd: harness.workspaceDir,
  });
  expect(models.result).toMatchObject({ models: expect.any(Array) });
  await experimental_closeAllForTests();
  const log = harness.readProcessLog();
  expect(log.spawned).toHaveLength(1);
  expect(log.exited).toContain(log.spawned[0]);
  expect(log.spawned.some(isAlive)).toBe(false);
}, 90_000);

it("a child that ignores EOF and SIGTERM is SIGKILLed", async () => {
  vi.stubEnv("FAKE_PI_HANG_ON_CLOSE", "1");
  await startThread("thr_lc_kill");
  const { spawned } = harness.readProcessLog();
  const pid = spawned[0]!;
  const stop = await harness.request((nextId += 1), "thread/stop", {
    threadId: "thr_lc_kill",
    providerThreadId: providerThreadIdFor("thr_lc_kill"),
    intent: "release",
    activeTurnId: null,
  });
  expect(stop.result).toMatchObject({ ok: true });
  expect(isAlive(pid)).toBe(true);
  const deadline = Date.now() + 15_000;
  while (isAlive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect(isAlive(pid)).toBe(false);
}, 90_000);
