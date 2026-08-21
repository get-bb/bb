import { describe, expect, it } from "vitest";
import { normalizeMathFences } from "./markdown-math-fences.js";

const SUFFIX = ["", "## After", "", "- item"].join("\n");

describe("normalizeMathFences", () => {
  it("splits a glued opener and trailing closer onto their own lines", () => {
    const input = ["$$T_{a}", "\\approx 73$$", SUFFIX].join("\n");
    expect(normalizeMathFences(input)).toBe(
      ["$$", "T_{a}", "\\approx 73", "$$", SUFFIX].join("\n"),
    );
  });

  it("closes a bare opener at a trailing `$$`", () => {
    const input = ["$$", "\\frac{1}{2}$$", SUFFIX].join("\n");
    expect(normalizeMathFences(input)).toBe(
      ["$$", "\\frac{1}{2}", "$$", SUFFIX].join("\n"),
    );
  });

  it("moves opener meta into the block when the closer is bare", () => {
    const input = ["$$\\frac{1}{2}", "$$", SUFFIX].join("\n");
    expect(normalizeMathFences(input)).toBe(
      ["$$", "\\frac{1}{2}", "$$", SUFFIX].join("\n"),
    );
  });

  it("closes each block at its own delimiter", () => {
    const input = ["$$a", "b$$", "", "text", "", "$$", "c$$"].join("\n");
    expect(normalizeMathFences(input)).toBe(
      ["$$", "a", "b", "$$", "", "text", "", "$$", "c", "$$"].join("\n"),
    );
  });

  it("returns the same string for canonical blocks, inline math, and prose", () => {
    for (const input of [
      ["$$", "\\frac{1}{2}", "$$", SUFFIX].join("\n"),
      ["Mass-energy is $$E = mc^2$$ exactly.", SUFFIX].join("\n"),
      ["$$a$$ and $$b$$", SUFFIX].join("\n"),
      "It went from $5 to $10 and costs $$$.",
      "no math here",
    ]) {
      expect(normalizeMathFences(input)).toBe(input);
    }
  });

  it("leaves a span with no closing delimiter alone", () => {
    const input = ["$$T_{a}", "\\approx 73", SUFFIX].join("\n");
    expect(normalizeMathFences(input)).toBe(input);
  });

  it("does not rewrite inside fenced code or across a code fence", () => {
    const inCode = ["```tex", "$$T_{a}", "b$$", "```"].join("\n");
    expect(normalizeMathFences(inCode)).toBe(inCode);
    const acrossFence = ["$$T_{a}", "```", "b$$", "```"].join("\n");
    expect(normalizeMathFences(acrossFence)).toBe(acrossFence);
  });

  it("leaves indented code alone", () => {
    const input = ["    $$T_{a}", "    b$$"].join("\n");
    expect(normalizeMathFences(input)).toBe(input);
  });

  it("handles CRLF line endings", () => {
    const input = "$$T_{a}\r\n\\approx 73$$\r\n\r\n## After";
    expect(normalizeMathFences(input)).toBe(
      "$$\nT_{a}\n\\approx 73\n$$\n\r\n## After",
    );
  });
});
