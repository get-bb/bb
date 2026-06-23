import { describe, expect, it } from "vitest";
import {
  buildFolderKey,
  countVisibleExpandedFolders,
  folderAncestorKeys,
  normalizeFolderPath,
  splitFolderPath,
} from "./folderPath";

describe("countVisibleExpandedFolders", () => {
  const c = "c";
  const paths = ["Work", "Work/Q3", "Personal"];

  it("counts every folder when none are collapsed", () => {
    expect(countVisibleExpandedFolders(paths, c, new Set())).toBe(3);
  });

  it("excludes a collapsed folder and its hidden descendants", () => {
    // Work is closed; Work/Q3 is hidden behind it; only Personal stays open.
    const collapsed = new Set([buildFolderKey(c, ["Work"])]);
    expect(countVisibleExpandedFolders(paths, c, collapsed)).toBe(1);
  });

  it("counts a visible parent but not its own collapsed child", () => {
    // Work is open (counts), Work/Q3 is closed (does not), Personal is open.
    const collapsed = new Set([buildFolderKey(c, ["Work", "Q3"])]);
    expect(countVisibleExpandedFolders(paths, c, collapsed)).toBe(2);
  });

  it("returns 0 when there are no folders", () => {
    expect(countVisibleExpandedFolders([], c, new Set())).toBe(0);
  });
});

describe("splitFolderPath", () => {
  it("splits on '/', trims segments, and drops empties", () => {
    expect(splitFolderPath("Work/Q3")).toEqual(["Work", "Q3"]);
    expect(splitFolderPath("/Work//Q3/")).toEqual(["Work", "Q3"]);
    expect(splitFolderPath(" Work / Q3 ")).toEqual(["Work", "Q3"]);
  });

  it("returns an empty path for nullish or empty values", () => {
    expect(splitFolderPath(null)).toEqual([]);
    expect(splitFolderPath(undefined)).toEqual([]);
    expect(splitFolderPath("///")).toEqual([]);
    expect(splitFolderPath("")).toEqual([]);
  });
});

describe("normalizeFolderPath", () => {
  it("normalizes paths to slash-separated segments", () => {
    expect(normalizeFolderPath("Work / Q3 ")).toBe("Work/Q3");
  });

  it("normalizes empty paths to null", () => {
    expect(normalizeFolderPath("///")).toBeNull();
    expect(normalizeFolderPath(null)).toBeNull();
  });
});

describe("buildFolderKey", () => {
  it("namespaces a folder path by its container id", () => {
    expect(buildFolderKey("proj_bb", ["Work", "Q3"])).toBe("proj_bb::Work/Q3");
  });

  it("keeps same-named folders in different containers distinct", () => {
    expect(buildFolderKey("proj_a", ["Work"])).not.toBe(
      buildFolderKey("proj_b", ["Work"]),
    );
  });

  it("uses the global sentinels for the non-project sections", () => {
    expect(buildFolderKey("pinned", ["Work"])).toBe("pinned::Work");
    expect(buildFolderKey("chronological", ["Work"])).toBe(
      "chronological::Work",
    );
  });
});

describe("folderAncestorKeys", () => {
  it("returns every ancestor folder key, outermost first", () => {
    expect(folderAncestorKeys("proj_1", "Work/Q3")).toEqual([
      "proj_1::Work",
      "proj_1::Work/Q3",
    ]);
  });

  it("returns no keys for no folder path", () => {
    expect(folderAncestorKeys("proj_1", null)).toEqual([]);
    expect(folderAncestorKeys("proj_1", "")).toEqual([]);
  });

  it("namespaces by container, including the global sentinels", () => {
    expect(folderAncestorKeys("pinned", "A/B")).toEqual([
      "pinned::A",
      "pinned::A/B",
    ]);
  });
});
