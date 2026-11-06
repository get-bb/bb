import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadEvent } from "@bb/domain";
import {
  createScriptedEchoRequestRecord,
  createScriptedEchoRuntime,
  fullRuntimeOptions,
  wait,
  type LaunchBoundAgentRuntime,
} from "./test/runtime-test-harness.js";
import { promptTextInput } from "./test/prompt-input.js";
import { CompetingTurnError } from "./runtime.js";

describe("turn-start watchdog", () => {
  let tmpDir: string;
  let runtime: LaunchBoundAgentRuntime | null = null;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "bb-runtime-watchdog-"));
  });

  afterEach(async () => {
    await runtime?.shutdown();
    runtime = null;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function waitFor<T>(
    resolve: () => T | undefined,
    timeoutMs = 3_000,
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = resolve();
      if (value !== undefined) {
        return value;
      }
      if (Date.now() > deadline) {
        throw new Error("timed out waiting");
      }
      await wait(15);
    }
  }

  it("surfaces a visible error when an accepted turn never starts", async () => {
    const events: ThreadEvent[] = [];
    runtime = createScriptedEchoRuntime({
      runtime: {
        workspacePath: tmpDir,
        onEvent: (event) => events.push(event),
        turnStartWatchdog: { thresholdMs: 120, intervalMs: 25 },
      },
      launch: { scripted: { swallowTurnStart: true } },
    });

    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await runtime.runTurn({
      clientRequestId: "creq_222222222w",
      threadId: "t1",
      input: [promptTextInput({ text: "hello" })],
      options: fullRuntimeOptions,
    });

    const watchdogEvent = await waitFor(() =>
      events.find(
        (event) =>
          event.type === "system/error" &&
          event.code === "provider_turn_start_timeout",
      ),
    );
    expect(watchdogEvent.threadId).toBe("t1");
    expect(events.some((event) => event.type === "turn/started")).toBe(false);

    await wait(120);
    expect(
      events.filter(
        (event) =>
          event.type === "system/error" &&
          event.code === "provider_turn_start_timeout",
      ),
    ).toHaveLength(1);
  });

  it("keeps a turn start the provider never answered pending instead of failing it", async () => {
    const realSetTimeout = setTimeout;
    const record = createScriptedEchoRequestRecord();
    runtime = createScriptedEchoRuntime({
      runtime: { workspacePath: tmpDir, env: record.env, onEvent: () => {} },
      launch: {
        scripted: {
          swallowTurnStart: true,
          turnStartResponseDelayMs: 600_000,
        },
      },
    });
    const liveRuntime = runtime;

    await liveRuntime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });

    vi.useFakeTimers();
    try {
      const turnStart = liveRuntime.runTurn({
        clientRequestId: "creq_222222222u",
        threadId: "t1",
        input: [promptTextInput({ text: "hello" })],
        options: fullRuntimeOptions,
      });
      for (
        let attempt = 0;
        record.last("turn/start") === undefined;
        attempt += 1
      ) {
        if (attempt >= 1_000) {
          throw new Error("The bridge never received turn/start");
        }
        await new Promise((resolve) => realSetTimeout(resolve, 10));
      }
      await vi.advanceTimersByTimeAsync(30_001);

      await expect(turnStart).resolves.toEqual({ status: "unconfirmed" });
      expect(liveRuntime.getLiveThreadIds()).toEqual(["t1"]);
      await expect(
        liveRuntime.runTurn({
          clientRequestId: "creq_222222222v",
          threadId: "t1",
          input: [promptTextInput({ text: "competing" })],
          options: fullRuntimeOptions,
        }),
      ).rejects.toThrow(CompetingTurnError);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails a timed-out turn start once the provider answers it with an error", async () => {
    const realSetTimeout = setTimeout;
    const events: ThreadEvent[] = [];
    const record = createScriptedEchoRequestRecord();
    runtime = createScriptedEchoRuntime({
      runtime: {
        workspacePath: tmpDir,
        env: record.env,
        onEvent: (event) => events.push(event),
      },
      launch: { scripted: { turnStartErrorAfterMs: 1_500 } },
    });
    const liveRuntime = runtime;

    await liveRuntime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });

    vi.useFakeTimers();
    try {
      const turnStart = liveRuntime.runTurn({
        clientRequestId: "creq_222222222t",
        threadId: "t1",
        input: [promptTextInput({ text: "hello" })],
        options: fullRuntimeOptions,
      });
      for (
        let attempt = 0;
        record.last("turn/start") === undefined;
        attempt += 1
      ) {
        if (attempt >= 1_000) {
          throw new Error("The bridge never received turn/start");
        }
        await new Promise((resolve) => realSetTimeout(resolve, 10));
      }
      await vi.advanceTimersByTimeAsync(30_001);
      await expect(turnStart).resolves.toEqual({ status: "unconfirmed" });
    } finally {
      vi.useRealTimers();
    }

    const failure = await waitFor(() =>
      events.find(
        (event) =>
          event.type === "system/error" &&
          event.code === "provider_turn_start_failed",
      ),
    );
    expect(failure).toMatchObject({
      threadId: "t1",
      scope: { kind: "thread" },
    });
    expect(liveRuntime.getLiveThreadIds()).toEqual([]);
  });

  it("stays silent when the turn starts within the threshold", async () => {
    const events: ThreadEvent[] = [];
    runtime = createScriptedEchoRuntime({
      runtime: {
        workspacePath: tmpDir,
        onEvent: (event) => events.push(event),
        turnStartWatchdog: { thresholdMs: 150, intervalMs: 25 },
      },
    });

    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await runtime.runTurn({
      clientRequestId: "creq_222222222x",
      threadId: "t1",
      input: [promptTextInput({ text: "hello" })],
      options: fullRuntimeOptions,
    });

    await waitFor(() => events.find((event) => event.type === "turn/started"));
    await wait(250);
    expect(
      events.some(
        (event) =>
          event.type === "system/error" &&
          event.code === "provider_turn_start_timeout",
      ),
    ).toBe(false);
  });
});
