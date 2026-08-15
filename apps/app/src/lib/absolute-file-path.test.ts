import { describe, expect, it } from "vitest";
import {
  getAbsoluteDirname,
  isAbsoluteFilePathWithinRoot,
  normalizeAbsoluteFilePath,
} from "./absolute-file-path";

describe("getAbsoluteDirname", () => {
  it.each([
    ["/storage/thr_1/current/summary.md", "/storage/thr_1/current"],
    ["/README.md", "/"],
    ["/storage/thr_1/", "/storage"],
    ["C:\\repo\\docs\\a.md", "C:\\repo\\docs"],
    ["C:\\repo\\file.md", "C:\\repo"],
  ])("resolves the parent of %s", (path, expected) => {
    expect(getAbsoluteDirname({ path })).toBe(expected);
  });
});

describe("normalizeAbsoluteFilePath", () => {
  it("normalizes dot segments in absolute file paths", () => {
    expect(
      normalizeAbsoluteFilePath({
        path: "/Users/me/project/docs/../README.md",
      }),
    ).toBe("/Users/me/project/README.md");
  });

  it("rejects relative file paths", () => {
    expect(normalizeAbsoluteFilePath({ path: "docs/README.md" })).toBeNull();
  });

  it("normalizes native Windows absolute paths", () => {
    expect(
      normalizeAbsoluteFilePath({
        path: "C:\\Users\\me\\project\\docs\\..\\README.md",
      }),
    ).toBe("C:\\Users\\me\\project\\README.md");
  });
});

describe("isAbsoluteFilePathWithinRoot", () => {
  it("accepts normalized paths inside the root", () => {
    expect(
      isAbsoluteFilePathWithinRoot({
        candidatePath: "/Users/me/project/docs/../README.md",
        rootPath: "/Users/me/project/",
      }),
    ).toBe(true);
  });

  it("rejects normalized paths outside the root", () => {
    expect(
      isAbsoluteFilePathWithinRoot({
        candidatePath: "/Users/me/project/../../.ssh/id_rsa",
        rootPath: "/Users/me/project",
      }),
    ).toBe(false);
  });

  it("does not confuse sibling roots with matching prefixes", () => {
    expect(
      isAbsoluteFilePathWithinRoot({
        candidatePath: "/Users/me/project-copy/README.md",
        rootPath: "/Users/me/project",
      }),
    ).toBe(false);
  });

  it("treats mixed C:/ and C:\\ as the same root", () => {
    expect(
      isAbsoluteFilePathWithinRoot({
        candidatePath: "C:\\repo\\file.md",
        rootPath: "C:/repo",
      }),
    ).toBe(true);
  });

  it("folds drive-letter case on Windows paths", () => {
    expect(
      isAbsoluteFilePathWithinRoot({
        candidatePath: "c:\\repo\\file.md",
        rootPath: "C:\\repo",
      }),
    ).toBe(true);
  });
});
