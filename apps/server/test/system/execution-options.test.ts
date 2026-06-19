import { describe, expect, it } from "vitest";
import {
  appendCustomModels,
  resolveSystemExecutionOptions,
} from "../../src/services/system/execution-options.js";
import { availableModelFixture } from "../helpers/available-models.js";
import { registerProviderHostRpcResponder } from "../helpers/host-rpc.js";
import { seedHostSession } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("appendCustomModels", () => {
  it("appends custom models for the requested provider after the catalog", () => {
    const catalogModel = availableModelFixture({
      model: "claude-opus-4-8",
      isDefault: true,
    });

    const { models, selectedOnlyModels } = appendCustomModels({
      customModels: [
        {
          providerId: "claude-code",
          model: "claude-example-preview[1m]",
          displayName: "Example Preview (1M)",
        },
        { providerId: "pi", model: "anthropic/claude-example-preview" },
      ],
      models: [catalogModel],
      providerId: "claude-code",
      selectedOnlyModels: [],
    });

    expect(models.map((model) => model.model)).toEqual([
      "claude-opus-4-8",
      "claude-example-preview[1m]",
    ]);
    expect(models[1]).toMatchObject({
      id: "claude-example-preview[1m]",
      displayName: "Example Preview (1M)",
      defaultReasoningEffort: "medium",
      isDefault: false,
    });
    expect(selectedOnlyModels).toEqual([]);
  });

  it("advertises the full reasoning ladder for claude-code custom models", () => {
    const { models } = appendCustomModels({
      customModels: [
        { providerId: "claude-code", model: "claude-example-preview" },
      ],
      models: [],
      providerId: "claude-code",
      selectedOnlyModels: [],
    });

    expect(
      models[0].supportedReasoningEfforts.map(
        (effort) => effort.reasoningEffort,
      ),
    ).toEqual(["low", "medium", "high", "xhigh", "ultracode", "max"]);
  });

  it("caps codex and pi custom models at xhigh (no max)", () => {
    for (const providerId of ["codex", "pi"] as const) {
      const { models } = appendCustomModels({
        customModels: [{ providerId, model: "custom-model" }],
        models: [],
        providerId,
        selectedOnlyModels: [],
      });

      expect(
        models[0].supportedReasoningEfforts.map(
          (effort) => effort.reasoningEffort,
        ),
      ).toEqual(["low", "medium", "high", "xhigh"]);
    }
  });

  it("falls back to the model id when displayName is omitted", () => {
    const { models } = appendCustomModels({
      customModels: [
        { providerId: "claude-code", model: "claude-example-preview" },
      ],
      models: [],
      providerId: "claude-code",
      selectedOnlyModels: [],
    });

    expect(models).toHaveLength(1);
    expect(models[0].displayName).toBe("claude-example-preview");
  });

  it("keeps the catalog entry when a custom model id collides", () => {
    const catalogModel = availableModelFixture({ model: "claude-opus-4-8" });

    const { models } = appendCustomModels({
      customModels: [
        {
          providerId: "claude-code",
          model: "claude-opus-4-8",
          displayName: "Shadowed",
        },
      ],
      models: [catalogModel],
      providerId: "claude-code",
      selectedOnlyModels: [],
    });

    expect(models).toEqual([catalogModel]);
  });

  it("promotes a selected-only catalog entry instead of synthesizing one", () => {
    const retiredModel = availableModelFixture({
      model: "claude-opus-4-6",
      reasoningLevels: ["low", "medium"],
    });

    const { models, selectedOnlyModels } = appendCustomModels({
      customModels: [
        {
          providerId: "claude-code",
          model: "claude-opus-4-6",
          displayName: "Ignored",
        },
      ],
      models: [],
      providerId: "claude-code",
      selectedOnlyModels: [retiredModel],
    });

    // The catalog's accurate metadata wins over the synthesized entry, and the
    // promoted model leaves the selected-only pool so it never appears twice.
    expect(models).toEqual([retiredModel]);
    expect(selectedOnlyModels).toEqual([]);
  });

  it("ignores duplicate custom entries for the same model id", () => {
    const { models } = appendCustomModels({
      customModels: [
        {
          providerId: "claude-code",
          model: "claude-example-preview",
          displayName: "First",
        },
        {
          providerId: "claude-code",
          model: "claude-example-preview",
          displayName: "Second",
        },
      ],
      models: [],
      providerId: "claude-code",
      selectedOnlyModels: [],
    });

    expect(models).toHaveLength(1);
    expect(models[0].displayName).toBe("First");
  });

  it("returns the catalog unchanged when no custom models match", () => {
    const catalogModel = availableModelFixture({ model: "claude-opus-4-8" });
    const retiredModel = availableModelFixture({ model: "claude-opus-4-6" });

    const { models, selectedOnlyModels } = appendCustomModels({
      customModels: [
        { providerId: "pi", model: "anthropic/claude-example-preview" },
      ],
      models: [catalogModel],
      providerId: "claude-code",
      selectedOnlyModels: [retiredModel],
    });

    expect(models).toEqual([catalogModel]);
    expect(selectedOnlyModels).toEqual([retiredModel]);
  });
});

describe("resolveSystemExecutionOptions", () => {
  it("keeps custom models selectable when the provider model list fails to load", async () => {
    await withTestHarness(
      {
        customModels: [
          {
            providerId: "claude-code",
            model: "claude-example-preview",
            displayName: "Example Preview",
          },
        ],
      },
      async (harness) => {
        const { host, session } = seedHostSession(harness.deps, {
          id: "host-execution-options-model-load-error",
        });
        registerProviderHostRpcResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
          modelErrorsByProviderId: {
            "claude-code": {
              errorCode: "provider_rpc_error",
              errorMessage: "Provider failed",
            },
          },
        });

        const response = await resolveSystemExecutionOptions(harness.deps, {
          hostId: host.id,
          providerId: "claude-code",
        });

        expect(response.modelLoadError).toEqual({
          providerId: "claude-code",
          code: "failed",
        });
        expect(response.models).toEqual([
          expect.objectContaining({
            model: "claude-example-preview",
            displayName: "Example Preview",
          }),
        ]);
        expect(response.selectedOnlyModels).toEqual([]);
      },
    );
  });

  it("surfaces provider auth-required model load failures", async () => {
    await withTestHarness({}, async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-execution-options-auth-required",
      });
      registerProviderHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        modelErrorsByProviderId: {
          "acp-cursor": {
            errorCode: "auth_required",
            errorMessage: "Cursor agent is not authenticated.",
          },
        },
      });

      const response = await resolveSystemExecutionOptions(harness.deps, {
        hostId: host.id,
        providerId: "acp-cursor",
      });

      expect(response.modelLoadError).toEqual({
        providerId: "acp-cursor",
        code: "auth_required",
      });
      expect(response.models).toEqual([]);
      expect(response.selectedOnlyModels).toEqual([]);
    });
  });
});
