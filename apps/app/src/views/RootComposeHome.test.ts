import { describe, expect, it } from "vitest";
import { getCompactHomeLeadingSpace } from "./RootComposeHome";

describe("getCompactHomeLeadingSpace", () => {
  it("rests the list low so 4.5 rows show above the composer before scrolling", () => {
    expect(
      getCompactHomeLeadingSpace({
        regionHeight: 852,
        composerHeight: 188,
        recentScale: 1,
      }),
    ).toBe(314);
  });

  it("reserves room for larger rows and the heading", () => {
    expect(
      getCompactHomeLeadingSpace({
        regionHeight: 852,
        composerHeight: 188,
        recentScale: 1.5,
      }),
    ).toBe(167);
  });

  it("keeps the minimum gap at the largest accessibility size", () => {
    expect(
      getCompactHomeLeadingSpace({
        regionHeight: 852,
        composerHeight: 188,
        recentScale: 3.571,
      }),
    ).toBe(60);
  });
});
