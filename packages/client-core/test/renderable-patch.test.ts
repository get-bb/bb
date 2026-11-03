import type { TimelineFileChange } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { getRenderablePatchText } from "../src/diff/renderable-patch.js";

const createdFileContent = [
  "# Plan",
  "",
  "- first bullet",
  "+ plus bullet",
  "",
  "```python",
  "def main():",
  "    return 1",
  "```",
  "",
].join("\n");

function renderedHunk(change: TimelineFileChange): string[] {
  const rendered = getRenderablePatchText(change);
  if (rendered === null) {
    throw new Error("expected a renderable patch");
  }
  const lines = rendered.patch.trimEnd().split("\n");
  return lines.slice(lines.findIndex((line) => line.startsWith("@@")));
}

describe("renderable-patch", () => {
  it("renders every line of plain created-file content as an addition", () => {
    const change: TimelineFileChange = {
      path: "docs/plan.md",
      kind: "add",
      movePath: null,
      diff: createdFileContent,
      diffStats: { added: 0, removed: 0 },
    };

    expect(renderedHunk(change)).toEqual([
      "@@ -1,0 +1,9 @@",
      "+# Plan",
      "+",
      "+- first bullet",
      "++ plus bullet",
      "+",
      "+```python",
      "+def main():",
      "+    return 1",
      "+```",
    ]);
  });

  it("renders every line of plain deleted-file content as a removal", () => {
    const change: TimelineFileChange = {
      path: "docs/plan.md",
      kind: "delete",
      movePath: null,
      diff: createdFileContent,
      diffStats: { added: 0, removed: 0 },
    };

    expect(renderedHunk(change)).toEqual([
      "@@ -1,9 +1,0 @@",
      "-# Plan",
      "-",
      "-- first bullet",
      "-+ plus bullet",
      "-",
      "-```python",
      "-def main():",
      "-    return 1",
      "-```",
    ]);
  });

  it("keeps patch-like lines inside plain created-file content", () => {
    const change: TimelineFileChange = {
      path: "docs/guide.md",
      kind: "add",
      movePath: null,
      diff: "# Guide\n- bullet\n--- not a header\n+++ nor this\n@@ marker @@\nindex of terms\n",
      diffStats: { added: 0, removed: 0 },
    };

    expect(renderedHunk(change)).toEqual([
      "@@ -1,0 +1,6 @@",
      "+# Guide",
      "+- bullet",
      "+--- not a header",
      "++++ nor this",
      "+@@ marker @@",
      "+index of terms",
    ]);
  });

  it("keeps the additions of a created-file patch that carries headers", () => {
    const change: TimelineFileChange = {
      path: "docs/plan.md",
      kind: "add",
      movePath: null,
      diff: "--- /dev/null\n+++ b/docs/plan.md\n+- first bullet\n+    indented\n",
      diffStats: { added: 0, removed: 0 },
    };

    expect(renderedHunk(change)).toEqual([
      "@@ -1,0 +1,2 @@",
      "+- first bullet",
      "+    indented",
    ]);
  });
});
