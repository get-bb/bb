// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  enrichGitDiffFileForContext,
  formatGitDiffFileLabel,
  getGitDiffFileChangeKind,
  getOpenableGitDiffPath,
  parseGitDiffFiles,
  summarizeGitDiff,
} from "./git-diff-parsing";

const SAMPLE_DIFF = [
  "diff --git a/src/old.ts b/src/new.ts",
  "index 1111111..2222222 100644",
  "--- a/src/old.ts",
  "+++ b/src/new.ts",
  "@@ -1 +1 @@",
  "-old",
  "+new",
  "",
].join("\n");

const DIFF_WITH_CONTEXT = [
  "diff --git a/src/context.ts b/src/context.ts",
  "index 1111111..2222222 100644",
  "--- a/src/context.ts",
  "+++ b/src/context.ts",
  "@@ -1,5 +1,5 @@",
  " const first = 1;",
  " const second = 2;",
  "-const value = 3;",
  "+const value = 4;",
  " const fourth = 4;",
  " const fifth = 5;",
  "",
].join("\n");

const NEW_FILE_DIFF = [
  "diff --git a/src/new-file.ts b/src/new-file.ts",
  "new file mode 100644",
  "index 0000000..1111111",
  "--- /dev/null",
  "+++ b/src/new-file.ts",
  "@@ -0,0 +1 @@",
  "+export const value = 1;",
  "",
].join("\n");

const DELETED_FILE_DIFF = [
  "diff --git a/src/deleted-file.ts b/src/deleted-file.ts",
  "deleted file mode 100644",
  "index 1111111..0000000",
  "--- a/src/deleted-file.ts",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-export const value = 1;",
  "",
].join("\n");

const RENAME_ONLY_DIFF = [
  "diff --git a/src/old-name.ts b/src/new-name.ts",
  "similarity index 100%",
  "rename from src/old-name.ts",
  "rename to src/new-name.ts",
  "",
].join("\n");

const OLD_CONTEXT_CONTENT = Array.from(
  { length: 10 },
  (_, index) => `line ${index + 1}`,
).join("\n");

const NEW_CONTEXT_CONTENT = Array.from({ length: 10 }, (_, index) => {
  if (index === 1) return "line two";
  if (index === 7) return "line eight";
  return `line ${index + 1}`;
}).join("\n");

const MULTI_HUNK_DIFF = [
  "diff --git a/src/context.ts b/src/context.ts",
  "index 1111111..2222222 100644",
  "--- a/src/context.ts",
  "+++ b/src/context.ts",
  "@@ -2 +2 @@",
  "-line 2",
  "+line two",
  "@@ -8 +8 @@",
  "-line 8",
  "+line eight",
  "",
].join("\n");

describe("threadDetailGitDiff", () => {
  it("normalizes the openable path and label from a renamed file's sides", () => {
    const [file] = parseGitDiffFiles(SAMPLE_DIFF);
    expect(file).toBeDefined();
    if (!file) return;

    expect(getOpenableGitDiffPath(file)).toBe("src/new.ts");
    expect(formatGitDiffFileLabel(file)).toBe("src/new.ts");
  });

  it("falls back to raw diff counting before parsed files are available", () => {
    expect(summarizeGitDiff([], SAMPLE_DIFF)).toEqual({
      filesCount: 1,
      insertions: 1,
      deletions: 1,
    });
  });

  it("summarizes parsed diffs from changed lines, not hunk range sizes", () => {
    const [file] = parseGitDiffFiles(DIFF_WITH_CONTEXT);
    expect(file).toBeDefined();
    if (!file) return;

    expect(summarizeGitDiff([file], DIFF_WITH_CONTEXT)).toEqual({
      filesCount: 1,
      insertions: 1,
      deletions: 1,
    });
  });

  it("parses new-file diffs so untracked files can render in the secondary panel diff view", () => {
    const [file] = parseGitDiffFiles(NEW_FILE_DIFF);
    expect(file).toBeDefined();
    if (!file) return;

    expect(formatGitDiffFileLabel(file)).toBe("src/new-file.ts");
    expect(getOpenableGitDiffPath(file)).toBe("src/new-file.ts");
    expect(getGitDiffFileChangeKind(file)).toBe("added");
  });

  it("derives deleted and renamed file kinds from parsed git metadata", () => {
    const [deletedFile] = parseGitDiffFiles(DELETED_FILE_DIFF);
    const [renamedFile] = parseGitDiffFiles(RENAME_ONLY_DIFF);

    expect(deletedFile).toBeDefined();
    expect(renamedFile).toBeDefined();
    if (!deletedFile || !renamedFile) return;

    expect(getGitDiffFileChangeKind(deletedFile)).toBe("deleted");
    expect(getGitDiffFileChangeKind(renamedFile)).toBe("renamed");
    expect(formatGitDiffFileLabel(renamedFile)).toBe(
      "src/old-name.ts -> src/new-name.ts",
    );
  });

  it("reparses a patch with full file contents so diff context can expand", () => {
    const [file] = parseGitDiffFiles(MULTI_HUNK_DIFF);
    expect(file).toBeDefined();
    if (!file) throw new Error("expected parsed file");

    expect(file.isPartial).toBe(true);
    expect(file.additionLines).toEqual(["line two\n", "line eight\n"]);

    const enrichedFile = enrichGitDiffFileForContext({
      fileDiff: file,
      oldFile: {
        name: "src/context.ts",
        contents: `${OLD_CONTEXT_CONTENT}\n`,
      },
      newFile: {
        name: "src/context.ts",
        contents: `${NEW_CONTEXT_CONTENT}\n`,
      },
      patchText: MULTI_HUNK_DIFF,
    });

    expect(enrichedFile.isPartial).toBe(false);
    expect(enrichedFile.deletionLines).toHaveLength(10);
    expect(enrichedFile.additionLines).toHaveLength(10);
    expect(enrichedFile.deletionLines[7]).toBe("line 8\n");
    expect(enrichedFile.additionLines[7]).toBe("line eight\n");

    const firstHunk = enrichedFile.hunks[0];
    const secondHunk = enrichedFile.hunks[1];
    expect(firstHunk).toBeDefined();
    expect(secondHunk).toBeDefined();
    if (!firstHunk || !secondHunk) {
      throw new Error("expected two hunks");
    }

    expect(firstHunk.additionLineIndex).toBe(1);
    expect(firstHunk.deletionLineIndex).toBe(1);
    expect(secondHunk.additionLineIndex).toBe(7);
    expect(secondHunk.deletionLineIndex).toBe(7);
    expect(secondHunk.collapsedBefore).toBe(5);
  });
});
