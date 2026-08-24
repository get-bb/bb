import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "@/diff/parse-unified-diff";
import {
  buildDiffAddToChatText,
  buildDiffPathAddToChatText,
} from "./add-to-chat";

const PATCH = [
  "diff --git a/src/app.ts b/src/app.ts",
  "index 1111111..2222222 100644",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,3 +1,4 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+const c = 4;",
  " export { a, b };",
  "@@ -10,2 +11,2 @@ function tail() {",
  "-  return 1;",
  "+  return 2;",
  " }",
  "",
].join("\n");

describe("buildDiffAddToChatText", () => {
  it("rebuilds a unified patch for the whole file", () => {
    const file = parseUnifiedDiff(PATCH).files[0]!;
    expect(buildDiffAddToChatText(file)).toBe(
      [
        "diff --git a/src/app.ts b/src/app.ts",
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -1,3 +1,4 @@",
        " const a = 1;",
        "-const b = 2;",
        "+const b = 3;",
        "+const c = 4;",
        " export { a, b };",
        "@@ -10,2 +11,2 @@ function tail() {",
        "-  return 1;",
        "+  return 2;",
        " }",
      ].join("\n"),
    );
  });

  it("narrows to one hunk and strips the workspace root", () => {
    const file = parseUnifiedDiff(
      PATCH.replaceAll("src/app.ts", "Users/dev/repo/src/app.ts"),
    ).files[0]!;
    const text = buildDiffAddToChatText(file, {
      hunkIndex: 1,
      workspaceRootPath: "Users/dev/repo/",
    });
    expect(text.split("\n")).toEqual([
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -10,2 +11,2 @@ function tail() {",
      "-  return 1;",
      "+  return 2;",
      " }",
    ]);
  });

  it("uses /dev/null for added and deleted files and marks binaries", () => {
    const added = parseUnifiedDiff(
      [
        "diff --git a/new.txt b/new.txt",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/new.txt",
        "@@ -0,0 +1 @@",
        "+hello",
        "",
      ].join("\n"),
    ).files[0]!;
    expect(buildDiffAddToChatText(added).split("\n").slice(0, 3)).toEqual([
      "diff --git a/new.txt b/new.txt",
      "--- /dev/null",
      "+++ b/new.txt",
    ]);
    const deleted = parseUnifiedDiff(
      [
        "diff --git a/old.txt b/old.txt",
        "deleted file mode 100644",
        "--- a/old.txt",
        "+++ /dev/null",
        "@@ -1 +0,0 @@",
        "-bye",
        "",
      ].join("\n"),
    ).files[0]!;
    expect(buildDiffAddToChatText(deleted).split("\n")[2]).toBe(
      "+++ /dev/null",
    );
    const binary = parseUnifiedDiff(
      [
        "diff --git a/logo.png b/logo.png",
        "Binary files a/logo.png and b/logo.png differ",
        "",
      ].join("\n"),
    ).files[0]!;
    expect(buildDiffAddToChatText(binary)).toBe(
      [
        "diff --git a/logo.png b/logo.png",
        "--- a/logo.png",
        "+++ b/logo.png",
        "Binary files a/logo.png and b/logo.png differ",
      ].join("\n"),
    );
  });

  it("quotes just the path for a file without a loaded patch", () => {
    expect(
      buildDiffPathAddToChatText("/Users/dev/repo/src/a.ts", "/Users/dev/repo"),
    ).toBe("src/a.ts");
    expect(buildDiffPathAddToChatText("src/a.ts", null)).toBe("src/a.ts");
  });
});
