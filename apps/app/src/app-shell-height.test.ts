import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appCss = readFileSync(
  fileURLToPath(new URL("./app.css", import.meta.url)),
  "utf8",
);

describe("app shell height", () => {
  it("adds only the exposed top safe area to standalone dynamic height", () => {
    expect(appCss).toMatch(
      /@media \(display-mode: standalone\)[\s\S]*?--bb-shell-height:\s*calc\(100dvh \+ env\(safe-area-inset-top\)\)/u,
    );
    expect(appCss).not.toMatch(/--bb-shell-height:\s*100lvh/u);
  });
});
