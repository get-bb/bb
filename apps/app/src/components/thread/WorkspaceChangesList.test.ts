import { describe, expect, it } from "vitest";
import {
  WORKSPACE_CHANGES_LIST_MAX_ROWS,
  capWorkspaceChangedFiles,
  type WorkspaceChangedFile,
} from "./WorkspaceChangesList";

function makeFiles(count: number): WorkspaceChangedFile[] {
  return Array.from({ length: count }, (_, index) => ({
    path: `dist/output-${index}.js`,
    status: "??" as const,
    insertions: null,
    deletions: null,
  }));
}

describe("capWorkspaceChangedFiles", () => {
  it.each([
    { count: 3, visible: 3, hidden: 0 },
    {
      count: WORKSPACE_CHANGES_LIST_MAX_ROWS,
      visible: WORKSPACE_CHANGES_LIST_MAX_ROWS,
      hidden: 0,
    },
    {
      count: WORKSPACE_CHANGES_LIST_MAX_ROWS + 1234,
      visible: WORKSPACE_CHANGES_LIST_MAX_ROWS,
      hidden: 1234,
    },
  ])(
    "shows $visible of $count files and reports $hidden hidden",
    ({ count, visible, hidden }) => {
      const files = makeFiles(count);
      const { visibleFiles, hiddenFileCount } = capWorkspaceChangedFiles(files);

      expect(visibleFiles).toEqual(files.slice(0, visible));
      expect(hiddenFileCount).toBe(hidden);
    },
  );
});
