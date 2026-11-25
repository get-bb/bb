import { describe, expect, it } from "vitest";
import { truncate } from "./notification-text.js";

describe("truncate", () => {
  it("never leaves half of an emoji before the ellipsis", () => {
    const text = `${"a".repeat(8)}\u{1F600}${"b".repeat(10)}`;

    const truncated = truncate(text, 10);

    expect(truncated).toBe(`${"a".repeat(8)}…`);
    expect(truncated).not.toMatch(/[\uD800-\uDFFF]/u);
  });
});
