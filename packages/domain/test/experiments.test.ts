import { describe, expect, it } from "vitest";
import {
  defaultExperiments,
  experimentsSchema,
  experimentsUpdateSchema,
} from "../src/experiments.js";

describe("experimentsSchema", () => {
  it("accepts the default experiment values", () => {
    expect(experimentsSchema.parse(defaultExperiments)).toEqual(
      defaultExperiments,
    );
  });

  it("accepts an update payload from before changelogPreview existed", () => {
    expect(
      experimentsUpdateSchema.parse({
        claudeCodeMockCliTraffic: false,
        editMessages: true,
        newOnboarding: false,
        providerSessionReaping: false,
      }),
    ).toEqual({
      claudeCodeMockCliTraffic: false,
      editMessages: true,
      newOnboarding: false,
      providerSessionReaping: false,
    });
  });
});
