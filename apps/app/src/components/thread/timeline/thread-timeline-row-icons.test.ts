import { describe, expect, it } from "vitest";
import {
  timelineParentChangeActionValues,
  timelineSystemOperationKindValues,
} from "@bb/server-contract";
import { systemOperationLeadingIcon } from "./ThreadTimelineRows.js";

describe("systemOperationLeadingIcon", () => {
  it("maps each operation kind to its leading icon", () => {
    expect(systemOperationLeadingIcon("thread-provisioning", null)).toBe(
      "Terminal",
    );
    expect(systemOperationLeadingIcon("thread-interrupted", null)).toBe(
      "AlertCircle",
    );
    expect(systemOperationLeadingIcon("compaction", null)).toBe(
      "CircleArrowShrink",
    );
    expect(systemOperationLeadingIcon("parent-change", "assign")).toBe(
      "UserRoundPlus",
    );
    expect(systemOperationLeadingIcon("parent-change", "transfer")).toBe(
      "UserRoundPlus",
    );
    expect(systemOperationLeadingIcon("parent-change", "release")).toBe(
      "UserRound",
    );
  });

  it("keeps provider/session-scoped operations glyph-less", () => {
    for (const kind of [
      "generic",
      "warning",
      "deprecation",
      "provider-unhandled",
    ] as const) {
      expect(systemOperationLeadingIcon(kind, null)).toBeUndefined();
    }
  });

  it("covers every operation kind (no kind falls through assertNever)", () => {
    for (const kind of timelineSystemOperationKindValues) {
      expect(() =>
        systemOperationLeadingIcon(kind, timelineParentChangeActionValues[0]),
      ).not.toThrow();
    }
  });
});
