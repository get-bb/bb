import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildTerminalPageHtml,
  TERMINAL_PAGE_OUTPUT_PATH,
} from "../../../scripts/build-terminal-page";

/**
 * The committed `assets/terminal/index.html` is built from the page source +
 * xterm; keep it honest like the theme drift test.
 */
describe("terminal page asset", () => {
  it("matches the committed assets/terminal/index.html (run terminal:build)", async () => {
    const built = await buildTerminalPageHtml();
    expect(built).toBe(readFileSync(TERMINAL_PAGE_OUTPUT_PATH, "utf8"));
  }, 30_000);

  it("is self-contained: no external scripts, styles, or fonts", () => {
    const html = readFileSync(TERMINAL_PAGE_OUTPUT_PATH, "utf8");
    expect(html).not.toMatch(/<script[^>]+src=/iu);
    expect(html).not.toMatch(/<link[^>]+href=/iu);
    expect(html).not.toMatch(/url\((?!["']?data:)["']?https?:/iu);
    expect(html).toContain("ReactNativeWebView");
    expect(html).toContain('id="terminal"');
  });
});
