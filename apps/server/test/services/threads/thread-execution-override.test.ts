import { describe, expect, it } from "vitest";
import { resolveThreadExecutionOverrideUpdate } from "../../../src/services/threads/thread-execution-override.js";
import { availableModelFixture } from "../../helpers/available-models.js";

const OPUS = availableModelFixture({
  model: "claude-opus-4-8",
  reasoningLevels: ["low", "medium", "high", "xhigh", "max"],
  defaultReasoningLevel: "medium",
});
const HAIKU = availableModelFixture({ model: "claude-haiku-4-5" });
const CATALOG = [OPUS, HAIKU];
const EMPTY = { modelOverride: null, reasoningLevelOverride: null };

describe("resolveThreadExecutionOverrideUpdate", () => {
  it("sets a model that is present in the active catalog", () => {
    expect(
      resolveThreadExecutionOverrideUpdate({
        existing: EMPTY,
        patch: { model: "claude-opus-4-8" },
        models: CATALOG,
        providerId: "claude-code",
        fallbackModel: null,
      }),
    ).toEqual({
      modelOverride: "claude-opus-4-8",
      reasoningLevelOverride: null,
    });
  });

  it("rejects a model absent from the provider's catalog (cross-provider/unknown)", () => {
    expect(() =>
      resolveThreadExecutionOverrideUpdate({
        existing: EMPTY,
        patch: { model: "gpt-5" },
        models: CATALOG,
        providerId: "claude-code",
        fallbackModel: null,
      }),
    ).toThrow(/not available for provider claude-code/);
  });

  it("accepts an explicit reasoning level supported by the target model", () => {
    expect(
      resolveThreadExecutionOverrideUpdate({
        existing: EMPTY,
        patch: { model: "claude-opus-4-8", reasoningLevel: "high" },
        models: CATALOG,
        providerId: "claude-code",
        fallbackModel: null,
      }),
    ).toEqual({
      modelOverride: "claude-opus-4-8",
      reasoningLevelOverride: "high",
    });
  });

  it("rejects an explicit reasoning level the target model does not support", () => {
    expect(() =>
      resolveThreadExecutionOverrideUpdate({
        existing: EMPTY,
        patch: { model: "claude-haiku-4-5", reasoningLevel: "max" },
        models: CATALOG,
        providerId: "claude-code",
        fallbackModel: null,
      }),
    ).toThrow(/Reasoning level "max" is not supported by model "claude-haiku-4-5"/);
  });

  it("reconciles an incompatible stored reasoning level on a model-only change", () => {
    // Switching to Haiku (supports only "low") with a stored "max" override
    // reconciles down to the closest supported level rather than failing.
    expect(
      resolveThreadExecutionOverrideUpdate({
        existing: { modelOverride: "claude-opus-4-8", reasoningLevelOverride: "max" },
        patch: { model: "claude-haiku-4-5" },
        models: CATALOG,
        providerId: "claude-code",
        fallbackModel: null,
      }),
    ).toEqual({
      modelOverride: "claude-haiku-4-5",
      reasoningLevelOverride: "low",
    });
  });

  it("keeps a compatible stored reasoning level on a model-only change", () => {
    expect(
      resolveThreadExecutionOverrideUpdate({
        existing: { modelOverride: "claude-haiku-4-5", reasoningLevelOverride: "high" },
        patch: { model: "claude-opus-4-8" },
        models: CATALOG,
        providerId: "claude-code",
        fallbackModel: null,
      }),
    ).toEqual({
      modelOverride: "claude-opus-4-8",
      reasoningLevelOverride: "high",
    });
  });

  it("clears both overrides when both are set to null", () => {
    expect(
      resolveThreadExecutionOverrideUpdate({
        existing: { modelOverride: "claude-opus-4-8", reasoningLevelOverride: "high" },
        patch: { model: null, reasoningLevel: null },
        models: CATALOG,
        providerId: "claude-code",
        fallbackModel: null,
      }),
    ).toEqual(EMPTY);
  });

  it("validates a reasoning-only change against the fallback (next-turn) model", () => {
    // No model override or model in the patch → validate against the model the
    // next turn would otherwise use (fallbackModel = Haiku, supports only low).
    expect(() =>
      resolveThreadExecutionOverrideUpdate({
        existing: EMPTY,
        patch: { reasoningLevel: "high" },
        models: CATALOG,
        providerId: "claude-code",
        fallbackModel: "claude-haiku-4-5",
      }),
    ).toThrow(/not supported by model "claude-haiku-4-5"/);

    expect(
      resolveThreadExecutionOverrideUpdate({
        existing: EMPTY,
        patch: { reasoningLevel: "xhigh" },
        models: CATALOG,
        providerId: "claude-code",
        fallbackModel: "claude-opus-4-8",
      }),
    ).toEqual({ modelOverride: null, reasoningLevelOverride: "xhigh" });
  });

  it("leaves an unspecified field unchanged", () => {
    expect(
      resolveThreadExecutionOverrideUpdate({
        existing: { modelOverride: "claude-opus-4-8", reasoningLevelOverride: "high" },
        patch: { reasoningLevel: "max" },
        models: CATALOG,
        providerId: "claude-code",
        fallbackModel: null,
      }),
    ).toEqual({
      modelOverride: "claude-opus-4-8",
      reasoningLevelOverride: "max",
    });
  });
});
