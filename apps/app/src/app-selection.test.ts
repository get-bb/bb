import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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

  it("activates one explicit content region at a time", () => {
    expect(compactCss).toContain(
      "body.bb-app-shell .select-text { user-select: none !important; }",
    );
    expect(compactCss).toContain(
      "body.bb-app-shell [data-selectable-content-region][data-selection-active], body.bb-app-shell .select-text[data-selection-active], body.bb-app-shell [data-selection-active] .select-text { user-select: text !important; }",
    );
  });

  it("keeps nested controls out of selectable content", () => {
    expect(compactCss).toContain(
      'body.bb-app-shell .select-text :where( button, select, [role="button"], [role="checkbox"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="radio"], [role="switch"], [role="tab"] ):not(.select-text) { user-select: none; }',
    );
  });
});
