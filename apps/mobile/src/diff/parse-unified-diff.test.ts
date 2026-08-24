import { describe, expect, it } from "vitest";
import { parseUnifiedDiff, splitDiffLines } from "./parse-unified-diff";

const MODIFY_PATCH = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,4 +1,5 @@ import x
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 export { a, b };

@@ -20,3 +21,3 @@ function f() {
   return 1;
-  // old
+  // new
 }
`;

describe("parseUnifiedDiff", () => {
  it("parses a modified file with multiple hunks, line numbers, and stats", () => {
    const { files, stats } = parseUnifiedDiff(MODIFY_PATCH);
    expect(files).toHaveLength(1);
    const file = files[0]!;
    expect(file.path).toBe("src/app.ts");
    expect(file.previousPath).toBeNull();
    expect(file.changeKind).toBe("modified");
    expect(file.binary).toBe(false);
    expect(file.stats).toEqual({ additions: 3, deletions: 2 });
    expect(stats).toEqual({ additions: 3, deletions: 2, files: 1 });

    expect(file.hunks).toHaveLength(2);
    const [first, second] = file.hunks;
    expect(first!.header).toBe("@@ -1,4 +1,5 @@ import x");
    expect(first!.lines).toEqual([
      { type: "context", oldNo: 1, newNo: 1, text: "const a = 1;" },
      { type: "del", oldNo: 2, text: "const b = 2;" },
      { type: "add", newNo: 2, text: "const b = 3;" },
      { type: "add", newNo: 3, text: "const c = 4;" },
      { type: "context", oldNo: 3, newNo: 4, text: "export { a, b };" },
      { type: "context", oldNo: 4, newNo: 5, text: "" },
    ]);
    expect(second!.header).toBe("@@ -20,3 +21,3 @@ function f() {");
    expect(second!.oldStart).toBe(20);
    expect(second!.newStart).toBe(21);
    expect(second!.lines.map((line) => line.type)).toEqual([
      "context",
      "del",
      "add",
      "context",
    ]);
  });

  it("reads blank hunk lines whose leading space was stripped as context", () => {
    const patch = [
      "diff --git a/f.txt b/f.txt",
      "--- a/f.txt",
      "+++ b/f.txt",
      "@@ -1,3 +1,3 @@",
      " one",
      "",
      "-two",
      "+TWO",
      "@@ -10,2 +10,2 @@",
      " ten",
      "-eleven",
      "+ELEVEN",
    ].join("\n");
    const file = parseUnifiedDiff(patch).files[0]!;
    expect(file.hunks).toHaveLength(2);
    expect(file.hunks[0]!.lines).toEqual([
      { type: "context", oldNo: 1, newNo: 1, text: "one" },
      { type: "context", oldNo: 2, newNo: 2, text: "" },
      { type: "del", oldNo: 3, text: "two" },
      { type: "add", newNo: 3, text: "TWO" },
    ]);
    expect(file.hunks[1]!.lines).toHaveLength(3);
  });

  it("parses added and deleted files from git headers", () => {
    const patch = `diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+hello
+world
diff --git a/old.txt b/old.txt
deleted file mode 100644
index e69de29..0000000
--- a/old.txt
+++ /dev/null
@@ -1,1 +0,0 @@
-bye
`;
    const { files } = parseUnifiedDiff(patch);
    expect(files.map((f) => [f.path, f.changeKind])).toEqual([
      ["new.txt", "added"],
      ["old.txt", "deleted"],
    ]);
    expect(files[0]!.hunks[0]!.lines).toEqual([
      { type: "add", newNo: 1, text: "hello" },
      { type: "add", newNo: 2, text: "world" },
    ]);
    expect(files[1]!.hunks[0]!.lines).toEqual([
      { type: "del", oldNo: 1, text: "bye" },
    ]);
  });

  it("derives created/deleted from /dev/null when the mode headers are missing (client-core synthetic patches)", () => {
    const created = `diff --git a/a.txt b/a.txt
--- /dev/null
+++ b/a.txt
@@ -1,0 +1,1 @@
+x
`;
    const deleted = `diff --git a/b.txt b/b.txt
--- a/b.txt
+++ /dev/null
@@ -1,1 +1,0 @@
-y
`;
    expect(parseUnifiedDiff(created).files[0]).toMatchObject({
      path: "a.txt",
      changeKind: "added",
      stats: { additions: 1, deletions: 0 },
    });
    expect(parseUnifiedDiff(deleted).files[0]).toMatchObject({
      path: "b.txt",
      changeKind: "deleted",
      stats: { additions: 0, deletions: 1 },
    });
  });

  it("parses renames with and without content changes", () => {
    const pure = `diff --git a/old/name.ts b/new/name.ts
similarity index 100%
rename from old/name.ts
rename to new/name.ts
`;
    const changed = `diff --git a/old/name.ts b/new/name.ts
similarity index 90%
rename from old/name.ts
rename to new/name.ts
index 1111111..2222222 100644
--- a/old/name.ts
+++ b/new/name.ts
@@ -1,2 +1,2 @@
-a
+b
 c
`;
    expect(parseUnifiedDiff(pure).files[0]).toMatchObject({
      path: "new/name.ts",
      previousPath: "old/name.ts",
      changeKind: "renamed",
      hunks: [],
      stats: { additions: 0, deletions: 0 },
    });
    const renamed = parseUnifiedDiff(changed).files[0]!;
    expect(renamed).toMatchObject({
      path: "new/name.ts",
      previousPath: "old/name.ts",
      changeKind: "renamed",
      stats: { additions: 1, deletions: 1 },
    });
    expect(renamed.hunks).toHaveLength(1);
  });

  it("keeps the no-newline marker as a meta line", () => {
    const patch = `diff --git a/f b/f
--- a/f
+++ b/f
@@ -1 +1 @@
-old
\\ No newline at end of file
+new
\\ No newline at end of file
`;
    const lines = parseUnifiedDiff(patch).files[0]!.hunks[0]!.lines;
    expect(lines).toEqual([
      { type: "del", oldNo: 1, text: "old" },
      { type: "meta", text: "\\ No newline at end of file" },
      { type: "add", newNo: 1, text: "new" },
      { type: "meta", text: "\\ No newline at end of file" },
    ]);
  });

  it("marks binary files and keeps parsing the files after them", () => {
    const patch = `diff --git a/logo.png b/logo.png
new file mode 100644
index 0000000..1234567
Binary files /dev/null and b/logo.png differ
diff --git a/icon.png b/icon.png
index 1234567..89abcde 100644
GIT binary patch
literal 1234
zcmV;Cabcdefg
literal 0
HcmV?d00001

diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-# Old
+# New
`;
    const { files } = parseUnifiedDiff(patch);
    expect(files.map((f) => [f.path, f.changeKind, f.binary])).toEqual([
      ["logo.png", "added", true],
      ["icon.png", "modified", true],
      ["README.md", "modified", false],
    ]);
    expect(files[0]!.hunks).toEqual([]);
    expect(files[1]!.hunks).toEqual([]);
    expect(files[2]!.stats).toEqual({ additions: 1, deletions: 1 });
  });

  it("accepts patches without a diff --git header and splits bare files", () => {
    const patch = `--- a/one.txt
+++ b/one.txt
@@ -1 +1 @@
-1
+one
--- a/two.txt
+++ b/two.txt
@@ -1 +1 @@
-2
+two
`;
    const { files } = parseUnifiedDiff(patch);
    expect(files.map((f) => f.path)).toEqual(["one.txt", "two.txt"]);
    expect(files[1]!.hunks[0]!.lines).toEqual([
      { type: "del", oldNo: 1, text: "2" },
      { type: "add", newNo: 1, text: "two" },
    ]);
  });

  it("drops prose before the first file and files it cannot parse", () => {
    const patch = `Here is the change I made:

diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-a
+A
diff --git a/broken b/broken
this is not a patch
`;
    const { files } = parseUnifiedDiff(patch);
    expect(files.map((f) => f.path)).toEqual(["a.txt"]);
  });

  it("returns no files for plain text so callers fall back", () => {
    expect(parseUnifiedDiff("just some text\nwith lines").files).toEqual([]);
    expect(parseUnifiedDiff("").files).toEqual([]);
    expect(parseUnifiedDiff("+added\n-removed").files).toEqual([]);
  });

  it("reports copies and type changes", () => {
    const copy = `diff --git a/src/a.ts b/src/b.ts
similarity index 100%
copy from src/a.ts
copy to src/b.ts
`;
    const typeChange = `diff --git a/link b/link
old mode 100644
new mode 120000
--- a/link
+++ b/link
@@ -1 +1 @@
-content
+target
`;
    expect(parseUnifiedDiff(copy).files[0]).toMatchObject({
      path: "src/b.ts",
      previousPath: "src/a.ts",
      changeKind: "copied",
    });
    expect(parseUnifiedDiff(typeChange).files[0]).toMatchObject({
      path: "link",
      changeKind: "type_changed",
    });
  });

  it("normalizes CRLF and trailing newlines", () => {
    const crlf = MODIFY_PATCH.replaceAll("\n", "\r\n");
    expect(parseUnifiedDiff(crlf).files[0]!.stats).toEqual({
      additions: 3,
      deletions: 2,
    });
    expect(splitDiffLines("a\r\nb\n\n")).toEqual(["a", "b"]);
  });
});
