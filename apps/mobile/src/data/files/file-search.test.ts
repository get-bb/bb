import { describe, expect, it } from "vitest";
import {
  buildFileSearchSections,
  buildHighlightSegments,
  splitPathForRow,
} from "./file-search";

const entry = (
  path: string,
  score: number,
  kind: "file" | "directory" = "file",
) => ({
  kind,
  path,
  name: path.split("/").at(-1) ?? path,
  score,
  positions: [0],
});

describe("buildFileSearchSections", () => {
  it("keeps files only, ranks by score, caps per source and omits empty sources", () => {
    const sections = buildFileSearchSections({
      workspace: {
        paths: [
          entry("src", 9, "directory"),
          entry("b.ts", 2),
          entry("a.ts", 5),
          entry("c.ts", 1),
        ],
        truncated: false,
      },
      threadStorage: { paths: [], truncated: false },
      limitPerSource: 2,
    });
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({
      source: "workspace",
      title: "Workspace files",
      truncated: true,
    });
    expect(sections[0]?.results.map((result) => result.path)).toEqual([
      "a.ts",
      "b.ts",
    ]);
  });

  it("orders workspace before thread storage and passes the server's truncation flag", () => {
    const sections = buildFileSearchSections({
      workspace: { paths: [entry("a.ts", 1)], truncated: false },
      threadStorage: { paths: [entry("n.md", 1)], truncated: true },
      limitPerSource: 5,
    });
    expect(sections.map((section) => section.source)).toEqual([
      "workspace",
      "thread-storage",
    ]);
    expect(sections[1]?.truncated).toBe(true);
  });
});

describe("buildHighlightSegments", () => {
  it("groups contiguous matched characters", () => {
    expect(buildHighlightSegments("src/app.ts", [4, 5, 6])).toEqual([
      { text: "src/", matched: false },
      { text: "app", matched: true },
      { text: ".ts", matched: false },
    ]);
    expect(buildHighlightSegments("abc", [0, 2])).toEqual([
      { text: "a", matched: true },
      { text: "b", matched: false },
      { text: "c", matched: true },
    ]);
    expect(buildHighlightSegments("abc", [])).toEqual([
      { text: "abc", matched: false },
    ]);
  });
});

describe("splitPathForRow", () => {
  it("splits the directory from the name", () => {
    expect(splitPathForRow("src/lib/a.ts")).toEqual({
      directory: "src/lib",
      name: "a.ts",
    });
    expect(splitPathForRow("a.ts")).toEqual({ directory: "", name: "a.ts" });
  });
});
