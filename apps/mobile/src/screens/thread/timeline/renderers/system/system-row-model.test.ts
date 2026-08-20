import { describe, expect, it } from "vitest";
import {
  SYSTEM_DETAIL_COLLAPSED_MAX_LINES,
  systemDetailText,
  systemOperationLeadingIcon,
} from "./system-row-model";

describe("systemOperationLeadingIcon", () => {
  it("maps lifecycle operations to glyphs and leaves notices bare", () => {
    expect(systemOperationLeadingIcon("parent-change", "assign")).toBe(
      "UserRoundPlus",
    );
    expect(systemOperationLeadingIcon("parent-change", "release")).toBe(
      "UserRound",
    );
    expect(systemOperationLeadingIcon("compaction", null)).toBe(
      "CircleArrowShrink",
    );
    expect(systemOperationLeadingIcon("context-clear", null)).toBe("Clean");
    expect(systemOperationLeadingIcon("thread-provisioning", null)).toBe(
      "Terminal",
    );
    expect(systemOperationLeadingIcon("thread-interrupted", null)).toBe(
      "AlertCircle",
    );
    for (const kind of [
      "generic",
      "warning",
      "deprecation",
      "provider-unhandled",
    ] as const) {
      expect(systemOperationLeadingIcon(kind, null)).toBeUndefined();
    }
  });
});

describe("systemDetailText", () => {
  it("shows short bodies whole, normalising line endings and trailing blank lines", () => {
    expect(systemDetailText("a\r\nb\n\n", false)).toEqual({
      text: "a\nb",
      hiddenLineCount: 0,
    });
  });

  it("caps long bodies to their head and reports the hidden count until expanded", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
    const collapsed = systemDetailText(lines.join("\n"), false);
    expect(collapsed.text.split("\n")).toHaveLength(
      SYSTEM_DETAIL_COLLAPSED_MAX_LINES,
    );
    expect(collapsed.hiddenLineCount).toBe(
      50 - SYSTEM_DETAIL_COLLAPSED_MAX_LINES,
    );
    expect(systemDetailText(lines.join("\n"), true)).toEqual({
      text: lines.join("\n"),
      hiddenLineCount: 0,
    });
  });
});
