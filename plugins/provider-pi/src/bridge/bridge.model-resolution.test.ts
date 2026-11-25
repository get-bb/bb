import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { PI_BRIDGE_ARGS_ENV, PI_BRIDGE_COMMAND_ENV } from "./rpc-child.js";
import {
  FULL_PERMISSION_OPTIONS,
  type FakePiBridgeHarness,
  fakePiPath,
  startFakePiBridge,
} from "./test-support.js";

let harness: FakePiBridgeHarness;

beforeEach(async () => {
  harness = await startFakePiBridge({
    prefix: "bb-pi-model-resolution-",
    initialize: true,
  });
}, 30_000);

afterEach(async () => {
  await harness.teardown();
}, 30_000);

for (const warm of [false, true]) {
  it.each([
    ["fake-gateway/vendor/slash-model", 64_000],
    ["vendor/slash-model", 64_000],
    ["fake-provider/fake-model", 200_000],
    ["fake-gateway/vendor/shared-model", 64_000],
  ])(
    `starts the exact model %s with a ${warm ? "warm" : "cold"} catalog`,
    async (model, contextWindow) => {
      if (warm) {
        const catalog = await harness.request(1, "model/list", {
          envVars: {},
          cwd: harness.workspaceDir,
        });
        expect(catalog.error).toBeUndefined();
      }
      const threadId = "thr_model_resolution";
      const response = await harness.startThread(threadId, {
        options: { ...FULL_PERMISSION_OPTIONS, model },
      });
      expect(response.error, JSON.stringify(response)).toBeUndefined();
      const { providerThreadId } = z
        .object({ providerThreadId: z.string() })
        .parse(response.result);
      const turn = await harness.request(2, "turn/start", {
        threadId,
        providerThreadId,
        clientRequestId: "creq_ab23456789",
        input: [{ type: "text", text: "hello", mentions: [] }],
        options: { ...FULL_PERMISSION_OPTIONS, model },
      });
      expect(turn.error, JSON.stringify(turn)).toBeUndefined();
      await harness.waitForTurnBoundary(threadId, 0);
      expect(harness.deltasOf(threadId)).toContainEqual(
        expect.objectContaining({ kind: "contextWindow", size: contextWindow }),
      );
    },
    60_000,
  );

  it.each([
    ["vendor/shared-model", "Ambiguous Pi model"],
    ["fake-provider/missing", "Failed to resolve Pi model"],
    ["unknown/missing", "Failed to resolve Pi model"],
  ])(
    `rejects %s during resolution with a ${warm ? "warm" : "cold"} catalog`,
    async (model, message) => {
      if (warm) {
        const catalog = await harness.request(1, "model/list", {
          envVars: {},
          cwd: harness.workspaceDir,
        });
        expect(catalog.error).toBeUndefined();
      }
      const response = await harness.startThread("thr_model_resolution", {
        options: { ...FULL_PERMISSION_OPTIONS, model },
      });
      expect(response.error).toMatchObject({
        message: expect.stringContaining(message),
      });
    },
    60_000,
  );
}

it("resolves the model with the Pi command the thread env selects", async () => {
  vi.stubEnv(PI_BRIDGE_COMMAND_ENV, join(harness.workspaceDir, "missing-pi"));
  const response = await harness.startThread("thr_model_resolution", {
    options: {
      ...FULL_PERMISSION_OPTIONS,
      model: "fake-provider/fake-model",
      envVars: {
        [PI_BRIDGE_COMMAND_ENV]: process.execPath,
        [PI_BRIDGE_ARGS_ENV]: JSON.stringify([fakePiPath]),
      },
    },
  });
  expect(response.error, JSON.stringify(response)).toBeUndefined();
}, 60_000);
