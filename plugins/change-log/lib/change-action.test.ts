import { describe, expect, it } from "vitest";
import { getFileChangeAction } from "../shared/change-action.js";

describe("getFileChangeAction", () => {
  it("treats an add kind as created", () => {
    expect(
      getFileChangeAction({ kind: "add", movePath: null, diff: "+a\n" }),
    ).toBe("created");
  });

  it("treats a delete kind as deleted", () => {
    expect(
      getFileChangeAction({ kind: "delete", movePath: null, diff: "-a\n" }),
    ).toBe("deleted");
  });

  it("treats an update kind as edited", () => {
    expect(
      getFileChangeAction({ kind: "update", movePath: null, diff: "-a\n+b\n" }),
    ).toBe("edited");
  });

  it("treats a move without substantive changes as renamed", () => {
    expect(
      getFileChangeAction({
        kind: "update",
        movePath: "src/new.ts",
        diff: "@@ -1 +1 @@\n",
      }),
    ).toBe("renamed");
  });

  it("treats a move with substantive changes as edited", () => {
    expect(
      getFileChangeAction({
        kind: "update",
        movePath: "src/new.ts",
        diff: "@@ -1 +1 @@\n-old\n+new\n",
      }),
    ).toBe("edited");
  });

  it("ignores diff header lines when looking for substantive changes", () => {
    expect(
      getFileChangeAction({
        kind: "update",
        movePath: "src/new.ts",
        diff: "--- a/src/old.ts\n+++ b/src/new.ts\n@@ -1 +1 @@\n",
      }),
    ).toBe("renamed");
  });

  it("falls back to edited for an unknown kind without a diff", () => {
    expect(
      getFileChangeAction({ kind: null, movePath: null, diff: null }),
    ).toBe("edited");
  });

  it("matches create and remove style kinds regardless of separators", () => {
    expect(
      getFileChangeAction({ kind: "file-created", movePath: null, diff: null }),
    ).toBe("created");
    expect(
      getFileChangeAction({ kind: "file_removed", movePath: null, diff: null }),
    ).toBe("deleted");
  });
});
