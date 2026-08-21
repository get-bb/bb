import { describe, expect, it } from "vitest";
import {
  resolveTypeaheadMaxHeight,
  TYPEAHEAD_GAP,
  TYPEAHEAD_MAX_HEIGHT,
  TYPEAHEAD_MIN_HEIGHT,
  TYPEAHEAD_TOP_MARGIN,
} from "./typeahead-height";

describe("resolveTypeaheadMaxHeight", () => {
  it("keeps the fixed cap while unmeasured", () => {
    expect(resolveTypeaheadMaxHeight(null)).toBe(TYPEAHEAD_MAX_HEIGHT);
    expect(resolveTypeaheadMaxHeight(Number.NaN)).toBe(TYPEAHEAD_MAX_HEIGHT);
  });

  it("fits the list between the bounds top and the card", () => {
    // The user's report: ~225pt between the header and the card, a 280pt
    // list → the top rows sat under the header.
    expect(resolveTypeaheadMaxHeight(225)).toBe(
      225 - TYPEAHEAD_GAP - TYPEAHEAD_TOP_MARGIN,
    );
    expect(resolveTypeaheadMaxHeight(1000)).toBe(TYPEAHEAD_MAX_HEIGHT);
  });

  it("never shrinks below one row", () => {
    expect(resolveTypeaheadMaxHeight(20)).toBe(TYPEAHEAD_MIN_HEIGHT);
    expect(resolveTypeaheadMaxHeight(0)).toBe(TYPEAHEAD_MIN_HEIGHT);
  });
});
