import { describe, expect, it } from "vitest";
import {
  buildFilePreviewRouteParams,
  parseFilePreviewRouteParams,
  parseLineParam,
  type FilePreviewTarget,
} from "./file-preview-target";

describe("file preview route params", () => {
  it("round-trips every target kind with a line range", () => {
    const targets: FilePreviewTarget[] = [
      {
        kind: "workspace-file",
        path: "src/a.ts",
        source: { kind: "working-tree" },
        statusLabel: null,
      },
      {
        kind: "workspace-file",
        path: "src/b.ts",
        source: { kind: "merge-base", ref: "abc123" },
        statusLabel: "deleted",
      },
      { kind: "host-file", path: "/etc/hosts" },
      { kind: "storage-file", path: "notes/plan.md" },
      { kind: "project-file", path: "README.md" },
    ];
    for (const target of targets) {
      const params = buildFilePreviewRouteParams(target, {
        startLineNumber: 3,
        endLineNumber: 9,
      });
      expect(parseFilePreviewRouteParams(params)).toEqual({
        target,
        lineRange: { startLineNumber: 3, endLineNumber: 9 },
      });
    }
  });

  it("returns null without a path or kind, and ignores bad line params", () => {
    expect(parseFilePreviewRouteParams({})).toBeNull();
    expect(parseFilePreviewRouteParams({ kind: "workspace" })).toBeNull();
    expect(parseFilePreviewRouteParams({ kind: "nope", path: "a" })).toBeNull();
    expect(
      parseFilePreviewRouteParams({ kind: "storage", path: "a", line: "x" }),
    ).toEqual({
      target: { kind: "storage-file", path: "a" },
      lineRange: null,
    });
    expect(parseLineParam("0")).toBeNull();
    expect(parseLineParam("9-3")).toBeNull();
    expect(parseLineParam("7")).toEqual({
      startLineNumber: 7,
      endLineNumber: 7,
    });
  });

  it("defaults an unknown workspace source to the working tree", () => {
    expect(
      parseFilePreviewRouteParams({
        kind: "workspace",
        path: "a",
        source: "weird",
      }),
    ).toMatchObject({ target: { source: { kind: "working-tree" } } });
  });
});
