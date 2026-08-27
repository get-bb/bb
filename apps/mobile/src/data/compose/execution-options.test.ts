import type { AvailableModel, ProviderInfo } from "@bb/domain";
import type { SystemExecutionOptionsResponse } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  buildPermissionModeOptions,
  buildProviderOptions,
  buildReasoningOptions,
  formatModelLabel,
  resolveModelSelection,
  resolvePermissionModeSelection,
  resolveReasoningLevel,
} from "./execution-options";

function model(
  overrides: Partial<AvailableModel> & { model: string },
): AvailableModel {
  return {
    id: overrides.model,
    displayName: overrides.model,
    description: "",
    supportedReasoningEfforts: [
      { reasoningEffort: "low", description: "" },
      { reasoningEffort: "medium", description: "" },
      { reasoningEffort: "high", description: "" },
    ],
    defaultReasoningEffort: "medium",
    isDefault: false,
    ...overrides,
  };
}

function response(
  overrides: Partial<SystemExecutionOptionsResponse>,
): SystemExecutionOptionsResponse {
  return {
    providers: [],
    permissionCeiling: "full",
    models: [],
    selectedOnlyModels: [],
    modelLoadError: null,
    ...overrides,
  };
}

describe("resolveModelSelection", () => {
  const catalog = response({
    models: [
      model({ model: "gpt-5" }),
      model({ model: "gpt-5-mini", isDefault: true }),
    ],
    selectedOnlyModels: [model({ model: "gpt-4.1" })],
  });

  it("keeps a listed selection and exposes retired models behind moreOptions", () => {
    const resolved = resolveModelSelection({
      executionOptions: catalog,
      selectedModel: "gpt-5",
      catalogVerified: true,
    });
    expect(resolved.selectedModel).toBe("gpt-5");
    expect(resolved.activeModel?.model).toBe("gpt-5");
    expect(resolved.options.map((o) => o.value)).toEqual([
      "gpt-5",
      "gpt-5-mini",
    ]);
    expect(resolved.moreOptions.map((o) => o.value)).toEqual(["gpt-4.1"]);
    expect(resolved.isRecovery).toBe(false);
  });

  it("promotes a retired-but-selected model instead of silently switching", () => {
    const resolved = resolveModelSelection({
      executionOptions: catalog,
      selectedModel: "gpt-4.1",
      catalogVerified: true,
    });
    expect(resolved.selectedModel).toBe("gpt-4.1");
    expect(resolved.options.map((o) => o.value)).toEqual([
      "gpt-4.1",
      "gpt-5",
      "gpt-5-mini",
    ]);
    expect(resolved.moreOptions).toEqual([]);
    expect(resolved.isRecovery).toBe(false);
  });

  it("falls back to the catalog default only once the catalog is verified, and flags the recovery", () => {
    const unverified = resolveModelSelection({
      executionOptions: catalog,
      selectedModel: "gone",
      catalogVerified: false,
    });
    expect(unverified.selectedModel).toBe("gone");
    expect(unverified.isRecovery).toBe(false);
    const verified = resolveModelSelection({
      executionOptions: catalog,
      selectedModel: "gone",
      catalogVerified: true,
    });
    expect(verified.selectedModel).toBe("gpt-5-mini");
    expect(verified.isRecovery).toBe(true);
    const empty = resolveModelSelection({
      executionOptions: undefined,
      selectedModel: null,
      catalogVerified: false,
    });
    expect(empty.selectedModel).toBe("");
    expect(empty.activeModel).toBeUndefined();
  });

  it("re-points a prefix-free id at its unique prefixed row (Pi providers)", () => {
    const pi = response({
      models: [
        model({
          model: "openrouter/deepseek/deepseek-v4",
          routeProviderId: "openrouter",
        }),
        model({ model: "anthropic/claude" }),
      ],
    });
    const resolved = resolveModelSelection({
      executionOptions: pi,
      selectedModel: "deepseek/deepseek-v4",
      catalogVerified: true,
    });
    expect(resolved.selectedModel).toBe("openrouter/deepseek/deepseek-v4");
    expect(resolved.isRecovery).toBe(true);
    expect(resolved.options[0].routeProviderId).toBe("openrouter");
  });
});

describe("reasoning", () => {
  it("lists each supported effort once and reconciles the preference to the closest level", () => {
    const options = buildReasoningOptions(
      model({
        model: "m",
        supportedReasoningEfforts: [
          { reasoningEffort: "low", description: "" },
          { reasoningEffort: "high", description: "" },
          { reasoningEffort: "high", description: "dup" },
        ],
      }),
    );
    expect(options).toEqual([
      { value: "low", label: "Low" },
      { value: "high", label: "High" },
    ]);
    expect(resolveReasoningLevel("medium", options)).toBe("high");
    expect(resolveReasoningLevel("low", options)).toBe("low");
    expect(resolveReasoningLevel(undefined, [])).toBe("medium");
    expect(resolveReasoningLevel("max", [])).toBe("max");
    expect(buildReasoningOptions(undefined)).toEqual([]);
  });
});

describe("permission modes", () => {
  it("lists the provider's modes with those above the machine ceiling disabled", () => {
    const options = buildPermissionModeOptions({
      permissionModes: ["accept-edits", "auto", "full"],
      ceiling: "auto",
    });
    expect(options.map((o) => [o.value, o.disabled])).toEqual([
      ["accept-edits", false],
      ["auto", false],
      ["full", true],
    ]);
    expect(options[2].disabledReason).toMatch(/permission limit/);
    expect(
      buildPermissionModeOptions({
        permissionModes: undefined,
        ceiling: "full",
      }).map((o) => o.value),
    ).toEqual(["full"]);
  });

  it("clamps the stored preference to the ceiling and prefers Auto, then Full", () => {
    const provider = {
      permissionModes: ["accept-edits", "auto", "full"] as const,
    };
    expect(
      resolvePermissionModeSelection("full", { ...provider, ceiling: "full" }),
    ).toBe("full");
    expect(
      resolvePermissionModeSelection("full", { ...provider, ceiling: "auto" }),
    ).toBe("auto");
    expect(
      resolvePermissionModeSelection("full", {
        ...provider,
        ceiling: "accept-edits",
      }),
    ).toBe("accept-edits");
    expect(
      resolvePermissionModeSelection(null, {
        permissionModes: ["full"],
        ceiling: "full",
      }),
    ).toBe("full");
    // A machine capped below everything the provider supports: no allowed
    // set, so the provider's own list decides (the server reports the error).
    expect(
      resolvePermissionModeSelection("full", {
        permissionModes: ["full"],
        ceiling: "accept-edits",
      }),
    ).toBe("full");
  });
});

describe("buildProviderOptions", () => {
  it("carries the declared glyph beside the logo so the picker can draw either", () => {
    const base: Omit<ProviderInfo, "id" | "displayName" | "logoUrl"> = {
      pluginId: "provider-test",
      available: true,
      maintenance: { health: false, usage: false, installation: false },
      capabilities: {
        supportsThreadArchive: false,
        supportsThreadRename: false,
        supportsServiceTier: false,
        supportsNativeUserQuestion: false,
        supportsFork: false,
        supportsSessionRewind: false,
        modelCatalogScope: "workspace",
        permissionModes: ["full"],
      },
      composerActions: [],
    };
    expect(
      buildProviderOptions([
        { ...base, id: "codex", displayName: "Codex", logoUrl: "/logo" },
        {
          ...base,
          id: "echo-agent",
          displayName: "Echo",
          logoUrl: null,
          icon: { glyph: "Zap" },
        },
      ]).map(({ value, logoUrl, glyph }) => ({ value, logoUrl, glyph })),
    ).toEqual([
      { value: "codex", logoUrl: "/logo", glyph: null },
      { value: "echo-agent", logoUrl: null, glyph: "Zap" },
    ]);
  });
});

describe("formatModelLabel", () => {
  it("title-cases hyphenated ids and keeps version numbers", () => {
    expect(formatModelLabel("gpt-5.4-mini")).toBe("GPT-5.4-Mini");
    expect(formatModelLabel("claude-opus-4-8[1m]")).toBe("Claude-Opus-4-8[1m]");
  });
});
