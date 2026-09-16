import { describe, expect, it } from "vitest";
import { parseTypstMdPanelTarget } from "./panel-target";

describe("parseTypstMdPanelTarget", () => {
  it("defaults the source to the thread workspace", () => {
    expect(
      parseTypstMdPanelTarget({
        threadId: "thr_1",
        params: { file: "reports/report.md" },
      }),
    ).toEqual({
      file: "reports/report.md",
      source: { kind: "thread-workspace", threadId: "thr_1" },
    });
  });

  it("accepts thread storage and trims the file", () => {
    expect(
      parseTypstMdPanelTarget({
        threadId: "thr_1",
        params: { file: " reports/result.md ", source: "thread-storage" },
      }),
    ).toEqual({
      file: "reports/result.md",
      source: { kind: "thread-storage", threadId: "thr_1" },
    });
  });

  it("rejects malformed params", () => {
    const cases: unknown[] = [
      null,
      "reports/report.md",
      ["reports/report.md"],
      {},
      { file: "" },
      { file: "   " },
      { file: 42 },
      { file: "reports/report.md", source: "project" },
    ];
    for (const params of cases) {
      expect(
        parseTypstMdPanelTarget({ threadId: "thr_1", params }),
      ).toBeNull();
    }
  });
});
