import { describe, expect, it } from "vitest";

import { experimentVariant, parseForcedFlags } from "./flags";

function variantFor(featureFlags: Record<string, string>) {
  return experimentVariant(
    { distinctID: "id", featureFlags, preview: false },
    "homepage-qa-check",
  );
}

describe("experiment variants", () => {
  it.each([
    ["the test arm", { "homepage-qa-check": "test" }, "test"],
    ["the control arm", { "homepage-qa-check": "control" }, "control"],
    ["a holdout", { "homepage-qa-check": "holdout-42" }, "control"],
    ["an unknown variant", { "homepage-qa-check": "test-2" }, "control"],
    ["a missing flag", {}, "control"],
    ["an inherited name", { constructor: "test" }, "control"],
  ])("renders %s as %s", (_name, featureFlags, expected) => {
    expect(variantFor(featureFlags)).toBe(expected);
  });
});

describe("forced preview params", () => {
  it("returns null without ph_flag", () => {
    expect(parseForcedFlags(new URLSearchParams("a=1"))).toBeNull();
  });

  it("keeps only known keys and well-formed variants", () => {
    expect(
      parseForcedFlags(
        new URLSearchParams(
          [
            "ph_flag=homepage-qa-check:holdout-3",
            "ph_flag=unknown:test",
            "ph_flag=homepage-qa-check",
            "ph_flag=:test",
          ].join("&"),
        ),
      ),
    ).toEqual({ "homepage-qa-check": "holdout-3" });
    expect(
      parseForcedFlags(new URLSearchParams("ph_flag=homepage-qa-check:<b>")),
    ).toEqual({});
  });
});
