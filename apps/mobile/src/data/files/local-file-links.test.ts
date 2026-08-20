import { describe, expect, it } from "vitest";
import {
  isRelativeFilePathCandidate,
  normalizeAbsoluteFilePath,
  relativeFileLinkCandidates,
  relativizeLocalFilePath,
  resolveRelativeLink,
  resolveThreadLocalFileLink,
} from "./local-file-links";

describe("normalizeAbsoluteFilePath / relativizeLocalFilePath", () => {
  it("collapses dot segments and rejects relative paths", () => {
    expect(normalizeAbsoluteFilePath("/a/./b/../c//d")).toBe("/a/c/d");
    expect(normalizeAbsoluteFilePath("/../..")).toBe("/");
    expect(normalizeAbsoluteFilePath("a/b")).toBeNull();
  });

  it("relativizes only paths strictly inside the root", () => {
    expect(relativizeLocalFilePath("/repo/src/a.ts", "/repo/")).toEqual({
      path: "/repo/src/a.ts",
      relativePath: "src/a.ts",
      rootPath: "/repo",
    });
    expect(relativizeLocalFilePath("/repo", "/repo")).toBeNull();
    expect(relativizeLocalFilePath("/repo-other/a.ts", "/repo")).toBeNull();
    expect(relativizeLocalFilePath("/x/a.ts", "/")).toMatchObject({
      relativePath: "x/a.ts",
    });
  });
});

describe("resolveThreadLocalFileLink", () => {
  const roots = {
    workspaceRootPath: "/work/repo",
    threadStorageRootPath: "/home/u/.bb/storage/t1",
    hostFileLinksAvailable: true,
    lineRange: { startLineNumber: 3, endLineNumber: 3 },
  };

  it("prefers the workspace root, then thread storage, then the host", () => {
    expect(
      resolveThreadLocalFileLink({ ...roots, path: "/work/repo/src/a.ts" }),
    ).toEqual({
      kind: "workspace-file",
      relativePath: "src/a.ts",
      path: "/work/repo/src/a.ts",
      lineRange: roots.lineRange,
    });
    expect(
      resolveThreadLocalFileLink({
        ...roots,
        path: "/home/u/.bb/storage/t1/notes.md",
      }),
    ).toMatchObject({ kind: "storage-file", relativePath: "notes.md" });
    expect(
      resolveThreadLocalFileLink({ ...roots, path: "/etc/hosts" }),
    ).toEqual({
      kind: "host-file",
      path: "/etc/hosts",
      lineRange: roots.lineRange,
    });
  });

  it("falls through to host when the roots are unknown, and errors without an environment", () => {
    expect(
      resolveThreadLocalFileLink({
        ...roots,
        workspaceRootPath: null,
        threadStorageRootPath: null,
        path: "/work/repo/src/a.ts",
      }),
    ).toMatchObject({ kind: "host-file" });
    expect(
      resolveThreadLocalFileLink({
        ...roots,
        hostFileLinksAvailable: false,
        path: "/etc/hosts",
      }),
    ).toMatchObject({ kind: "error" });
    expect(
      resolveThreadLocalFileLink({ ...roots, path: "relative.ts" }),
    ).toMatchObject({ kind: "error" });
  });
});

describe("relative link candidates", () => {
  it("recognises relative file references and not URLs / fragments / bare words", () => {
    expect(isRelativeFilePathCandidate("src/a.ts")).toBe(true);
    expect(isRelativeFilePathCandidate("README.md")).toBe(true);
    expect(isRelativeFilePathCandidate("https://x.y/z")).toBe(false);
    expect(isRelativeFilePathCandidate("#heading")).toBe(false);
    expect(isRelativeFilePathCandidate("/abs/a.ts")).toBe(false);
    expect(isRelativeFilePathCandidate("word")).toBe(false);
  });

  it("offers one candidate per known root and refuses traversal", () => {
    expect(
      relativeFileLinkCandidates({
        relativePath: "./docs/a.md",
        workspaceRootPath: "/w",
        threadStorageRootPath: null,
      }),
    ).toEqual([
      { kind: "workspace-file", relativePath: "docs/a.md", rootPath: "/w" },
    ]);
    expect(
      relativeFileLinkCandidates({
        relativePath: "../a.md",
        workspaceRootPath: "/w",
        threadStorageRootPath: "/s",
      }),
    ).toEqual([]);
  });
});

describe("resolveRelativeLink", () => {
  it("resolves against root-relative and absolute bases", () => {
    expect(resolveRelativeLink("docs/guide", "../img/a.png")).toBe(
      "docs/img/a.png",
    );
    expect(resolveRelativeLink("", "./b.md")).toBe("b.md");
    expect(resolveRelativeLink("docs", "../../x")).toBeNull();
    expect(resolveRelativeLink("/home/u/docs", "../a.md")).toBe("/home/u/a.md");
  });
});
