import { describe, expect, it } from "vitest";
import { parseTypstPanelTarget } from "./panel-target";

describe("parseTypstPanelTarget", () => {
  it("defaults the source to the thread workspace", () => {
    expect(
      parseTypstPanelTarget({
        threadId: "thr_1",
        params: { file: "reports/report.typ" },
      }),
    ).toEqual({
      file: "reports/report.typ",
      source: { kind: "thread-workspace", threadId: "thr_1" },
    });
  });

  it("accepts thread storage and trims the file", () => {
    expect(
      parseTypstPanelTarget({
        threadId: "thr_1",
        params: { file: " reports/result.typ ", source: "thread-storage" },
      }),
    ).toEqual({
      file: "reports/result.typ",
      source: { kind: "thread-storage", threadId: "thr_1" },
    });
  });

  it("rejects malformed params", () => {
    const cases: unknown[] = [
      null,
      "reports/report.typ",
      ["reports/report.typ"],
      {},
      { file: "" },
      { file: "   " },
      { file: 42 },
      { file: "reports/report.typ", source: "project" },
    ];
    for (const params of cases) {
      expect(parseTypstPanelTarget({ threadId: "thr_1", params })).toBeNull();
    }
  });
});
