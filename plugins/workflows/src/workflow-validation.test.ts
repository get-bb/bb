import { describe, expect, it } from "vitest";
import {
  validateWorkflowSource,
  type WorkflowCatalogDependencies,
} from "./workflow-validation.js";

const SOURCE = `export const meta = {
  name: "catalog-test",
  description: "Validate a literal selection",
};
return agent("review", {
  provider: "codex",
  model: "gpt-test",
  reasoningLevel: "medium",
});`;

function catalog(
  overrides: Partial<WorkflowCatalogDependencies> = {},
): WorkflowCatalogDependencies {
  return {
    listProviders: async () => [{ id: "codex", available: true }],
    loadModels: async () => ({
      modelLoadError: null,
      selectedOnlyModels: [],
      models: [
        {
          id: "gpt-test",
          model: "gpt-test",
          reasoningDiscovery: "known",
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
        },
      ],
    }),
    ...overrides,
  };
}

describe("workflow validation", () => {
  it.each([
    { discovery: "known", requested: "medium", accepted: true },
    { discovery: "known", requested: "high", accepted: false },
    { discovery: "unknown", requested: "medium", accepted: false },
  ] as const)(
    "handles native reasoning defaults: $discovery/$requested",
    async ({ discovery, requested, accepted }) => {
      const validation = validateWorkflowSource(
        SOURCE.replace(
          'reasoningLevel: "medium"',
          `reasoningLevel: "${requested}"`,
        ),
        "env-1",
        catalog({
          loadModels: async () => ({
            modelLoadError: null,
            selectedOnlyModels: [],
            models: [
              {
                id: "gpt-test",
                model: "gpt-test",
                reasoningDiscovery: discovery,
                supportedReasoningEfforts: [],
                defaultReasoningEffort: "medium",
              },
            ],
          }),
        }),
      );
      if (accepted) {
        await expect(validation).resolves.toMatchObject({ valid: true });
      } else {
        await expect(validation).rejects.toThrow("Unsupported reasoning level");
      }
    },
  );

  it("validates every safely discoverable literal tuple", async () => {
    await expect(
      validateWorkflowSource(SOURCE, "env-1", catalog()),
    ).resolves.toMatchObject({
      valid: true,
      metadata: { name: "catalog-test" },
      literalSelections: [
        {
          provider: "codex",
          model: "gpt-test",
          reasoningLevel: "medium",
        },
      ],
    });
  });

  it("returns canonical phase metadata and validates native display options", async () => {
    const source = `export const meta = {
      name: "phase-validation",
      description: "Validate phases",
      phases: [{ title: "Inspect", detail: "Read first" }, { title: "Verify" }],
    };
    return agent("review", {
      label: "Reader",
      phase: "Inspect",
      schema: { type: "object" },
    });`;

    await expect(
      validateWorkflowSource(source, "env-1", catalog()),
    ).resolves.toMatchObject({
      metadata: {
        phases: [
          { title: "Inspect", detail: "Read first" },
          { title: "Verify", detail: null },
        ],
      },
    });
  });

  it("distinguishes provider, model-load, model, and reasoning failures", async () => {
    await expect(
      validateWorkflowSource(
        SOURCE,
        "env-1",
        catalog({ listProviders: async () => [] }),
      ),
    ).rejects.toThrow("Unavailable provider");
    await expect(
      validateWorkflowSource(
        SOURCE,
        "env-1",
        catalog({
          loadModels: async () => ({
            models: [],
            selectedOnlyModels: [],
            modelLoadError: { providerId: "codex", code: "auth_required" },
          }),
        }),
      ),
    ).rejects.toThrow("Model-load error");
    await expect(
      validateWorkflowSource(
        SOURCE,
        "env-1",
        catalog({
          loadModels: async () => {
            throw new Error("host disconnected");
          },
        }),
      ),
    ).rejects.toThrow("Model-load error for provider codex: host disconnected");
    await expect(
      validateWorkflowSource(
        SOURCE,
        "env-1",
        catalog({
          loadModels: async () => ({
            models: [],
            selectedOnlyModels: [],
            modelLoadError: null,
          }),
        }),
      ),
    ).rejects.toThrow("Model mismatch");
    await expect(
      validateWorkflowSource(
        SOURCE,
        "env-1",
        catalog({
          loadModels: async () => ({
            selectedOnlyModels: [],
            modelLoadError: null,
            models: [
              {
                id: "gpt-test",
                model: "gpt-test",
                reasoningDiscovery: "known",
                defaultReasoningEffort: "high",
                supportedReasoningEfforts: [{ reasoningEffort: "high" }],
              },
            ],
          }),
        }),
      ),
    ).rejects.toThrow("Unsupported reasoning");
  });

  it("rejects selected-only models for explicit literal selections", async () => {
    await expect(
      validateWorkflowSource(
        SOURCE,
        "env-1",
        catalog({
          loadModels: async () => ({
            models: [],
            selectedOnlyModels: [
              {
                id: "gpt-test",
                model: "gpt-test",
                reasoningDiscovery: "known",
                defaultReasoningEffort: "medium",
                supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
              },
            ],
            modelLoadError: null,
          }),
        }),
      ),
    ).rejects.toThrow("Model mismatch");
  });
});
