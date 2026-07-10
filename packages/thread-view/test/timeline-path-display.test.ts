import { describe, expect, it } from "vitest";
import { fileNameFromPath } from "../src/timeline-path-display.js";

describe("fileNameFromPath", () => {
  it.each([
    ["/tmp/repo/src/index.ts", "index.ts"],
    ["C:\\repo\\docs\\CODE_REVIEW.md", "CODE_REVIEW.md"],
    ["/tmp/repo/", "/tmp/repo/"],
  ])("extracts a portable filename from %s", (path, expected) => {
    expect(fileNameFromPath(path)).toBe(expected);
  });
});
