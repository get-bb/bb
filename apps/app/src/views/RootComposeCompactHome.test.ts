import { describe, expect, it } from "vitest";
import { getCompactHomeLeadingSpace } from "./RootComposeCompactHome";
import {
  MOBILE_RECENT_LABEL_HEIGHT_PX,
  MOBILE_RECENT_ROW_HEIGHT_PX,
} from "./RootComposeMobileRecents";

describe("getCompactHomeLeadingSpace", () => {
  it("rests the list low so 4.5 rows show above the composer before scrolling", () => {
    const restingBandPx =
      4.5 * MOBILE_RECENT_ROW_HEIGHT_PX + MOBILE_RECENT_LABEL_HEIGHT_PX;

    expect(
      56 +
        getCompactHomeLeadingSpace({
          regionHeight: 852,
          composerHeight: 188,
        }),
    ).toBe(852 - 188 - restingBandPx);
  });

  it("keeps one row of leading space when the region is too short for the band", () => {
    expect(
      getCompactHomeLeadingSpace({
        regionHeight: 420,
        composerHeight: 188,
      }),
    ).toBe(MOBILE_RECENT_ROW_HEIGHT_PX);
  });
});
