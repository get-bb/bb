import { describe, expect, it } from "vitest";
import {
  BROWSE_ARCHETYPES,
  archetypePrompt,
} from "@/components/plugin/browse-hero/browse-hero-archetypes";
import { getCreateExamples } from "./create-via-prompt-examples";

describe("getCreateExamples", () => {
  it("keeps four automation templates for the overview shelf", () => {
    const { examples } = getCreateExamples("automation");

    expect(examples).toHaveLength(4);
    expect(examples.every((example) => example.prompt.length > 0)).toBe(true);
  });

  it("serves the Browse archetypes as the plugin templates, one source", () => {
    // The New plugin menu and the Browse page must never show two divergent
    // example lists, so the menu templates ARE the hero archetypes.
    const { examples } = getCreateExamples("plugin");

    expect(examples.map((example) => example.label)).toEqual(
      BROWSE_ARCHETYPES.map((archetype) => archetype.title),
    );
    for (const [index, example] of examples.entries()) {
      expect(example.prompt).toBe(archetypePrompt(BROWSE_ARCHETYPES[index]!));
    }
  });
});
