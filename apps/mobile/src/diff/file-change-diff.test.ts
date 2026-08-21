import type { TimelineFileChange } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { buildFileChangeDiffView, displayDiffPath } from "./file-change-diff";

function change(
  overrides: Partial<TimelineFileChange> & Pick<TimelineFileChange, "diff">,
): TimelineFileChange {
  return {
    path: "src/index.ts",
    kind: "modify",
    movePath: null,
    diffStats: { added: 0, removed: 0 },
    ...overrides,
  };
}

describe("buildFileChangeDiffView", () => {
  it("renders a full git patch with line numbers", () => {
    const view = buildFileChangeDiffView(
      change({
        diff: `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,2 +1,2 @@
-a
+b
 c
`,
      }),
    );
    expect(view.kind).toBe("diff");
    if (view.kind !== "diff") throw new Error("unreachable");
    expect(view.showLineNumbers).toBe(true);
    expect(view.file.path).toBe("src/index.ts");
    expect(view.file.changeKind).toBe("modified");
    expect(view.file.hunks[0]!.lines).toHaveLength(3);
  });

  it("wraps bare hunks in headers and keeps line numbers", () => {
    const view = buildFileChangeDiffView(
      change({ diff: "@@ -10,2 +10,2 @@\n-old\n+new\n context\n" }),
    );
    expect(view).toMatchObject({ kind: "diff", showLineNumbers: true });
    if (view.kind !== "diff") throw new Error("unreachable");
    expect(view.file.path).toBe("src/index.ts");
    expect(view.file.hunks[0]!.lines[0]).toEqual({
      type: "del",
      oldNo: 10,
      text: "old",
    });
  });

  it("synthesizes created/deleted files from content lines without line numbers", () => {
    const created = buildFileChangeDiffView(
      change({ path: "notes.md", kind: "create", diff: "# Title\n\nbody\n" }),
    );
    expect(created).toMatchObject({ kind: "diff", showLineNumbers: false });
    if (created.kind !== "diff") throw new Error("unreachable");
    expect(created.file.changeKind).toBe("added");
    expect(created.file.path).toBe("notes.md");
    expect(created.file.hunks[0]!.lines.map((line) => line.text)).toEqual([
      "# Title",
      "",
      "body",
    ]);
    expect(created.file.stats).toEqual({ additions: 3, deletions: 0 });

    const deleted = buildFileChangeDiffView(
      change({ path: "/abs/old.txt", kind: "delete", diff: "-gone\n" }),
    );
    expect(deleted).toMatchObject({ kind: "diff", showLineNumbers: false });
    if (deleted.kind !== "diff") throw new Error("unreachable");
    expect(deleted.file.changeKind).toBe("deleted");
    expect(deleted.file.path).toBe("abs/old.txt");
    expect(deleted.file.hunks[0]!.lines).toEqual([
      { type: "del", oldNo: 1, text: "gone" },
    ]);
  });

  it("falls back to plain text when the diff is not a patch", () => {
    const view = buildFileChangeDiffView(
      change({ diff: "Wrote 3 lines to src/index.ts\n\n" }),
    );
    expect(view).toEqual({
      kind: "plain",
      text: "Wrote 3 lines to src/index.ts",
    });
  });

  it("reports nothing renderable for an empty diff", () => {
    expect(buildFileChangeDiffView(change({ diff: null }))).toEqual({
      kind: "none",
    });
    expect(buildFileChangeDiffView(change({ diff: "   \n" }))).toEqual({
      kind: "none",
    });
  });

  it("caches per change object", () => {
    const input = change({ diff: "@@ -1 +1 @@\n-a\n+b\n" });
    expect(buildFileChangeDiffView(input)).toBe(buildFileChangeDiffView(input));
  });
});

describe("displayDiffPath", () => {
  it("strips the workspace root with or without a trailing slash", () => {
    expect(displayDiffPath("/repo/src/a.ts", "/repo")).toBe("src/a.ts");
    expect(displayDiffPath("/repo/src/a.ts", "/repo/")).toBe("src/a.ts");
    // client-core synthetic patches drop the leading slash.
    expect(displayDiffPath("repo/src/a.ts", "/repo")).toBe("src/a.ts");
    expect(displayDiffPath("/other/a.ts", "/repo")).toBe("/other/a.ts");
    expect(displayDiffPath("/repository/a.ts", "/repo")).toBe(
      "/repository/a.ts",
    );
    expect(displayDiffPath("src/a.ts", undefined)).toBe("src/a.ts");
    expect(displayDiffPath("src/a.ts", "/")).toBe("src/a.ts");
  });
});
