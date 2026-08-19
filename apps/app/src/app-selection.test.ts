import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SELECTION_CONTROL_SELECTORS } from "./lib/select-all-scope";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "app.css"),
  "utf8",
);
const compactCss = css.replace(/\s+/g, " ");

describe("app text selection policy", () => {
  it("disables native text selection across the app shell and its portals", () => {
    expect(css).toMatch(/body\.bb-app-shell\s*\{\s*user-select:\s*none;\s*\}/);
  });

  it("preserves native selection in editable controls", () => {
    expect(compactCss).toContain(
      'body.bb-app-shell :where(input, textarea, [contenteditable]:not([contenteditable="false"])) { user-select: text !important; }',
    );
  });

  it("keeps explicit content selectable without pointer-time style changes", () => {
    expect(compactCss).toContain(
      "body.bb-app-shell .select-text { user-select: text !important; }",
    );
    expect(css).not.toContain("data-selection-active");
    expect(css).not.toContain(":has([data-selection-active])");
  });

  it("keeps nested controls out of selectable content", () => {
    expect(compactCss).toContain(
      `body.bb-app-shell .select-text :where( ${SELECTION_CONTROL_SELECTORS.join(", ")} ):not(.select-text) { user-select: none; }`,
    );
  });
});
