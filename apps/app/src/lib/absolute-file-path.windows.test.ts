import { describe, expect, it } from "vitest";
import {
  buildAbsoluteFilePath,
  getAbsoluteDirname,
  isAbsoluteFilePathWithinRoot,
  normalizeAbsoluteFilePath,
  resolveAbsoluteFilePath,
} from "./absolute-file-path";

describe("normalizeAbsoluteFilePath on native Windows paths", () => {
  it("normalizes native Windows paths to forward slashes", () => {
    expect(
      normalizeAbsoluteFilePath({
        path: "C:\\Users\\me\\project\\docs\\..\\README.md",
      }),
    ).toBe("c:/Users/me/project/README.md");
  });

  it("normalizes mixed-separator Windows paths", () => {
    expect(
      normalizeAbsoluteFilePath({
        path: "C:/Users/me/project\\src/file.ts",
      }),
    ).toBe("c:/Users/me/project/src/file.ts");
  });

  it("accepts a drive-letter root as absolute", () => {
    expect(normalizeAbsoluteFilePath({ path: "c:\\" })).toBe("c:");
    expect(normalizeAbsoluteFilePath({ path: "d:/" })).toBe("d:");
  });

  it("rejects Windows paths without a drive separator", () => {
    expect(normalizeAbsoluteFilePath({ path: "C:relative" })).toBeNull();
  });
});

describe("isAbsoluteFilePathWithinRoot on native Windows paths", () => {
  it("contains native Windows paths within their root", () => {
    expect(
      isAbsoluteFilePathWithinRoot({
        candidatePath: "C:\\Users\\me\\project\\docs\\..\\README.md",
        rootPath: "c:/Users/me/project",
      }),
    ).toBe(true);
  });

  it("compares full Windows paths case-insensitively", () => {
    expect(
      isAbsoluteFilePathWithinRoot({
        candidatePath: "C:\\users\\me\\project\\File.ts",
        rootPath: "c:/Users/me/project",
      }),
    ).toBe(true);
    expect(
      isAbsoluteFilePathWithinRoot({
        candidatePath: "C:\\USERS\\ME\\PROJECT-COPY\\File.ts",
        rootPath: "c:/Users/me/project",
      }),
    ).toBe(false);
  });

  it("keeps native Windows paths outside their root", () => {
    expect(
      isAbsoluteFilePathWithinRoot({
        candidatePath: "C:\\Users\\me\\.ssh\\id_rsa",
        rootPath: "C:\\Users\\me\\project",
      }),
    ).toBe(false);
  });

  it("does not confuse sibling Windows roots with matching prefixes", () => {
    expect(
      isAbsoluteFilePathWithinRoot({
        candidatePath: "C:\\Users\\me\\project-copy\\README.md",
        rootPath: "C:\\Users\\me\\project",
      }),
    ).toBe(false);
  });

  it("does not match a Windows path against a POSIX root", () => {
    expect(
      isAbsoluteFilePathWithinRoot({
        candidatePath: "C:\\Users\\me\\project\\README.md",
        rootPath: "/Users/me/project",
      }),
    ).toBe(false);
  });
});

describe("getAbsoluteDirname on native Windows paths", () => {
  it("resolves Windows dirnames", () => {
    expect(
      getAbsoluteDirname({ path: "C:\\Users\\me\\project\\src\\file.ts" }),
    ).toBe("C:/Users/me/project/src");
    expect(getAbsoluteDirname({ path: "c:/Users/me/file.ts" })).toBe(
      "c:/Users/me",
    );
  });
});

describe("buildAbsoluteFilePath and resolveAbsoluteFilePath on native Windows paths", () => {
  it("builds a Windows path from a root and a relative path", () => {
    expect(
      buildAbsoluteFilePath({
        path: "src/file.ts",
        rootPath: "C:\\Users\\me\\project",
      }),
    ).toBe("C:/Users/me/project/src/file.ts");
  });

  it("passes through an absolute Windows path", () => {
    expect(
      resolveAbsoluteFilePath({
        path: "C:\\Users\\me\\file.ts",
        rootPath: "/irrelevant",
      }),
    ).toBe("C:\\Users\\me\\file.ts");
  });
});
