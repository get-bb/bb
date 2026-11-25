import { describe, expect, it } from "vitest";
import {
  assertGrokRewindExecuted,
  buildGrokRewindExecuteParams,
  decodeGrokRewindExecuteResult,
  decodeGrokRewindPoints,
  selectGrokRewindPoint,
} from "./grok-rewind.js";

function point(promptIndex: number, preview = `Prompt ${promptIndex}`) {
  return {
    prompt_index: promptIndex,
    created_at: "2026-11-24T21:00:40.206740+00:00",
    num_file_snapshots: promptIndex === 0 ? 0 : 1,
    prompt_preview: preview,
    has_file_changes: promptIndex !== 0,
  };
}

function executeResult(targetPromptIndex = 1) {
  return {
    success: true,
    target_prompt_index: targetPromptIndex,
    mode: "all",
    reverted_files: ["rewind-probe.txt"],
    clean_files: [],
    conflicts: [],
    prompt_text: "Change rewind-probe.txt",
    error: null,
  };
}

describe("Grok rewind protocol", () => {
  it("decodes points with exact indices, Unicode previews, and future fields", () => {
    const points = decodeGrokRewindPoints({
      rewind_points: [
        { ...point(4, "Отменить 😀"), future: { tolerated: true } },
        point(1),
      ],
    });

    expect(points.map((entry) => entry.prompt_index)).toEqual([4, 1]);
    expect(points[0]?.prompt_preview).toBe("Отменить 😀");
    expect(points[0]).toMatchObject({ future: { tolerated: true } });
    expect(selectGrokRewindPoint(points, "1")).toMatchObject(point(1));
  });

  it("accepts empty history and rejects duplicate indices", () => {
    expect(decodeGrokRewindPoints({ rewind_points: [] })).toEqual([]);
    expect(() =>
      decodeGrokRewindPoints({ rewind_points: [point(2), point(2)] }),
    ).toThrow(/duplicate/i);
  });

  it("rejects malformed points and ambiguous checkpoint IDs", () => {
    expect(() =>
      decodeGrokRewindPoints({ rewind_points: [point(-1)] }),
    ).toThrow(/prompt_index/);
    expect(() => selectGrokRewindPoint([point(1)], "01")).toThrow(/invalid/i);
    expect(() => selectGrokRewindPoint([point(1)], "2")).toThrow(/not found/i);
    expect(() => selectGrokRewindPoint([point(1)], "1.5")).toThrow(/invalid/i);
  });

  it("builds exact all-mode execute params", () => {
    expect(
      buildGrokRewindExecuteParams({
        sessionId: "session-1",
        checkpointId: "7",
      }),
    ).toEqual({
      sessionId: "session-1",
      targetPromptIndex: 7,
      mode: "all",
      force: true,
    });
  });

  it("accepts an exact successful result", () => {
    const result = decodeGrokRewindExecuteResult(executeResult());
    expect(() => assertGrokRewindExecuted(result, "1")).not.toThrow();
  });

  it("fails closed for upstream failure, errors, conflicts, and stale targets", () => {
    for (const result of [
      { ...executeResult(), success: false, error: "unavailable" },
      { ...executeResult(), error: "failed" },
      {
        ...executeResult(),
        conflicts: [{ conflict_type: "modified_externally" }],
      },
      executeResult(0),
    ]) {
      expect(() =>
        assertGrokRewindExecuted(decodeGrokRewindExecuteResult(result), "1"),
      ).toThrow(/rewind|conflict|target|failed|unavailable/i);
    }
  });

  it("rejects malformed execution responses", () => {
    expect(() =>
      decodeGrokRewindExecuteResult({ ...executeResult(), success: "yes" }),
    ).toThrow(/success/);
    expect(() =>
      decodeGrokRewindExecuteResult({
        ...executeResult(),
        target_prompt_index: -1,
      }),
    ).toThrow(/target_prompt_index/);
  });
});
