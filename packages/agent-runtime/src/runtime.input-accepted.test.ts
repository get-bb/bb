import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadEvent } from "@bb/domain";
import { getThreadEventScopeTurnId } from "@bb/domain";
import { BRIDGE_JSON_RPC_ERRORS } from "@bb/provider-bridge-protocol";
import {
  createScriptedEchoRequestRecord,
  createScriptedEchoRuntime,
  fullRuntimeOptions,
  waitForThreadTurnStarted,
} from "./test/runtime-test-harness.js";
import { promptTextInput } from "./test/prompt-input.js";

function inputAcceptedEvents(
  events: readonly ThreadEvent[],
  clientRequestId: string,
): ThreadEvent[] {
  return events.filter(
    (event) =>
      event.type === "turn/input/accepted" &&
      event.clientRequestId === clientRequestId,
  );
}

describe("createAgentRuntime input accepted events", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "bb-runtime-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("scopes an accepted steer's input event to the active turn", async () => {
    const events: ThreadEvent[] = [];
    const runtime = createScriptedEchoRuntime({
      runtime: {
        workspacePath: tmpDir,
        onEvent: (event) => events.push(event),
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
      clientRequestId: "creq_222222222u",
      threadId: "t1",
      input: [promptTextInput({ text: "delay:500 active turn" })],
      options: fullRuntimeOptions,
    });
    const { turnId } = await waitForThreadTurnStarted({
      events,
      providerId: "fake",
      runtime,
      threadId: "t1",
    });

    await expect(
      runtime.steerTurn({
        threadId: "t1",
        expectedTurnId: turnId,
        clientRequestId: "creq_23456789ae",
        input: [promptTextInput({ text: "accepted steer" })],
        options: fullRuntimeOptions,
      }),
    ).resolves.toEqual({ status: "steered" });

    const accepted = inputAcceptedEvents(events, "creq_23456789ae");
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({
      type: "turn/input/accepted",
      threadId: "t1",
      providerThreadId: "prov-1",
      clientRequestId: "creq_23456789ae",
    });
    expect(getThreadEventScopeTurnId(accepted[0]?.scope)).toBe(turnId);

    await runtime.shutdown();
  });

  it("throws a rejected steer and keeps the active turn", async () => {
    const events: ThreadEvent[] = [];
    const runtime = createScriptedEchoRuntime({
      runtime: {
        workspacePath: tmpDir,
        onEvent: (event) => events.push(event),
      },
      launch: {
        scripted: {
          failMethods: [{ method: "turn/steer", message: "No active session" }],
        },
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
      clientRequestId: "creq_222222222v",
      threadId: "t1",
      input: [promptTextInput({ text: "delay:500 active turn" })],
      options: fullRuntimeOptions,
    });
    const { turnId } = await waitForThreadTurnStarted({
      events,
      providerId: "fake",
      runtime,
      threadId: "t1",
    });

    await expect(
      runtime.steerTurn({
        clientRequestId: "creq_222222222w",
        threadId: "t1",
        expectedTurnId: turnId,
        input: [promptTextInput({ text: "rejected steer" })],
        options: fullRuntimeOptions,
      }),
    ).rejects.toThrow(/No active session/);

    expect(runtime.getActiveTurnId("t1")).toBe(turnId);

    await runtime.shutdown();
  });

  it("reports a timed-out steer as unconfirmed and keeps the provider's late acceptance", async () => {
    const realSetTimeout = setTimeout;
    const sleepReal = (ms: number): Promise<void> =>
      new Promise((resolve) => {
        realSetTimeout(resolve, ms);
      });
    const events: ThreadEvent[] = [];
    const record = createScriptedEchoRequestRecord();
    const runtime = createScriptedEchoRuntime({
      runtime: {
        workspacePath: tmpDir,
        env: record.env,
        onEvent: (event) => events.push(event),
      },
      launch: { scripted: { steerResponseDelayMs: 1_000 } },
    });

    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await runtime.runTurn({
      clientRequestId: "creq_2345678tsa",
      threadId: "t1",
      input: [promptTextInput({ text: "delay:5000 active turn" })],
      options: fullRuntimeOptions,
    });
    const { turnId } = await waitForThreadTurnStarted({
      events,
      providerId: "fake",
      runtime,
      threadId: "t1",
    });

    vi.useFakeTimers();
    try {
      const steer = runtime.steerTurn({
        clientRequestId: "creq_2345678tsb",
        threadId: "t1",
        expectedTurnId: turnId,
        input: [promptTextInput({ text: "slow steer" })],
        options: fullRuntimeOptions,
      });
      for (
        let attempt = 0;
        record.last("turn/steer") === undefined;
        attempt += 1
      ) {
        if (attempt >= 1_000) {
          throw new Error("The bridge never received turn/steer");
        }
        await sleepReal(10);
      }
      await vi.advanceTimersByTimeAsync(30_001);

      await expect(steer).resolves.toEqual({ status: "unconfirmed" });
      expect(inputAcceptedEvents(events, "creq_2345678tsb")).toEqual([]);
    } finally {
      vi.useRealTimers();
    }

    await vi.waitFor(
      () => {
        expect(inputAcceptedEvents(events, "creq_2345678tsb")).toHaveLength(1);
      },
      { timeout: 5_000 },
    );
    expect(runtime.getActiveTurnId("t1")).toBe(turnId);

    await runtime.shutdown();
  });

  it.each([
    {
      name: "a staleTurn recovery hint",
      recovery: { kind: "staleTurn" as const, retryable: false },
    },
    { name: "the no-active-turn code alone", recovery: undefined },
  ])(
    "maps a steer rejection with $name to a stale steer",
    async ({ recovery }) => {
      const events: ThreadEvent[] = [];
      const record = createScriptedEchoRequestRecord();
      const runtime = createScriptedEchoRuntime({
        runtime: {
          workspacePath: tmpDir,
          env: record.env,
          onEvent: (event) => events.push(event),
        },
        launch: {
          scripted: {
            failMethods: [
              {
                method: "turn/steer",
                message: "No active turn to steer",
                code: BRIDGE_JSON_RPC_ERRORS.NO_ACTIVE_TURN,
                ...(recovery === undefined ? {} : { recovery }),
              },
            ],
          },
        },
      });

      await runtime.startThread({
        environmentId: "env-1",
        threadId: "t1",
        projectId: "p1",
        providerId: "acp-cursor",
        options: fullRuntimeOptions,
      });
      await runtime.runTurn({
        clientRequestId: "creq_222222222x",
        threadId: "t1",
        input: [promptTextInput({ text: "delay:500 active turn" })],
        options: fullRuntimeOptions,
      });
      const { turnId } = await waitForThreadTurnStarted({
        events,
        providerId: "acp-cursor",
        runtime,
        threadId: "t1",
      });

      await expect(
        runtime.steerTurn({
          clientRequestId: "creq_222222222y",
          threadId: "t1",
          expectedTurnId: turnId,
          input: [promptTextInput({ text: "late steer" })],
          options: fullRuntimeOptions,
        }),
      ).resolves.toEqual({ status: "stale", activeTurnId: null });
      expect(runtime.getActiveTurnId("t1")).toBeNull();
      const steersSentSoFar = record
        .read()
        .filter((request) => request.method === "turn/steer").length;
      expect(steersSentSoFar).toBe(1);

      await expect(
        runtime.steerTurn({
          clientRequestId: "creq_222222222z",
          threadId: "t1",
          expectedTurnId: turnId,
          input: [promptTextInput({ text: "still late" })],
          options: fullRuntimeOptions,
        }),
      ).resolves.toEqual({ status: "stale", activeTurnId: null });
      expect(
        record.read().filter((request) => request.method === "turn/steer"),
      ).toHaveLength(1);

      await runtime.shutdown();
    },
  );
});
