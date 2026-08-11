import { describe, expect, it } from "vitest";
import { defaultExperiments, experimentsSchema } from "../src/experiments.js";

describe("experimentsSchema", () => {
  it("accepts the default experiment values", () => {
    expect(experimentsSchema.parse(defaultExperiments)).toEqual(
      defaultExperiments,
    );
  });

  it("defaults rewind to off so the rollout gate starts closed", () => {
    expect(defaultExperiments.rewind).toBe(false);
  });
});
