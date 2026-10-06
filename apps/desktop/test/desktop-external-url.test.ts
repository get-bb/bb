import { describe, expect, it } from "vitest";
import { resolveDesktopExternalUrl } from "../src/desktop-external-url.js";

describe("resolveDesktopExternalUrl", () => {
  it.each([
    ["https://example.com/docs?q=1#a", "https://example.com/docs?q=1#a"],
    ["http://localhost:5173", "http://localhost:5173/"],
    ["mailto:hi@example.com", "mailto:hi@example.com"],
  ])("opens %s", (value, expected) => {
    expect(resolveDesktopExternalUrl(value)).toBe(expected);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///System/Applications/Chess.app",
    "ms-msdt:/id PCWDiagnostic",
    "vscode://command/workbench.action.terminal.new",
    "devin://file/Users/me/review.diff",
    "/threads/thr_1",
    { url: "https://example.com" },
  ])("rejects %s", (value) => {
    expect(resolveDesktopExternalUrl(value)).toBeNull();
  });
});
