import { describe, expect, it } from "vitest";

import { contrastRatio } from "./theme-utils";

describe("contrastRatio", () => {
  it("composites translucent foregrounds over their comparison surface", () => {
    expect(contrastRatio("rgb(0, 0, 0)", "rgb(255, 255, 255)")).toBeCloseTo(
      21,
      5,
    );
    expect(
      contrastRatio("rgba(0, 0, 0, 0.5)", "rgb(255, 255, 255)"),
    ).toBeCloseTo(3.98, 2);
  });

  it("composites translucent surfaces over their rendered backdrop", () => {
    expect(
      contrastRatio("rgb(0, 0, 0)", "rgba(255, 255, 255, 0.5)", "rgb(0, 0, 0)"),
    ).toBeCloseTo(5.28, 2);
  });
});
