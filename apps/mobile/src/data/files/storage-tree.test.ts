import { describe, expect, it } from "vitest";
import {
  buildStorageBreadcrumbs,
  buildStorageDirectoryPaths,
  filterStorageFiles,
  listStorageDirectory,
  parentStorageDirectory,
} from "./storage-tree";

const FILES = [
  { path: "notes.md", name: "notes.md" },
  { path: "reports/q1/summary.csv", name: "summary.csv" },
  { path: "reports/q1/raw.json", name: "raw.json" },
  { path: "reports/q2.md", name: "q2.md" },
  { path: "Zeta.txt", name: "Zeta.txt" },
  { path: "assets/logo.png", name: "logo.png" },
];

describe("buildStorageDirectoryPaths", () => {
  it("derives every intermediate directory once", () => {
    expect(buildStorageDirectoryPaths(FILES).sort()).toEqual([
      "assets",
      "reports",
      "reports/q1",
    ]);
  });
});

describe("listStorageDirectory", () => {
  it("lists root children: directories first (with recursive counts), then files sorted case-insensitively", () => {
    expect(listStorageDirectory(FILES, "")).toEqual([
      { kind: "directory", path: "assets", name: "assets", fileCount: 1 },
      { kind: "directory", path: "reports", name: "reports", fileCount: 3 },
      { kind: "file", path: "notes.md", name: "notes.md" },
      { kind: "file", path: "Zeta.txt", name: "Zeta.txt" },
    ]);
  });

  it("lists a nested directory without leaking siblings that share a prefix", () => {
    const files = [...FILES, { path: "reports-old/x.md", name: "x.md" }];
    expect(listStorageDirectory(files, "reports")).toEqual([
      { kind: "directory", path: "reports/q1", name: "q1", fileCount: 2 },
      { kind: "file", path: "reports/q2.md", name: "q2.md" },
    ]);
    expect(
      listStorageDirectory(files, "reports/q1").map((e) => e.path),
    ).toEqual(["reports/q1/raw.json", "reports/q1/summary.csv"]);
  });

  it("returns nothing for an unknown directory", () => {
    expect(listStorageDirectory(FILES, "missing")).toEqual([]);
  });
});

describe("buildStorageBreadcrumbs / parentStorageDirectory", () => {
  it("builds root + one crumb per segment", () => {
    expect(buildStorageBreadcrumbs("reports/q1")).toEqual([
      { path: "", label: "Storage" },
      { path: "reports", label: "reports" },
      { path: "reports/q1", label: "q1" },
    ]);
    expect(buildStorageBreadcrumbs("")).toEqual([
      { path: "", label: "Storage" },
    ]);
  });

  it("walks up to the root", () => {
    expect(parentStorageDirectory("reports/q1")).toBe("reports");
    expect(parentStorageDirectory("reports")).toBe("");
    expect(parentStorageDirectory("")).toBe("");
  });
});

describe("filterStorageFiles", () => {
  it("matches case-insensitively anywhere in the path and reports the offsets", () => {
    const matches = filterStorageFiles(FILES, "Q1/");
    expect(matches.map((match) => match.file.path)).toEqual([
      "reports/q1/summary.csv",
      "reports/q1/raw.json",
    ]);
    expect(matches[0]?.positions).toEqual([8, 9, 10]);
  });

  it("returns everything (no highlight) for a blank query", () => {
    const matches = filterStorageFiles(FILES, "   ");
    expect(matches).toHaveLength(FILES.length);
    expect(matches.every((match) => match.positions.length === 0)).toBe(true);
  });
});
