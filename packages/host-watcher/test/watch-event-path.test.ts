import { describe, expect, it } from "vitest";
import {
  dedupeWatchPathChanges,
  isExtendedLengthWindowsPath,
  isWatchPathWithinRoot,
  normalizeWatchEventPath,
  toWatchRootRelativeKey,
} from "../src/watch-event-path.js";

describe("watch event paths on win32", () => {
  it("resolves relative event paths against the watched root", () => {
    expect(
      normalizeWatchEventPath("C:\\work\\repo", "src\\file.ts", "win32"),
    ).toBe("C:\\work\\repo\\src\\file.ts");
  });

  it("normalizes forward slashes and dot segments in absolute events", () => {
    expect(
      normalizeWatchEventPath(
        "C:\\work\\repo",
        "C:/work/repo/sub/../file.ts",
        "win32",
      ),
    ).toBe("C:\\work\\repo\\file.ts");
  });

  it("leaves extended-length event paths untouched", () => {
    const extendedPath = "\\\\?\\C:\\very\\long\\sub\\..\\file.ts";
    expect(
      normalizeWatchEventPath("C:\\work\\repo", extendedPath, "win32"),
    ).toBe(extendedPath);
  });

  it("joins relative events under an extended-length root without normalizing", () => {
    const root = "\\\\?\\C:\\very\\long\\repo";
    expect(normalizeWatchEventPath(root, "sub\\file.ts", "win32")).toBe(
      "\\\\?\\C:\\very\\long\\repo\\sub\\file.ts",
    );
  });

  it("does not join absolute events onto an extended-length root", () => {
    expect(
      normalizeWatchEventPath(
        "\\\\?\\C:\\very\\long\\repo",
        "C:\\very\\long\\repo\\file.ts",
        "win32",
      ),
    ).toBe("C:\\very\\long\\repo\\file.ts");
  });

  it("resolves relatives under UNC roots and keeps spaces and non-ascii", () => {
    expect(
      normalizeWatchEventPath(
        "\\\\server\\share\\dir",
        "proyectos\\diseño\\notas.md",
        "win32",
      ),
    ).toBe("\\\\server\\share\\dir\\proyectos\\diseño\\notas.md");
  });

  it("treats same paths with different case as within root", () => {
    expect(
      isWatchPathWithinRoot("C:\\Work\\Repo", "c:\\work\\repo", "win32"),
    ).toBe(true);
    expect(
      isWatchPathWithinRoot(
        "C:\\Work\\Repo",
        "C:\\WORK\\repo\\SRC\\File.TS",
        "win32",
      ),
    ).toBe(true);
  });

  it("rejects siblings, other drives and parent escapes", () => {
    expect(
      isWatchPathWithinRoot("C:\\Work\\Repo", "C:\\Work\\Repo2\\x", "win32"),
    ).toBe(false);
    expect(
      isWatchPathWithinRoot("C:\\Work\\Repo", "D:\\Work\\Repo\\x", "win32"),
    ).toBe(false);
    expect(
      isWatchPathWithinRoot("C:\\Work\\Repo", "C:\\Work\\Repo\\..\\x", "win32"),
    ).toBe(false);
  });

  it("matches mixed extended-length and plain spellings of the same file", () => {
    expect(
      isWatchPathWithinRoot(
        "\\\\?\\C:\\Work\\Repo",
        "c:\\work\\repo\\sub\\file.ts",
        "win32",
      ),
    ).toBe(true);
    expect(
      isWatchPathWithinRoot(
        "C:\\Work\\Repo",
        "\\\\?\\C:\\WORK\\REPO\\sub\\file.ts",
        "win32",
      ),
    ).toBe(true);
  });

  it("matches UNC roots case-insensitively", () => {
    expect(
      isWatchPathWithinRoot(
        "\\\\server\\share\\dir",
        "\\\\SERVER\\SHARE\\dir\\sub\\f.txt",
        "win32",
      ),
    ).toBe(true);
  });

  it("emits forward-slash relative keys for windows candidates", () => {
    expect(
      toWatchRootRelativeKey(
        "C:\\work\\repo",
        "C:\\work\\repo\\sub\\file.ts",
        "win32",
      ),
    ).toBe("sub/file.ts");
  });

  it("dedupes windows changes case-insensitively per change type", () => {
    const changes = dedupeWatchPathChanges(
      [
        { path: "C:\\work\\repo\\FILE.ts", type: "update" },
        { path: "c:\\WORK\\repo\\file.ts", type: "update" },
        { path: "c:\\WORK\\repo\\file.ts", type: "create" },
      ],
      "win32",
    );
    expect(changes).toEqual([
      { path: "C:\\work\\repo\\FILE.ts", type: "update" },
      { path: "c:\\WORK\\repo\\file.ts", type: "create" },
    ]);
  });

  it("keeps case variants distinct on case-sensitive platforms", () => {
    const changes = dedupeWatchPathChanges(
      [
        { path: "/work/repo/FILE.ts", type: "update" },
        { path: "/work/repo/file.ts", type: "update" },
      ],
      "linux",
    );
    expect(changes).toHaveLength(2);
  });
});

describe("watch event paths on posix", () => {
  it("resolves relatives and normalizes absolute events", () => {
    expect(normalizeWatchEventPath("/work/repo", "src/file.ts", "linux")).toBe(
      "/work/repo/src/file.ts",
    );
    expect(
      normalizeWatchEventPath("/work/repo", "/work/repo/a/../b.ts", "linux"),
    ).toBe("/work/repo/b.ts");
  });

  it("detects extended-length windows paths only by prefix", () => {
    expect(isExtendedLengthWindowsPath("\\\\?\\C:\\x")).toBe(true);
    expect(isExtendedLengthWindowsPath("\\\\.\\C:\\x")).toBe(true);
    expect(isExtendedLengthWindowsPath("C:\\x")).toBe(false);
    expect(isExtendedLengthWindowsPath("\\\\server\\share")).toBe(false);
  });
});
