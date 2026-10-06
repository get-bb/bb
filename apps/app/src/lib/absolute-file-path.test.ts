import { describe, expect, it } from "vitest";
import {
  buildAbsoluteFilePath,
  getAbsoluteDirname,
  isAbsoluteFilePathWithinRoot,
  normalizeAbsoluteFilePath,
} from "./absolute-file-path";

describe("getAbsoluteDirname", () => {
  it.each([
    ["/storage/thr_1/current/summary.md", "/storage/thr_1/current"],
    ["/README.md", "/"],
    ["/storage/thr_1/", "/storage"],
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
});

describe("Windows host paths", () => {
  it("normalizes drive paths to one spelling", () => {
    expect(
      normalizeAbsoluteFilePath({ path: "c:/src/repo/docs/../README.md" }),
    ).toBe("C:\\src\\repo\\README.md");
  });

  it("decides containment without regard to case or separator", () => {
    expect(
      isAbsoluteFilePathWithinRoot({
        candidatePath: "c:/SRC/repo/src/file.ts",
        rootPath: "C:\\src\\repo",
      }),
    ).toBe(true);
    expect(
      isAbsoluteFilePathWithinRoot({
        candidatePath: "C:\\src\\repo-copy\\file.ts",
        rootPath: "C:\\src\\repo",
      }),
    ).toBe(false);
  });

  it("joins repository-relative paths with backslashes", () => {
    expect(
      buildAbsoluteFilePath({
        path: "src/file.ts",
        rootPath: "C:\\src\\repo",
      }),
    ).toBe("C:\\src\\repo\\src\\file.ts");
    expect(
      buildAbsoluteFilePath({
        path: "D:\\other\\file.ts",
        rootPath: "C:\\src\\repo",
      }),
    ).toBe("D:\\other\\file.ts");
  });

  it("finds the parent directory of a drive path", () => {
    expect(getAbsoluteDirname({ path: "C:\\src\\repo\\file.ts" })).toBe(
      "C:\\src\\repo",
    );
    expect(getAbsoluteDirname({ path: "C:\\file.ts" })).toBe("C:\\");
  });
});
