import { describe, expect, it } from "vitest";
import { getCompactHomeLeadingSpace } from "./RootComposeHome";

describe("getCompactHomeLeadingSpace", () => {
  it("rests the list low so 4.5 rows show above the composer before scrolling", () => {
    expect(
      getCompactHomeLeadingSpace({
        regionHeight: 852,
        composerHeight: 188,
        recents: { rowHeight: 60, labelHeight: 24, minimumLeadingSpace: 60 },
      }),
    ).toBe(314);
  });

  it("reserves room for larger rows and the heading", () => {
    expect(
      getCompactHomeLeadingSpace({
        regionHeight: 852,
        composerHeight: 188,
        recents: { rowHeight: 90, labelHeight: 36, minimumLeadingSpace: 60 },
      }),
    ).toBe(167);
  });

  it("keeps the minimum gap at the largest accessibility size", () => {
    expect(
      getCompactHomeLeadingSpace({
        regionHeight: 852,
        composerHeight: 188,
        recents: {
          rowHeight: 214.26,
          labelHeight: 85.704,
          minimumLeadingSpace: 60,
        },
      }),
    ).toBe(60);
  });
});
