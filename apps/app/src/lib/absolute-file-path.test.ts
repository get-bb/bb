import { describe, expect, it } from "vitest";
import {
  buildAbsoluteFilePath,
  getAbsoluteDirname,
  isAbsoluteFilePathWithinRoot,
  normalizeAbsoluteFilePath,
  resolveAbsoluteFilePath,
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
        candidatePath: "C:\\Users\\me\.ssh\\id_rsa",
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

describe("getAbsoluteDirname", () => {
  it("resolves Windows dirnames", () => {
    expect(
      getAbsoluteDirname({ path: "C:\\Users\\me\\project\\src\\file.ts" }),
    ).toBe("C:/Users/me/project/src");
    expect(getAbsoluteDirname({ path: "c:/Users/me/file.ts" })).toBe(
      "c:/Users/me",
    );
  });
});

describe("buildAbsoluteFilePath and resolveAbsoluteFilePath", () => {
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
