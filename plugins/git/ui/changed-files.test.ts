import { describe, expect, it } from "vitest";
import type {
  WorkspaceChangedFilesSection,
} from "@bb/shared-ui/workspace-change-summary";
import { resolveChangedFileOpen } from "./changed-files.js";
import type {
  WorkspaceFileStatus,
  WorkspaceFileStatusKind,
} from "../contract.js";

function file(status: WorkspaceFileStatusKind): WorkspaceFileStatus {
  return { path: "src/file.ts", status, insertions: null, deletions: null };
}

function section(
  overrides: Partial<WorkspaceChangedFilesSection<WorkspaceFileStatus>> = {},
): WorkspaceChangedFilesSection<WorkspaceFileStatus> {
  const changed = file("M");
  return {
    kind: "uncommitted",
    label: "Uncommitted files",
    files: [changed],
    mergeBaseRef: null,
    stats: {
      files: [changed],
      insertions: 1,
      deletions: 1,
      lineStatsComplete: true,
      fileCount: 1,
    },
    ...overrides,
  };
}

describe("resolveChangedFileOpen", () => {
  it("previews added and untracked files", () => {
    expect(resolveChangedFileOpen({ file: file("A"), section: section() })).toEqual(
      { kind: "preview", ref: undefined },
    );
    expect(
      resolveChangedFileOpen({
        file: file("??"),
        section: section({ kind: "untracked" }),
      }),
    ).toEqual({ kind: "preview", ref: undefined });
  });

  it("previews a working-tree deletion from HEAD", () => {
    expect(resolveChangedFileOpen({ file: file("D"), section: section() })).toEqual(
      { kind: "preview", ref: "HEAD" },
    );
  });

  it("previews a committed deletion from the merge base when its ref is known", () => {
    expect(
      resolveChangedFileOpen({
        file: file("D"),
        section: section({ kind: "committed", mergeBaseRef: "abc1234" }),
      }),
    ).toEqual({ kind: "preview", ref: "abc1234" });
    expect(
      resolveChangedFileOpen({
        file: file("D"),
        section: section({ kind: "committed", mergeBaseRef: null }),
      }),
    ).toEqual({ kind: "diff" });
  });

  it("opens every other status in the Diff tab", () => {
    for (const status of ["M", "C", "R", "U", "?"] as const) {
      expect(
        resolveChangedFileOpen({ file: file(status), section: section() }),
      ).toEqual({ kind: "diff" });
    }
  });
});
