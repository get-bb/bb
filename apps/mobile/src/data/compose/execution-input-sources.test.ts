import { describe, expect, it } from "vitest";
import { buildComposeExecutionInputSources } from "./execution-input-sources";

const field = (value: string | undefined, stored = "", touched = false) => ({
  value,
  stored,
  touched,
});

describe("buildComposeExecutionInputSources", () => {
  it("attributes touched fields as explicit, matching stored preferences as client-preference, and omits the rest", () => {
    expect(
      buildComposeExecutionInputSources({
        providerId: field("codex", "codex"),
        model: field("gpt-5", "gpt-5", true),
        serviceTier: field("fast", "default"),
        reasoningLevel: field("high"),
        permissionMode: field(undefined, "auto"),
      }),
    ).toEqual({
      providerId: "client-preference",
      model: "explicit",
    });
  });

  it("forces the model explicit when the stored model was recovered to another id", () => {
    expect(
      buildComposeExecutionInputSources(
        {
          providerId: field("codex"),
          model: field("gpt-5", "gpt-4-retired"),
          serviceTier: field(undefined),
          reasoningLevel: field(undefined),
          permissionMode: field(undefined),
        },
        { forceExplicitModel: true },
      ),
    ).toEqual({ model: "explicit" });
  });
});
