import { describe, expect, it } from "vitest";
import { getCompactHomeScrollViewportTop } from "./RootComposeCompactHome";
import {
  MOBILE_RECENT_LABEL_HEIGHT_PX,
  MOBILE_RECENT_ROW_HEIGHT_PX,
} from "./RootComposeMobileRecents";

describe("getCompactHomeScrollViewportTop", () => {
  it("pins the scroll viewport so 5.5 rows show once the label sticks", () => {
    const scrolledBandPx =
      5.5 * MOBILE_RECENT_ROW_HEIGHT_PX + MOBILE_RECENT_LABEL_HEIGHT_PX;

    expect(
      getCompactHomeScrollViewportTop({
        regionHeight: 852,
        composerHeight: 188,
      }),
    ).toBe(852 - 188 - scrolledBandPx);
  });

  it("never lifts the scroll viewport above the app chrome row", () => {
    expect(
      getCompactHomeScrollViewportTop({
        regionHeight: 420,
        composerHeight: 188,
      }),
    ).toBe(56);
  });
});
