// `bb.experimental_aiServices.complete` — the consumer half of AI services.
//
// The interesting behaviour is entirely in the boundary: which failures get
// which name, that a plugin's plain JSON Schema needs no conversion to reach
// bb's own validator, and that the budget a plugin states is the one that is
// spent. The routing itself is inferenceComplete's, covered in ai/inference.

import {
  PLUGIN_AI_COMPLETION_DEFAULT_TIMEOUT_MS,
  PLUGIN_AI_COMPLETION_MAX_TIMEOUT_MS,
} from "@get-bb/plugin-sdk/internal/host-policy";
import { describe, expect, it } from "vitest";
import { INFERENCE_POLICY } from "../../../src/services/ai/inference.js";
import { completePluginAiRequest } from "../../../src/services/ai/plugin-completion.js";
import { registerFakeAiService } from "../../helpers/ai-services.js";
import { seedHostSession } from "../../helpers/seed.js";
import { withTestHarness } from "../../helpers/test-app.js";

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    providerId: { type: "string" },
    model: { type: "string" },
  },
  required: ["providerId", "model"],
  additionalProperties: false,
};

function request(overrides: Record<string, unknown> = {}) {
  return {
    pluginId: "model-router",
    prompt: "Where should this go?",
    outputSchema: OUTPUT_SCHEMA,
    ...overrides,
  };
}

describe("the shared timeout policy", () => {
  it("keeps the SDK's default equal to core's helper-inference budget", () => {
    // The SDK cannot import the server's policy, so the constant plugins are
    // documented against is a copy. This is what keeps the copy honest — the
    // same arrangement SERVER_DIRECT_AI_SERVICE_IDS uses.
    expect(PLUGIN_AI_COMPLETION_DEFAULT_TIMEOUT_MS).toBe(
      INFERENCE_POLICY.threadMetadata.timeoutMs,
    );
    expect(PLUGIN_AI_COMPLETION_MAX_TIMEOUT_MS).toBeGreaterThan(
      PLUGIN_AI_COMPLETION_DEFAULT_TIMEOUT_MS,
    );
  });
});

describe("completePluginAiRequest", () => {
  it("returns the validated value and spends the stated budget", async () => {
    await withTestHarness(
      { inferenceModel: "acme/router-1" },
      async (harness) => {
        seedHostSession(harness.deps);
        const fake = registerFakeAiService(harness.deps.aiServices, {
          id: "acme",
          completeInference: () => ({
            ok: true,
            model: "router-1",
            value: { providerId: "codex", model: "gpt-5" },
          }),
        });

        await expect(
          completePluginAiRequest(
            harness.deps,
            request({ timeoutMs: 7_000 }),
          ),
        ).resolves.toEqual({ providerId: "codex", model: "gpt-5" });

        const call = fake.inferenceCalls[0];
        expect(call.input.timeoutMs).toBe(7_000);
        // The plugin's plain JSON Schema reaches the service unconverted: bb
        // hands it to the same validator its own helper completions use.
        expect(call.input.outputSchema).toEqual(OUTPUT_SCHEMA);
        fake.dispose();
      },
    );
  });

  it("falls back to core's budget when the plugin states none, and caps a huge one", async () => {
    await withTestHarness(
      { inferenceModel: "acme/router-1" },
      async (harness) => {
        seedHostSession(harness.deps);
        const fake = registerFakeAiService(harness.deps.aiServices, {
          id: "acme",
          completeInference: () => ({
            ok: true,
            model: "router-1",
            value: { providerId: "codex", model: "gpt-5" },
          }),
        });

        await completePluginAiRequest(harness.deps, request());
        expect(fake.inferenceCalls[0].input.timeoutMs).toBe(
          PLUGIN_AI_COMPLETION_DEFAULT_TIMEOUT_MS,
        );

        // A plugin cannot park a caller behind an unbounded model call.
        await completePluginAiRequest(
          harness.deps,
          request({ timeoutMs: 10 * 60_000 }),
        );
        expect(fake.inferenceCalls[1].input.timeoutMs).toBe(
          PLUGIN_AI_COMPLETION_MAX_TIMEOUT_MS,
        );
        fake.dispose();
      },
    );
  });

  it("makes exactly one attempt, never falling back to the fallback model", async () => {
    // bb's own helper callers retry onto BB_INFERENCE_FALLBACK, which can take
    // twice the stated budget. A dispatch gate is boxed at 10s and fails its
    // dispatch when the box expires, so a hidden second attempt would turn a
    // plugin's honest budget into a dispatch failure.
    await withTestHarness(
      {
        inferenceModel: "acme/router-1",
        inferenceFallbackModel: "acme/router-2",
      },
      async (harness) => {
        seedHostSession(harness.deps);
        const fake = registerFakeAiService(harness.deps.aiServices, {
          id: "acme",
          completeInference: () => ({
            ok: false,
            code: "rate_limited",
            message: "slow down",
          }),
        });

        await expect(
          completePluginAiRequest(harness.deps, request()),
        ).rejects.toMatchObject({
          name: "PluginAiCompletionError",
          failure: "request-failed",
        });
        expect(fake.inferenceCalls).toHaveLength(1);
        fake.dispose();
      },
    );
  });

  it("names a timeout as itself", async () => {
    await withTestHarness(
      { inferenceModel: "acme/router-1" },
      async (harness) => {
        seedHostSession(harness.deps);
        const fake = registerFakeAiService(harness.deps.aiServices, {
          id: "acme",
          completeInference: () => ({
            ok: false,
            code: "timeout",
            message: "took too long",
          }),
        });

        await expect(
          completePluginAiRequest(harness.deps, request()),
        ).rejects.toMatchObject({
          name: "PluginAiCompletionError",
          failure: "timeout",
        });
        fake.dispose();
      },
    );
  });

  it("names an answer that does not satisfy the schema as a validation failure", async () => {
    await withTestHarness(
      { inferenceModel: "acme/router-1" },
      async (harness) => {
        seedHostSession(harness.deps);
        const fake = registerFakeAiService(harness.deps.aiServices, {
          id: "acme",
          completeInference: () => ({
            ok: false,
            code: "invalid_response",
            message: "not JSON",
          }),
        });

        await expect(
          completePluginAiRequest(harness.deps, request()),
        ).rejects.toMatchObject({
          name: "PluginAiCompletionError",
          failure: "validation-failed",
        });
        fake.dispose();
      },
    );
  });

  it("names an unreachable inference setting as no-service-configured, before sending anything", async () => {
    // The distinction a plugin reports to its user: this is the one failure
    // that means "there is something to fix in settings".
    await withTestHarness(
      { inferenceModel: "nobody/serves-this" },
      async (harness) => {
        seedHostSession(harness.deps);
        await expect(
          completePluginAiRequest(harness.deps, request()),
        ).rejects.toMatchObject({
          name: "PluginAiCompletionError",
          failure: "no-service-configured",
        });
      },
    );
  });

  it("refuses a schema that could never be satisfied by a tool call", async () => {
    // The answer arrives as tool-call arguments, which are always an object;
    // a non-object root would time out against a model that cannot comply.
    await withTestHarness(
      { inferenceModel: "acme/router-1" },
      async (harness) => {
        seedHostSession(harness.deps);
        await expect(
          completePluginAiRequest(
            harness.deps,
            request({ outputSchema: { type: "string" } }),
          ),
        ).rejects.toThrow(/root type "object"/u);
        await expect(
          completePluginAiRequest(harness.deps, request({ prompt: "  " })),
        ).rejects.toThrow(/non-empty prompt/u);
      },
    );
  });
});
