import { describe, expect, it } from "vitest";
import { systemOperationLeadingIcon } from "./ThreadTimelineRows";

describe("systemOperationLeadingIcon", () => {
  it("uses the clean glyph for context-clear operations", () => {
    expect(systemOperationLeadingIcon("context-clear", null)).toBe("Clean");
  });
});
