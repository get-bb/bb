import { describe, expect, it } from "vitest";
import { escapeHtmlText } from "../src/index.js";

describe("escapeHtmlText", () => {
  it("escapes text with HTML syntax", () => {
    expect(escapeHtmlText(`<a title="Tom & Jerry's">`)).toBe(
      "&lt;a title=&quot;Tom &amp; Jerry&#39;s&quot;&gt;",
    );
  });
});
