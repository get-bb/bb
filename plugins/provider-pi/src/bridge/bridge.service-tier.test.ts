import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { z } from "zod";
import type { BridgeJsonRpcObject } from "@get-bb/plugin-sdk/provider-bridge/testing";
import {
  FULL_PERMISSION_OPTIONS,
  type FakePiBridgeHarness,
  startFakePiBridge,
} from "./test-support.js";

const SERVICE_TIER_TEST_TIMEOUT_MS = 60_000;

const BASE_OPTIONS = {
  ...FULL_PERMISSION_OPTIONS,
  model: "fake-provider/fake-model",
  reasoningLevel: "medium",
};

const payloadSchema = z
  .object({
    service_tier: z.string().optional(),
    speed: z.string().optional(),
    betas: z.array(z.string()),
  })
  .passthrough();

let harness: FakePiBridgeHarness;
let payloadLog: string;
const savedEnv = new Map<string, string | undefined>();

function setEnv(name: string, value: string): void {
  if (!savedEnv.has(name)) savedEnv.set(name, process.env[name]);
  process.env[name] = value;
}

beforeEach(async () => {
  harness = await startFakePiBridge({
    prefix: "bb-pi-service-tier-",
    initialize: true,
  });
  payloadLog = join(harness.workspaceDir, "provider-payloads.jsonl");
  setEnv("FAKE_PI_PROVIDER_PAYLOAD_LOG", payloadLog);
}, 30_000);

afterEach(async () => {
  await harness.teardown();
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  savedEnv.clear();
}, 30_000);

function payloads(): z.infer<typeof payloadSchema>[] {
  if (!existsSync(payloadLog)) return [];
  return readFileSync(payloadLog, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => payloadSchema.parse(JSON.parse(line)));
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
  if (typeof providerThreadId !== "string") {
    throw new Error("missing provider thread identity");
  }
  return providerThreadId;
}

async function runTurn(
  id: number,
  threadId: string,
  options: BridgeJsonRpcObject,
  seen: number,
): Promise<number> {
  const response = await harness.request(id, "turn/start", {
    threadId,
    providerThreadId: providerThreadIdFor(threadId),
    clientRequestId: `creq_abcdefghi${"23456789"[id % 8] ?? "2"}`,
    input: [{ type: "text", text: `turn ${id}`, mentions: [] }],
    options,
  });
  expect(response.error).toBeUndefined();
  return harness.waitForTurnBoundary(threadId, seen);
}

function sessionReplacementCount(threadId: string): number {
  return harness.messages.filter(
    (message) =>
      message.method === "session/replaced" &&
      (message.params as { threadId?: unknown }).threadId === threadId,
  ).length;
}

it(
  "sends Codex Fast and Ultrafast as Codex service tiers without rebuilding",
  async () => {
    setEnv("FAKE_PI_MODEL_API", "openai-codex-responses");
    const threadId = "thr_pi_service_tier_codex";
    await harness.startThread(threadId, {
      options: { ...BASE_OPTIONS, serviceTier: "fast" },
    });

    let seen = await runTurn(
      1,
      threadId,
      { ...BASE_OPTIONS, serviceTier: "fast" },
      0,
    );
    seen = await runTurn(
      2,
      threadId,
      { ...BASE_OPTIONS, serviceTier: "ultrafast" },
      seen,
    );
    await runTurn(
      3,
      threadId,
      { ...BASE_OPTIONS, serviceTier: "default" },
      seen,
    );

    expect(payloads().map((payload) => payload.service_tier)).toEqual([
      "priority",
      "ultrafast",
      undefined,
    ]);
    expect(sessionReplacementCount(threadId)).toBe(0);
  },
  SERVICE_TIER_TEST_TIMEOUT_MS,
);

it(
  "sends Claude Fast as the fast-mode speed on supported Opus models",
  async () => {
    setEnv("FAKE_PI_MODEL_API", "anthropic-messages");
    setEnv("FAKE_PI_MODEL_PROVIDER", "anthropic");
    setEnv("FAKE_PI_MODEL_ID", "claude-opus-5");
    const threadId = "thr_pi_service_tier_claude";
    await harness.startThread(threadId, {
      options: { ...BASE_OPTIONS, serviceTier: "fast" },
    });

    await runTurn(1, threadId, { ...BASE_OPTIONS, serviceTier: "fast" }, 0);

    expect(payloads()).toEqual([
      {
        model: "claude-opus-5",
        speed: "fast",
        betas: ["existing-beta", "fast-mode-2026-02-01"],
      },
    ]);
  },
  SERVICE_TIER_TEST_TIMEOUT_MS,
);

it(
  "leaves requests unchanged on routes without service tiers",
  async () => {
    const threadId = "thr_pi_service_tier_other";
    await harness.startThread(threadId, {
      options: { ...BASE_OPTIONS, serviceTier: "fast" },
    });

    await runTurn(1, threadId, { ...BASE_OPTIONS, serviceTier: "fast" }, 0);

    expect(payloads()).toEqual([
      { model: "fake-model", betas: ["existing-beta"] },
    ]);
  },
  SERVICE_TIER_TEST_TIMEOUT_MS,
);
