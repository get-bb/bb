import { describe, expect, it } from "vitest";
import type { ModelPickerOption } from "./model-picker-option";
import {
  groupModelOptions,
  hasMultipleRouteGroups,
  modelRouteKey,
  qualifyCollidingLabels,
  ROUTE_PROVIDER_DISPLAY_NAMES,
  routeProviderDisplayName,
  selectedModelQualifier,
} from "./model-picker-option";

function model({
  value,
  label,
  routeProviderId,
}: {
  value: string;
  label: string;
  routeProviderId?: string;
}): ModelPickerOption {
  return {
    value,
    label,
    ...(routeProviderId === undefined ? {} : { routeProviderId }),
  };
}

const glmDupAcrossProviders: readonly ModelPickerOption[] = [
  model({ value: "cursor/glm-5.3", label: "GLM-5.3" }),
  model({ value: "zai/glm-5.3", label: "GLM-5.3" }),
  model({ value: "zai/glm-5.2-air", label: "GLM-5.2 Air" }),
];

const mistralTripleCollision: readonly ModelPickerOption[] = [
  model({
    value: "mistral/mistral-medium-latest",
    label: "mistral-medium-latest",
  }),
  model({
    value: "mistral/mistral-medium-2506",
    label: "mistral-medium-latest",
  }),
  model({
    value: "mistral/mistral-medium-latest-2501",
    label: "mistral-medium-latest",
  }),
  model({ value: "mistral/mistral-large-latest", label: "Mistral Large" }),
];

describe("modelRouteKey", () => {
  it("derives the key from the value's route prefix", () => {
    expect(
      modelRouteKey(model({ value: "zai/glm-5.3", label: "GLM-5.3" })),
    ).toBe("zai");
  });

  it("keeps only the leading segment of nested route ids", () => {
    expect(
      modelRouteKey(
        model({ value: "commandcode/zai-org/GLM-5", label: "GLM-5" }),
      ),
    ).toBe("commandcode");
  });

  it("prefers a declared routeProviderId over the value prefix", () => {
    expect(
      modelRouteKey(
        model({
          value: "cursor/glm-5.3",
          label: "GLM-5.3",
          routeProviderId: "zai",
        }),
      ),
    ).toBe("zai");
  });

  it("returns null for route-less ids and missing prefixes", () => {
    expect(
      modelRouteKey(model({ value: "gpt-5.5", label: "GPT-5.5" })),
    ).toBeNull();
    expect(modelRouteKey(model({ value: "/glm", label: "GLM" }))).toBeNull();
  });
});

describe("groupModelOptions", () => {
  it("groups by key in first-appearance order, merging repeats", () => {
    const groups = groupModelOptions([
      model({ value: "zai/glm-5.3", label: "GLM-5.3" }),
      model({ value: "cursor/claude-sonnet-4-5", label: "Claude Sonnet 4.5" }),
      model({ value: "zai/glm-5.2-air", label: "GLM-5.2 Air" }),
    ]);

    expect(groups.map((group) => group.key)).toEqual(["zai", "cursor"]);
    expect(groups[0].options.map((option) => option.value)).toEqual([
      "zai/glm-5.3",
      "zai/glm-5.2-air",
    ]);
  });

  it("collects route-less models into the leading, headerless group", () => {
    const groups = groupModelOptions([
      model({ value: "gpt-5.5", label: "GPT-5.5" }),
      model({ value: "zai/glm-5.3", label: "GLM-5.3" }),
      model({ value: "gpt-5.4", label: "GPT-5.4" }),
    ]);

    expect(groups.map((group) => group.key)).toEqual([null, "zai"]);
    expect(groups[0].options.map((option) => option.value)).toEqual([
      "gpt-5.5",
      "gpt-5.4",
    ]);
  });

  it("yields a single headerless group for an all-route-less list", () => {
    const groups = groupModelOptions([
      model({ value: "gpt-5.5", label: "GPT-5.5" }),
      model({ value: "claude-sonnet-5", label: "Claude Sonnet 5" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBeNull();
  });
});

describe("hasMultipleRouteGroups", () => {
  it("is true only when ≥2 keyed groups are present", () => {
    const single = groupModelOptions([
      model({ value: "zai/glm-5.3", label: "GLM-5.3" }),
      model({ value: "zai/glm-5.2", label: "GLM-5.2" }),
      model({ value: "gpt-5.5", label: "GPT-5.5" }),
    ]);
    expect(hasMultipleRouteGroups(single)).toBe(false);

    const multi = groupModelOptions(glmDupAcrossProviders);
    expect(hasMultipleRouteGroups(multi)).toBe(true);
  });

  it("stays false for an all-route-less list", () => {
    expect(
      hasMultipleRouteGroups(
        groupModelOptions([
          model({ value: "gpt-5.5", label: "GPT-5.5" }),
          model({ value: "gpt-5.2", label: "GPT-5.2" }),
        ]),
      ),
    ).toBe(false);
  });
});

describe("routeProviderDisplayName", () => {
  it("maps every known route key to its human-readable name", () => {
    expect(ROUTE_PROVIDER_DISPLAY_NAMES.get("cursor")).toBe("Cursor");
    expect(ROUTE_PROVIDER_DISPLAY_NAMES.get("zai")).toBe("Z.ai");
    expect(ROUTE_PROVIDER_DISPLAY_NAMES.get("mistral")).toBe("Mistral");
    expect(ROUTE_PROVIDER_DISPLAY_NAMES.get("google-antigravity")).toBe(
      "Google Antigravity",
    );
    expect(ROUTE_PROVIDER_DISPLAY_NAMES.get("xai-oauth")).toBe("xAI");
    expect(ROUTE_PROVIDER_DISPLAY_NAMES.get("alibaba-token-plan")).toBe(
      "Alibaba",
    );
    expect(ROUTE_PROVIDER_DISPLAY_NAMES.get("opencode-zen")).toBe(
      "OpenCode Zen",
    );
    expect(ROUTE_PROVIDER_DISPLAY_NAMES.get("openai-codex")).toBe(
      "OpenAI Codex",
    );
    expect(ROUTE_PROVIDER_DISPLAY_NAMES.get("commandcode")).toBe("CommandCode");
  });

  it("prettifies unknown keys: hyphens become spaces, words capitalize", () => {
    expect(routeProviderDisplayName("new-route-x")).toBe("New Route X");
    expect(routeProviderDisplayName("acme")).toBe("Acme");
    expect(routeProviderDisplayName("a--b")).toBe("A B");
  });

  it("is display-only: grouping keys stay raw", () => {
    const groups = groupModelOptions([
      model({ value: "zai/glm-5.3", label: "GLM-5.3" }),
      model({ value: "commandcode/zai-org/GLM-5", label: "GLM-5" }),
    ]);

    expect(groups.map((group) => group.key)).toEqual(["zai", "commandcode"]);
  });
});

describe("qualifyCollidingLabels", () => {
  it("qualifies only within-group collisions, suppressing id-restating remainders", () => {
    const qualifiers = qualifyCollidingLabels([
      ...glmDupAcrossProviders,
      ...mistralTripleCollision,
    ]);

    expect(qualifiers.has("cursor/glm-5.3")).toBe(false);
    expect(qualifiers.has("zai/glm-5.3")).toBe(false);
    expect(qualifiers.has("zai/glm-5.2-air")).toBe(false);

    expect(qualifiers.has("mistral/mistral-medium-latest")).toBe(false);
    expect(qualifiers.get("mistral/mistral-medium-2506")).toBe(
      "mistral-medium-2506",
    );
    expect(qualifiers.get("mistral/mistral-medium-latest-2501")).toBe(
      "mistral-medium-latest-2501",
    );
    expect(qualifiers.has("mistral/mistral-large-latest")).toBe(false);
  });

  it("suppresses a remainder that restates the label case-insensitively", () => {
    const qualifiers = qualifyCollidingLabels([
      model({ value: "zai/glm-5", label: "GLM-5" }),
      model({ value: "zai/glm-5.5", label: "GLM-5" }),
    ]);

    expect(qualifiers.has("zai/glm-5")).toBe(false);
    expect(qualifiers.get("zai/glm-5.5")).toBe("glm-5.5");
  });

  it("keeps nested route ids' remainder path intact", () => {
    const qualifiers = qualifyCollidingLabels([
      model({ value: "commandcode/zai-org/GLM-5", label: "GLM-5" }),
      model({ value: "commandcode/zai-org/GLM-5.5", label: "GLM-5" }),
    ]);

    expect(qualifiers.get("commandcode/zai-org/GLM-5")).toBe("zai-org/GLM-5");
    expect(qualifiers.get("commandcode/zai-org/GLM-5.5")).toBe(
      "zai-org/GLM-5.5",
    );
  });

  it("falls back to the full value when it carries no route prefix", () => {
    const qualifiers = qualifyCollidingLabels([
      model({ value: "gpt-5.5", label: "GPT" }),
      model({ value: "gpt-5.4", label: "GPT" }),
    ]);

    expect(qualifiers.get("gpt-5.5")).toBe("gpt-5.5");
    expect(qualifiers.get("gpt-5.4")).toBe("gpt-5.4");
  });

  it("compares brand-stripped rendered labels", () => {
    const qualifiers = qualifyCollidingLabels(
      [
        model({ value: "zai/Codex-5", label: "Zai Codex 5" }),
        model({ value: "zai/codex-5-preview", label: "Codex 5" }),
      ],
      "Zai ",
    );

    expect(qualifiers.get("zai/Codex-5")).toBe("Codex-5");
    expect(qualifiers.get("zai/codex-5-preview")).toBe("codex-5-preview");
  });

  it("treats trailing parenthetical tags as part of the rendered label", () => {
    const qualifiers = qualifyCollidingLabels([
      model({ value: "zai/glm-5.3", label: "GLM-5.3 (1M)" }),
      model({ value: "zai/glm-5.3-pro", label: "GLM-5.3" }),
    ]);

    expect(qualifiers.size).toBe(0);
  });
});

describe("selectedModelQualifier", () => {
  it("uses the pretty route name for a cross-group collision", () => {
    expect(selectedModelQualifier(glmDupAcrossProviders, "zai/glm-5.3")).toBe(
      "Z.ai",
    );
    expect(
      selectedModelQualifier(glmDupAcrossProviders, "cursor/glm-5.3"),
    ).toBe("Cursor");
  });

  it("qualifies a within-group collision with route name and remainder", () => {
    expect(
      selectedModelQualifier(
        mistralTripleCollision,
        "mistral/mistral-medium-2506",
      ),
    ).toBe("Mistral · mistral-medium-2506");
  });

  it("returns null while the label is unambiguous", () => {
    expect(
      selectedModelQualifier(glmDupAcrossProviders, "zai/glm-5.2-air"),
    ).toBeNull();
    expect(
      selectedModelQualifier(
        mistralTripleCollision,
        "mistral/mistral-large-latest",
      ),
    ).toBeNull();
  });

  it("returns null when the value is not in the list", () => {
    expect(selectedModelQualifier(glmDupAcrossProviders, "gone/1")).toBeNull();
  });

  it("drops a remainder that restates the label, within-group only", () => {
    expect(
      selectedModelQualifier(
        mistralTripleCollision,
        "mistral/mistral-medium-latest",
      ),
    ).toBeNull();
  });

  it("falls back to the pretty route name for a degenerate remainder with a cross-group collision", () => {
    const options: readonly ModelPickerOption[] = [
      model({ value: "cursor/glm-5.3", label: "GLM-5.3" }),
      model({ value: "zai/glm-5.3", label: "GLM-5.3" }),
      model({ value: "zai/glm-5.3-air", label: "GLM-5.3" }),
    ];

    expect(selectedModelQualifier(options, "zai/glm-5.3")).toBe("Z.ai");
  });

  it("prefers the remainder when collisions span both scopes", () => {
    const options: readonly ModelPickerOption[] = [
      model({ value: "cursor/glm-5.3", label: "GLM-5.3" }),
      model({ value: "zai/glm-5.3", label: "GLM-5.3" }),
      model({ value: "zai/glm-5.3-air", label: "GLM-5.3" }),
    ];

    expect(selectedModelQualifier(options, "zai/glm-5.3-air")).toBe(
      "Z.ai · glm-5.3-air",
    );
  });
});
