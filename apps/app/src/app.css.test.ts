import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "app.css"),
  "utf8",
);

describe("app.css sidebar drag cursor", () => {
  it("scopes the grabbing cursor to the sidebar panel on fine pointers only", () => {
    // A document-wide `body[data-sidebar-dragging] *` rule restyles every
    // mounted timeline node when the body attribute flips at drag start and
    // end, and a touch drag has no cursor to keep stable in the first place.
    expect(css).not.toMatch(/body\[data-sidebar-dragging="true"\]\s*\*/);
    const block = css.match(
      /@media \(pointer: fine\) \{\s*body\[data-sidebar-dragging="true"\],\s*body\[data-sidebar-dragging="true"\] \[data-sidebar="panel"\] \* \{([^}]*)\}/,
    )?.[1];
    expect(block).toBeDefined();
    expect(block).toMatch(/cursor:\s*grabbing !important;/);
  });
});
