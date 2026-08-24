import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { handleLine } from "./bridge.js";
import { PI_BRIDGE_ARGS_ENV, PI_BRIDGE_COMMAND_ENV } from "./rpc-child.js";
import { FULL_PERMISSION_OPTIONS, type FakePiBridgeHarness, startFakePiBridge } from "./test-support.js";

/**
 * Pins for behavior the L5 review verified by hand: each one drives the real
 * extension inside the fake through one of its fault knobs and asserts the
 * bridge's answer, so the behavior cannot regress silently.
 */


let harness: FakePiBridgeHarness;
let nextId = 1000;

beforeEach(async () => {
  harness = await startFakePiBridge({ prefix: "bb-pi-round2-", initialize: true, processLog: true });
});

afterEach(async () => {
  await harness.teardown();
});

function turnStart(threadId: string, text: string, clientRequestId: string): void {
  handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: (nextId += 1),
      method: "turn/start",
      params: {
        threadId,
        providerThreadId: threadId,
        clientRequestId,
        input: [{ type: "text", text, mentions: [] }],
        options: FULL_PERMISSION_OPTIONS,
      },
    }),
  );
}

it("a child that dies mid-run does not take the bridge down: the next write is answered, not thrown", async () => {
  const threadId = "thr_r2_epipe";
  expect((await harness.startThread(threadId)).result).toMatchObject({ providerThreadId: threadId });
  turnStart(threadId, "/die", "creq_ab23456789");
  // The run died without agent_end: the bridge reports the exit as the run's
  // settlement (failed turn), and every later write to the dead child's stdin
  // or channel is swallowed by the error handlers.
  await harness.waitForDelta(threadId, (d) => d.kind === "turn.boundary" && d.status === "failed");
  const steer = await harness.request((nextId += 1), "turn/steer", {
    threadId,
    providerThreadId: threadId,
    expectedTurnId: "turn-1",
    clientRequestId: "creq_cd23456789",
    input: [{ type: "text", text: "still there?", mentions: [] }],
    options: FULL_PERMISSION_OPTIONS,
  });
  expect(steer.error).toMatchObject({ message: expect.stringMatching(/No active Pi session|pi exited/u) });
  // Still alive and serving: a fresh thread starts.
  expect((await harness.startThread("thr_r2_epipe_next")).result).toMatchObject({ providerThreadId: "thr_r2_epipe_next" });
}, 90_000);

it("a missing executable fails thread/start fast with the spawn error", async () => {
  vi.stubEnv(PI_BRIDGE_COMMAND_ENV, join(harness.workspaceDir, "no-such-pi"));
  vi.stubEnv(PI_BRIDGE_ARGS_ENV, "[]");
  const startedAt = Date.now();
  const response = await harness.startThread("thr_r2_enoent");
  expect(Date.now() - startedAt).toBeLessThan(5_000);
  expect(response.error).toMatchObject({ message: expect.stringMatching(/ENOENT/u) });
}, 90_000);

it("refuses a manual compaction while pi reports a run still streaming", async () => {
  vi.stubEnv("FAKE_PI_STREAMING_AFTER_END", "1");
  const threadId = "thr_r2_compact";
  await harness.startThread(threadId);
  turnStart(threadId, "/hold", "creq_ab23456789");
  await harness.waitForDelta(threadId, (d) => d.kind === "turn.open");
  // The steer releases the held run; the fake then ends the run but keeps
  // reporting isStreaming (a continuation pi is still finishing).
  await harness.request((nextId += 1), "turn/steer", {
    threadId,
    providerThreadId: threadId,
    expectedTurnId: "turn-1",
    clientRequestId: "creq_cd23456789",
    input: [{ type: "text", text: "go", mentions: [] }],
    options: FULL_PERMISSION_OPTIONS,
  });
  await harness.waitForDelta(threadId, (d) => d.kind === "turn.boundary");
  const before = harness.deltasOf(threadId).length;
  handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: (nextId += 1),
      method: "turn/start",
      params: {
        threadId,
        providerThreadId: threadId,
        clientRequestId: "creq_ef23456789",
        input: [
          {
            type: "text",
            text: "/compact",
            mentions: [
              {
                start: 0,
                end: 8,
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
        ],
        options: FULL_PERMISSION_OPTIONS,
      },
    }),
  );
  await harness.waitForDelta(threadId, (d) => d.kind === "turn.boundary", before);
  const boundary = harness.deltasOf(threadId).slice(before).find((d) => d.kind === "turn.boundary");
  expect(boundary).toMatchObject({
    status: "failed",
    error: { message: expect.stringContaining("Cannot compact context while Pi is processing a turn") },
  });
  expect(harness.deltasOf(threadId).slice(before).some((d) => d.kind === "item.open")).toBe(false);
}, 90_000);

it("a steer consumed by the run is reported accepted and named in the reply", async () => {
  const threadId = "thr_r2_steer_ok";
  await harness.startThread(threadId);
  turnStart(threadId, "/hold", "creq_ab23456789");
  await harness.waitForDelta(threadId, (d) => d.kind === "turn.open");
  const steer = await harness.request((nextId += 1), "turn/steer", {
    threadId,
    providerThreadId: threadId,
    expectedTurnId: "turn-1",
    clientRequestId: "creq_cd23456789",
    input: [{ type: "text", text: "take the left path", mentions: [] }],
    options: FULL_PERMISSION_OPTIONS,
  });
  expect(steer.result).toMatchObject({ threadId });
  await harness.waitForDelta(threadId, (d) => d.kind === "turn.boundary");
  expect(harness.deltasOf(threadId).some((d) => d.kind === "input.accepted" && d.clientRequestId === "creq_cd23456789")).toBe(true);
  expect(harness.deltasOf(threadId).some((d) => d.kind === "item.textDelta" && String(d.text).includes("Steered: take the left path"))).toBe(true);
  expect(harness.messages.some((m) => m.method === "error")).toBe(false);
}, 90_000);

it("a steer still queued when the run ends is reported dropped through the delivery barrier, not a timer", async () => {
  vi.stubEnv("FAKE_PI_DROP_STEER_AT_END", "1");
  const threadId = "thr_r2_steer_drop";
  await harness.startThread(threadId);
  turnStart(threadId, "/hold", "creq_ab23456789");
  await harness.waitForDelta(threadId, (d) => d.kind === "turn.open");
  handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: (nextId += 1),
      method: "turn/steer",
      params: {
        threadId,
        providerThreadId: threadId,
        expectedTurnId: "turn-1",
        clientRequestId: "creq_cd23456789",
        input: [{ type: "text", text: "never consumed", mentions: [] }],
        options: FULL_PERMISSION_OPTIONS,
      },
    }),
  );
  await harness.waitForDelta(threadId, (d) => d.kind === "turn.boundary");
  // The bridge asked pi for its state after agent_end (the barrier) and, with
  // the steer still queued and nothing streaming, reported it dropped.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && !harness.messages.some((m) => m.method === "error")) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const error = harness.messages.find((m) => m.method === "error");
  expect(error?.params).toMatchObject({
    threadId,
    message: expect.stringContaining("Pi turn ended before steer was consumed"),
  });
  // The run never acted on it: no steered reply reached the runtime.
  expect(harness.deltasOf(threadId).some((d) => d.kind === "item.textDelta" && String(d.text).includes("Steered:"))).toBe(false);
}, 90_000);

it("recovers from one transient model mismatch by respawning", async () => {
  vi.stubEnv("FAKE_PI_SPAWN_COUNTER_FILE", join(harness.workspaceDir, "spawns"));
  vi.stubEnv("FAKE_PI_MISMATCH_FIRST_SPAWN", "1");
  const threadId = "thr_r2_mismatch";
  const response = await harness.startThread(threadId, {
    options: { ...FULL_PERMISSION_OPTIONS, model: "fake-provider/fake-mini" },
  });
  expect(response.result).toMatchObject({ providerThreadId: threadId });
  const log = harness.readProcessLog();
  expect(log.spawned).toHaveLength(2);
  // The failed attempt's child is gone, and its exit reported no session
  // error for the thread that was still being constructed.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && !log.spawned.slice(0, 1).every((pid) => harness.readProcessLog().exited.includes(pid))) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect(harness.readProcessLog().exited).toContain(log.spawned[0]);
  expect(harness.messages.some((m) => m.method === "error")).toBe(false);
  expect(harness.messages.some((m) => m.method === "session/ended")).toBe(false);
}, 90_000);

it("a child whose extension never reports ready is a construction error, not a hung tool call", async () => {
  vi.stubEnv("FAKE_PI_NO_SESSION_START", "1");
  vi.stubEnv("BB_PI_BRIDGE_READINESS_TIMEOUT_MS", "1500");
  const response = await harness.startThread("thr_r2_noready");
  expect(response.error).toMatchObject({
    message: expect.stringContaining("did not report ready"),
  });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const log = harness.readProcessLog();
    if (log.spawned.length > 0 && log.spawned.every((pid) => log.exited.includes(pid))) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const log = harness.readProcessLog();
  expect(log.spawned.every((pid) => log.exited.includes(pid))).toBe(true);
}, 60_000);

it("evicts an idle catalog child", async () => {
  vi.stubEnv("BB_PI_CATALOG_IDLE_MS", "300");
  const models = await harness.request((nextId += 1), "model/list", { cwd: harness.workspaceDir });
  expect(models.error, JSON.stringify(models)).toBeUndefined();
  expect(models.result).toMatchObject({ models: expect.any(Array) });
  const { spawned } = harness.readProcessLog();
  expect(spawned).toHaveLength(1);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && !harness.readProcessLog().exited.includes(spawned[0]!)) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect(harness.readProcessLog().exited).toContain(spawned[0]);
  // A later request spawns a fresh one.
  await harness.request((nextId += 1), "model/list", { cwd: harness.workspaceDir });
  expect(harness.readProcessLog().spawned).toHaveLength(2);
}, 90_000);

it("reports a bash call's cwd as the thread's working directory, never an empty string", async () => {
  const threadId = "thr-bash-cwd";
  await harness.startThread(threadId);
  turnStart(threadId, '/tool bash {"command":"ls"}', "creq_cwd2345678");
  await harness.waitForDelta(threadId, (d) => d.kind === "item.close");
  const opened = harness.deltasOf(threadId).find((d) => d.kind === "item.open");
  expect(opened?.item).toMatchObject({ type: "command", command: "ls", cwd: harness.workspaceDir });
  expect(JSON.stringify(harness.deltasOf(threadId))).not.toContain('"cwd":""');
}, 90_000);

it("a resumed thread reports the session header's cwd, not the cwd bb asked for", async () => {
  // pi's SessionManager.open runs the session where its header says; the
  // bridge's command items must say the same directory.
  const headerDir = mkdtempSync(join(tmpdir(), "bb-pi-header-cwd-"));
  try {
    const sessionDir = join(harness.workspaceDir, "sessions");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, "thr-resume-cwd.jsonl"),
      `${JSON.stringify({ type: "session", version: 3, id: "sess-1", timestamp: "2026-01-01T00:00:00.000Z", cwd: headerDir })}\n`,
    );
    const threadId = "thr-resume-cwd";
    const resumed = await harness.request((nextId += 1), "thread/resume", {
      threadId,
      providerThreadId: threadId,
      cwd: harness.workspaceDir,
      instructionMode: "append",
      options: FULL_PERMISSION_OPTIONS,
    });
    expect(resumed.result).toMatchObject({ providerThreadId: threadId });
    turnStart(threadId, '/tool bash {"command":"pwd"}', "creq_rsm2345678");
    await harness.waitForDelta(threadId, (d) => d.kind === "item.close");
    const opened = harness.deltasOf(threadId).find((d) => d.kind === "item.open");
    expect(opened?.item).toMatchObject({ type: "command", command: "pwd", cwd: headerDir });
  } finally {
    rmSync(headerDir, { recursive: true, force: true });
  }
}, 90_000);
