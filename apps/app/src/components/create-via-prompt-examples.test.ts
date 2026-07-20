import { describe, expect, it } from "vitest";
import { getCreateExamples } from "./create-via-prompt-examples";

describe("getCreateExamples", () => {
  it.each(["plugin", "automation"] as const)(
    "keeps four %s templates for the overview shelf",
    (kind) => {
      const { examples } = getCreateExamples(kind);

      expect(examples).toHaveLength(4);
      expect(examples.every((example) => example.prompt.length > 0)).toBe(true);
    },
  );

  it.each(["skill", "plugin", "automation"] as const)(
    "gives every %s example a semantic launcher icon",
    (kind) => {
      const { examples } = getCreateExamples(kind);

      expect(examples.every((example) => example.icon.length > 0)).toBe(true);
    },
  );
});
