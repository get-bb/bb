// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { readPaletteVisits } from "@/lib/command-palette/palette-visits";
import { usePaletteVisitRecorder } from "./usePaletteVisitRecorder";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("usePaletteVisitRecorder", () => {
  it("records each route change to a thread and nothing for re-renders or non-thread routes", () => {
    const { rerender } = renderHook<void, { threadId: string | null }>(
      ({ threadId }) => usePaletteVisitRecorder(threadId),
      { initialProps: { threadId: null } },
    );
    expect(readPaletteVisits()).toEqual([]);

    rerender({ threadId: "a" });
    const firstVisit = readPaletteVisits()[0]?.visitedAt;
    rerender({ threadId: "a" });
    expect(readPaletteVisits()).toEqual([
      { kind: "thread", id: "a", visitedAt: firstVisit },
    ]);

    rerender({ threadId: "b" });
    rerender({ threadId: null });
    expect(readPaletteVisits().map((visit) => visit.id)).toEqual(["b", "a"]);

    rerender({ threadId: "a" });
    expect(readPaletteVisits().map((visit) => visit.id)).toEqual(["a", "b"]);
  });
});
