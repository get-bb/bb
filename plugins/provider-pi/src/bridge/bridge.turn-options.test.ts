import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import type {
  BridgeJsonRpcObject,
  BridgeJsonRpcOutputMessage,
} from "@get-bb/plugin-sdk/provider-bridge/testing";
import {
  FULL_PERMISSION_OPTIONS,
  type FakePiBridgeHarness,
  startFakePiBridge,
} from "./test-support.js";

const TURN_OPTIONS_TEST_TIMEOUT_MS = 60_000;

const MINI = {
  ...FULL_PERMISSION_OPTIONS,
  model: "fake-provider/fake-mini",
  reasoningLevel: "medium",
};
const FULL_MODEL = { ...MINI, model: "fake-provider/fake-model" };

const sessionReplacedParamsSchema = z.object({
  threadId: z.string(),
  providerThreadId: z.string().nullable(),
  reason: z.string(),
  contextLost: z.boolean(),
});

let harness: FakePiBridgeHarness;
let commandLogPath: string;

beforeEach(async () => {
  harness = await startFakePiBridge({
    prefix: "bb-pi-turn-options-",
    initialize: true,
    processLog: true,
  });
  commandLogPath = join(harness.workspaceDir, "commands.log");
  vi.stubEnv("FAKE_PI_COMMAND_LOG", commandLogPath);
}, 30_000);

afterEach(async () => {
  await harness.teardown();
}, 30_000);

function sessionReplacements(
  threadId: string,
): z.infer<typeof sessionReplacedParamsSchema>[] {
  return harness.messages
    .filter((message) => message.method === "session/replaced")
    .map((message) => sessionReplacedParamsSchema.parse(message.params))
    .filter((params) => params.threadId === threadId);
}

function contextWindowSizes(threadId: string): number[] {
  return harness
    .deltasOf(threadId)
    .filter((delta) => delta.kind === "contextWindow")
    .map((delta) => delta.size)
    .filter((size): size is number => typeof size === "number");
}

function providerThreadIdFor(threadId: string): string {
  const identity = [...harness.messages]
    .reverse()
    .find(
      (message) =>
        message.method === "thread/identity" &&
        (message.params as { threadId?: unknown }).threadId === threadId,
    );
  const providerThreadId = (identity?.params as { providerThreadId?: unknown })
    .providerThreadId;
  expect(typeof providerThreadId).toBe("string");
  if (typeof providerThreadId !== "string")
    throw new Error("missing provider thread identity");
  return providerThreadId;
}

function settingCommands(): string[] {
  return existsSync(commandLogPath)
    ? readFileSync(commandLogPath, "utf8")
        .split("\n")
        .filter((line) => line.startsWith("set_"))
    : [];
}

function turnStart(
  id: number,
  threadId: string,
  text: string,
  options: BridgeJsonRpcObject,
  settings: string[] = [],
): Promise<BridgeJsonRpcOutputMessage> {
  return harness.request(id, "turn/start", {
    threadId,
    providerThreadId: providerThreadIdFor(threadId),
    clientRequestId: `creq_abcdefghi${"23456789"[id % 8] ?? "2"}`,
    input: [{ type: "text", text, mentions: [] }],
    apply: { settings, sessionOptions: [], providerOptions: [] },
    options,
  });
}

it(
  "applies a listed model live, re-applies the thinking level, and keeps the child",
  async () => {
    const threadId = "thr_turn_options_model";
    await harness.startThread(threadId, { options: MINI });

    expect((await turnStart(1, threadId, "first", MINI)).result).toEqual({
      admission: "accepted",
    });
    let seen = await harness.waitForTurnBoundary(threadId, 0);
    expect(contextWindowSizes(threadId)).toEqual([32_000]);
    const spawned = harness.readProcessLog().spawned.length;

    expect(
      (await turnStart(2, threadId, "second", FULL_MODEL, ["model"])).result,
    ).toEqual({ admission: "accepted" });
    seen = await harness.waitForTurnBoundary(threadId, seen);

    expect(settingCommands()).toEqual([
      "set_model fake-provider/fake-model",
      "set_thinking_level medium",
    ]);
    expect(contextWindowSizes(threadId).at(-1)).toBe(200_000);
    expect(harness.readProcessLog().spawned).toHaveLength(spawned);
    expect(sessionReplacements(threadId)).toEqual([]);

    expect(
      (await turnStart(3, threadId, "third", FULL_MODEL)).error,
    ).toBeUndefined();
    await harness.waitForTurnBoundary(threadId, seen);
    expect(settingCommands()).toHaveLength(2);
  },
  TURN_OPTIONS_TEST_TIMEOUT_MS,
);

it(
  "applies a listed reasoning level live without touching the model",
  async () => {
    const threadId = "thr_turn_options_level";
    await harness.startThread(threadId, { options: MINI });
    const spawned = harness.readProcessLog().spawned.length;

    expect(
      (
        await turnStart(
          1,
          threadId,
          "first",
          { ...MINI, reasoningLevel: "high" },
          ["reasoningLevel"],
        )
      ).error,
    ).toBeUndefined();
    await harness.waitForTurnBoundary(threadId, 0);

    expect(settingCommands()).toEqual(["set_thinking_level high"]);
    expect(harness.readProcessLog().spawned).toHaveLength(spawned);
  },
  TURN_OPTIONS_TEST_TIMEOUT_MS,
);

it(
  "never compares settings itself: unlisted model and environment changes are not applied",
  async () => {
    const threadId = "thr_turn_options_unlisted";
    const envLog = join(harness.workspaceDir, "env.log");
    await harness.startThread(threadId, {
      options: {
        ...MINI,
        envVars: { FAKE_PI_ENV_LOG: envLog, FAKE_PI_ENV_MARKER: "first" },
      },
    });
    const spawned = harness.readProcessLog().spawned.length;

    expect(
      (
        await turnStart(1, threadId, "first", {
          ...FULL_MODEL,
          reasoningLevel: "high",
          envVars: { FAKE_PI_ENV_LOG: envLog, FAKE_PI_ENV_MARKER: "second" },
        })
      ).error,
    ).toBeUndefined();
    await harness.waitForTurnBoundary(threadId, 0);

    expect(settingCommands()).toEqual([]);
    expect(readFileSync(envLog, "utf8").trim().split("\n")).toEqual(["first"]);
    expect(contextWindowSizes(threadId)).toEqual([32_000]);
    expect(harness.readProcessLog().spawned).toHaveLength(spawned);
  },
  TURN_OPTIONS_TEST_TIMEOUT_MS,
);

it(
  "compacts with the model the compaction turn applied",
  async () => {
    const threadId = "thr_turn_options_compact";
    await harness.startThread(threadId, { options: MINI });

    expect((await turnStart(1, threadId, "first", MINI)).error).toBeUndefined();
    const seen = await harness.waitForTurnBoundary(threadId, 0);

    const compaction = await harness.request(2, "turn/start", {
      threadId,
      providerThreadId: providerThreadIdFor(threadId),
      clientRequestId: "creq_abcdefghij",
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
      apply: { settings: ["model"], sessionOptions: [], providerOptions: [] },
      options: FULL_MODEL,
    });
    expect(compaction.result).toEqual({ admission: "accepted" });

    await harness.waitForDelta(
      threadId,
      (delta) => delta.kind === "contextWindow" && delta.size === 200_000,
      seen,
    );
    expect(settingCommands()[0]).toBe("set_model fake-provider/fake-model");
    expect(sessionReplacements(threadId)).toEqual([]);
  },
  TURN_OPTIONS_TEST_TIMEOUT_MS,
);

it(
  "fails a turn whose listed model cannot be resolved and keeps the live session",
  async () => {
    const threadId = "thr_turn_options_bad_model";
    await harness.startThread(threadId, { options: MINI });

    expect((await turnStart(1, threadId, "first", MINI)).error).toBeUndefined();
    const seen = await harness.waitForTurnBoundary(threadId, 0);

    const failed = await turnStart(
      2,
      threadId,
      "second",
      { ...MINI, model: "no-such-model" },
      ["model"],
    );
    expect(failed.error).toMatchObject({
      code: -32000,
      message: 'Failed to resolve Pi model "no-such-model"',
    });
    expect(harness.deltasOf(threadId).slice(seen)).toEqual([]);

    expect((await turnStart(3, threadId, "third", MINI)).error).toBeUndefined();
    await harness.waitForTurnBoundary(threadId, seen);
    expect(contextWindowSizes(threadId).at(-1)).toBe(32_000);
  },
  TURN_OPTIONS_TEST_TIMEOUT_MS,
);

it(
  "steers the running turn without applying its options",
  async () => {
    const threadId = "thr_turn_options_steer";
    await harness.startThread(threadId, { options: MINI });

    expect((await turnStart(1, threadId, "/hold", MINI)).error).toBeUndefined();
    await harness.waitForDelta(threadId, (delta) => delta.kind === "turn.open");

    const steer = await harness.request(2, "turn/steer", {
      threadId,
      providerThreadId: providerThreadIdFor(threadId),
      clientRequestId: "creq_abcdefghik",
      expectedTurnId: "turn-1",
      input: [{ type: "text", text: "steered", mentions: [] }],
      options: FULL_MODEL,
    });
    expect(steer.result).toEqual({ admission: "accepted" });
    expect(settingCommands()).toEqual([]);
    expect(sessionReplacements(threadId)).toEqual([]);
  },
  TURN_OPTIONS_TEST_TIMEOUT_MS,
);

it(
  "opens and settles the turn of an input Pi handled without running the agent",
  async () => {
    const threadId = "thr_turn_options_handled";
    await harness.startThread(threadId, { options: MINI });

    expect((await turnStart(1, threadId, "/handled", MINI)).result).toEqual({
      admission: "accepted",
    });
    const seen = await harness.waitForTurnBoundary(threadId, 0);
    expect(
      harness
        .deltasOf(threadId)
        .filter((delta) => delta.kind !== "session.reset")
        .map((delta) => delta.kind),
    ).toEqual(["input.accepted", "turn.open", "turn.boundary"]);
    expect(
      harness
        .deltasOf(threadId)
        .find((delta) => delta.kind === "turn.boundary"),
    ).toMatchObject({ status: "completed" });

    expect((await turnStart(2, threadId, "after", MINI)).result).toEqual({
      admission: "accepted",
    });
    await harness.waitForTurnBoundary(threadId, seen);
  },
  TURN_OPTIONS_TEST_TIMEOUT_MS,
);
