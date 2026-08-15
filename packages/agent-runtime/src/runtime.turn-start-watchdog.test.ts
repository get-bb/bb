import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ThreadEvent } from "@bb/domain";
import { createAgentRuntimeWithAdapters } from "./runtime.js";
import type { AgentRuntime } from "./types.js";
import { createFakeAdapter, fakeProviderScriptPath } from "./test/index.js";
import { fullRuntimeOptions, wait } from "./test/runtime-test-harness.js";
import { promptTextInput } from "./test/prompt-input.js";

describe("turn-start watchdog", () => {
  let tmpDir: string;
  let runtime: AgentRuntime | null = null;

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
    runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: (event) => events.push(event),
      onToolCall: async () => ({ contentItems: [], success: true }),
      turnStartWatchdog: { thresholdMs: 120, intervalMs: 25 },
      adapterFactory: () => {
        const base = createFakeAdapter({ scriptPath: fakeProviderScriptPath });
        return {
          ...base,
          // The provider ACKs the dispatch (a benign request the script
          // answers) but never emits turn/started — the #1156/#1234 stall
          // shape the watchdog exists for.
          buildCommandPlan: (command) =>
            command.type === "turn/start"
              ? { kind: "request", method: "model/list", params: {} }
              : base.buildCommandPlan(command),
        };
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

    // One visible failure per stalled dispatch, not one per sweep.
    await wait(120);
    expect(
      events.filter(
        (event) =>
          event.type === "system/error" &&
          event.code === "provider_turn_start_timeout",
      ),
    ).toHaveLength(1);
  });

  it("stays silent when the turn starts within the threshold", async () => {
    const events: ThreadEvent[] = [];
    runtime = createAgentRuntimeWithAdapters({
      workspacePath: tmpDir,
      onEvent: (event) => events.push(event),
      onToolCall: async () => ({ contentItems: [], success: true }),
      turnStartWatchdog: { thresholdMs: 150, intervalMs: 25 },
      adapterFactory: () =>
        createFakeAdapter({ scriptPath: fakeProviderScriptPath }),
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
