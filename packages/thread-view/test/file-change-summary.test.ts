import { describe, expect, it } from "vitest";
import {
  getFileChangeDiffStats,
  isPatchMetadataLine,
} from "../src/file-change-summary.js";

describe("file-change-summary", () => {
  it("recognizes patch metadata lines without treating content as metadata", () => {
    expect(isPatchMetadataLine("diff --git a/src/app.ts b/src/app.ts")).toBe(
      true,
    );
    expect(isPatchMetadataLine("index 1111111..2222222 100644")).toBe(true);
    expect(isPatchMetadataLine("--- a/src/app.ts")).toBe(true);
    expect(isPatchMetadataLine("+++ b/src/app.ts")).toBe(true);
    expect(isPatchMetadataLine("@@ -1 +1 @@")).toBe(true);
    expect(isPatchMetadataLine("+actual content")).toBe(false);
    expect(isPatchMetadataLine("-actual content")).toBe(false);
    expect(isPatchMetadataLine(" context content")).toBe(false);
  });

  it("treats CRLF metadata and no-newline markers as metadata", () => {
    expect(isPatchMetadataLine("@@ -1 +1 @@\r")).toBe(true);
    expect(isPatchMetadataLine("\\ No newline at end of file\r")).toBe(true);
  });

  it("ignores patch metadata when counting plain created-file content", () => {
    expect(
      getFileChangeDiffStats({
        path: "src/app.ts",
        kind: "create",
        diff: [
          "diff --git a/src/app.ts b/src/app.ts\r",
          "new file mode 100644\r",
          "--- /dev/null\r",
          "+++ b/src/app.ts\r",
          "@@ -0,0 +1,2 @@\r",
          "first line\r",
          "second line\r",
          "\\ No newline at end of file\r",
          "",
        ].join("\n"),
      }),
    ).toEqual({
      added: 2,
      removed: 0,
    });
  });

  it("counts plain created Markdown content with bullets as additions", () => {
    expect(
      getFileChangeDiffStats({
        path: "plans/fund-toolkit-rearchitecture.md",
        kind: "add",
        diff: [
          "# Fund Toolkit Rearchitecture Plan",
          "",
          "## Core Boundary",
          "",
          "- durable fund memory",
          "- work records",
          "- run records",
          "+ plus bullet",
          "    indented code",
          "",
        ].join("\n"),
      }),
    ).toEqual({
      added: 9,
      removed: 0,
    });
  });

  it("counts plain deleted Markdown content with bullets as removals", () => {
    expect(
      getFileChangeDiffStats({
        path: "plans/fund-toolkit-rearchitecture.md",
        kind: "delete",
        diff: [
          "# Fund Toolkit Rearchitecture Plan",
          "",
          "## Core Boundary",
          "",
          "- durable fund memory",
          "- work records",
          "- run records",
          "+ plus bullet",
          "    indented code",
          "",
        ].join("\n"),
      }),
    ).toEqual({
      added: 0,
      removed: 9,
    });
  });
});
