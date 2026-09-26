import { describe, expect, it } from "vitest";
import { splitWidthLimits } from "./sizing";

describe("secondary panel width limits", () => {
  it.each([480, 960, 2400])(
    "keeps both panels at least 240px wide in a %ipx container",
    (width) => {
      const limits = splitWidthLimits(width);
      expect(limits.min * width).toBeCloseTo(240);
      expect((1 - limits.max) * width).toBeCloseTo(240);
    },
  );

  it("shares insufficient width evenly", () => {
    expect(splitWidthLimits(300)).toEqual({ min: 0.5, max: 0.5 });
  });
});
