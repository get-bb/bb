import { describe, expect, it } from "vitest";
import {
  getAbsoluteDirname,
  isAbsoluteFilePathWithinRoot,
  normalizeAbsoluteFilePath,
  resolveRootRelativeFilePath,
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

describe("resolveRootRelativeFilePath", () => {
  it("preserves spaces, Unicode, and percent characters inside the root", () => {
    expect(
      resolveRootRelativeFilePath({
        path: "/work space/资料%/docs/../asset %.png",
        rootPath: "/work space/资料%/",
      }),
    ).toBe("asset %.png");
  });

  it("rejects the root itself and paths outside the root", () => {
    expect(
      resolveRootRelativeFilePath({
        path: "/workspace/project",
        rootPath: "/workspace/project",
      }),
    ).toBeNull();
    expect(
      resolveRootRelativeFilePath({
        path: "/workspace/project/../../secret.txt",
        rootPath: "/workspace/project",
      }),
    ).toBeNull();
  });
});
