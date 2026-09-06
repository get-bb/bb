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
    expect(
      normalizeAbsoluteFilePath({
        path: "C:\\Users\\me\\project\\docs\\..\\README.md",
      }),
    ).toBe("C:\\Users\\me\\project\\README.md");
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

  it("accepts Windows paths inside a Windows root through the same code", () => {
    expect(
      isAbsoluteFilePathWithinRoot({
        candidatePath: "C:\\Users\\me\\project\\src\\file.ts",
        rootPath: "C:\\Users\\me\\project",
      }),
    ).toBe(true);
    expect(
      isAbsoluteFilePathWithinRoot({
        candidatePath: "c:\\users\\me\\project\\src\\file.ts",
        rootPath: "C:\\Users\\me\\project",
      }),
    ).toBe(true);
  });

  it("rejects Windows paths outside the root and mismatched flavours", () => {
    expect(
      isAbsoluteFilePathWithinRoot({
        candidatePath: "C:\\Users\\me\\other\\file.ts",
        rootPath: "C:\\Users\\me\\project",
      }),
    ).toBe(false);
    expect(
      isAbsoluteFilePathWithinRoot({
        candidatePath: "/Users/me/project/src/file.ts",
        rootPath: "C:\\Users\\me\\project",
      }),
    ).toBe(false);
    expect(
      isAbsoluteFilePathWithinRoot({
        candidatePath: "C:\\Users\\me\\project\\src\\file.ts",
        rootPath: "/Users/me/project",
      }),
    ).toBe(false);
  });
});
