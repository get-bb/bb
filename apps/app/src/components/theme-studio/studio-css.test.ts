import { describe, expect, it } from "vitest";
import {
  applyTokens,
  extractTokens,
  hasBothModeBlocks,
  readToken,
  writeToken,
} from "./studio-css";

const HAND_WRITTEN = `/* a hand-authored theme */
@import url("https://fonts.googleapis.com/css2?family=Inter");
:root,
.light {
  --canvas: #eceff4;
  --ink: #2e3440;
  --primary: #5e81ac;
  --muted-foreground: color-mix(in oklch, var(--ink) 70%, var(--canvas));
  --radius: 0.5rem;
  --font-mono: "JetBrains Mono", monospace;
}
.dark {
  --canvas: #2e3440;
  --ink: #d8dee9;
  --primary: #88c0d0;
  --radius: 0.25rem;
}
`;

describe("reading tokens from arbitrary theme css", () => {
  it("reads a token out of the right mode block", () => {
    expect(readToken(HAND_WRITTEN, "light", "canvas")).toBe("#eceff4");
    expect(readToken(HAND_WRITTEN, "dark", "canvas")).toBe("#2e3440");
    expect(readToken(HAND_WRITTEN, "light", "ink")).toBe("#2e3440");
  });

  it("returns the raw expression for a derived token", () => {
    expect(readToken(HAND_WRITTEN, "light", "primary")).toBe("#5e81ac");
  });

  it("reports tokens a theme never declares", () => {
    const { missing } = extractTokens(HAND_WRITTEN, "light");
    expect(missing).toContain("destructive");
    expect(missing).toContain("success");
  });

  it("recognises both mode blocks", () => {
    expect(hasBothModeBlocks(HAND_WRITTEN)).toBe(true);
    expect(hasBothModeBlocks(".dark { --canvas: #000; }")).toBe(false);
  });
});

describe("surgical writes", () => {
  it("changes only the targeted declaration", () => {
    const next = writeToken(HAND_WRITTEN, "light", "canvas", "#ffffff");
    expect(next).toContain("--canvas: #ffffff;");
    expect(next).toContain("--ink: #2e3440;");
    expect(next).toContain("--canvas: #2e3440;");
  });

  it("leaves derivations, fonts, radius, comments and the import intact", () => {
    const next = writeToken(HAND_WRITTEN, "light", "primary", "#ff0000");
    expect(next).toContain("/* a hand-authored theme */");
    expect(next).toContain('@import url("https://fonts.googleapis.com/css2?family=Inter");');
    expect(next).toContain(
      "--muted-foreground: color-mix(in oklch, var(--ink) 70%, var(--canvas));",
    );
    expect(next).toContain("--radius: 0.5rem;");
    expect(next).toContain('--font-mono: "JetBrains Mono", monospace;');
    expect(next).toContain("--radius: 0.25rem;");
  });

  it("never touches the other mode block", () => {
    const next = writeToken(HAND_WRITTEN, "dark", "primary", "#00ff00");
    expect(next).toContain("--canvas: #eceff4;");
    expect(next).toContain("--canvas: #2e3440;");
    expect(next).toContain("--primary: #00ff00;");
    expect(next.match(/#5e81ac/g)).toHaveLength(1);
  });

  it("inserts a token the theme omitted instead of dropping it", () => {
    const next = writeToken(HAND_WRITTEN, "light", "destructive", "#c0392b");
    expect(next).toContain("--destructive: #c0392b;");
    expect(next).toContain("--canvas: #eceff4;");
  });

  it("keeps the stylesheet byte-identical when rewriting the same value", () => {
    expect(writeToken(HAND_WRITTEN, "light", "canvas", "#eceff4")).toBe(
      HAND_WRITTEN,
    );
  });

  it("returns the css untouched when the mode block is missing", () => {
    const darkOnly = ".dark { --canvas: #000; }";
    expect(writeToken(darkOnly, "light", "canvas", "#fff")).toBe(darkOnly);
  });
});

describe("applying a whole token set", () => {
  it("updates every supplied token and leaves the rest of the file alone", () => {
    const next = applyTokens(
      HAND_WRITTEN,
      { canvas: "#ffffff", primary: "#123456" },
      { canvas: "#000000" },
    );

    expect(next).toContain("--canvas: #ffffff;");
    expect(next).toContain("--primary: #123456;");
    expect(next).toContain("--canvas: #000000;");
    expect(next).toContain("--ink: #2e3440;");
    expect(next).toContain("--radius: 0.5rem;");
    expect(next).toContain("/* a hand-authored theme */");
  });

  it("round-trips a studio-generated stylesheet", () => {
    const generated = `:root,
.light {
  --canvas: #f7f8fa;
  --ink: #1c2024;
  --primary: #3b6fd4;
  --destructive: #c0392b;
  --warning: #b5730d;
  --success: #2f7d44;
  --pr-merged: #8250df;
  --file-accent: #3b6fd4;
  --diff-added: #2f7d44;
  --diff-removed: #c0392b;
}
.dark {
  --canvas: #16181d;
  --ink: #e6e8ec;
  --primary: #7aa2f7;
  --destructive: #e06c5f;
  --warning: #e0af68;
  --success: #8fbf7f;
  --pr-merged: #bb9af7;
  --file-accent: #7aa2f7;
  --diff-added: #8fbf7f;
  --diff-removed: #e06c5f;
}`;
    const extracted = extractTokens(generated, "light");
    expect(extracted.missing).toHaveLength(0);
    expect(extracted.tokens.canvas).toBe("#f7f8fa");

    const next = applyTokens(generated, { ...extracted.tokens, primary: "#aa0000" }, {});
    expect(next).toContain("--primary: #aa0000;");
    expect(next).toContain("--canvas: #16181d;");
  });
});
