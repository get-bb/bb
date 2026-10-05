// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { readPaletteThreadVisits } from "@/lib/command-palette/palette-visits";
import { usePaletteVisitRecorder } from "./usePaletteVisitRecorder";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("usePaletteVisitRecorder", () => {
  it("records each route change to a thread and nothing for non-thread routes", () => {
    const { rerender } = renderHook<void, { threadId: string | null }>(
      ({ threadId }) => usePaletteVisitRecorder(threadId),
      { initialProps: { threadId: null } },
    );
    expect(readPaletteThreadVisits()).toEqual([]);

    rerender({ threadId: "a" });
    rerender({ threadId: "b" });
    rerender({ threadId: null });
    expect(readPaletteThreadVisits()).toEqual(["b", "a"]);

    rerender({ threadId: "a" });
    expect(readPaletteThreadVisits()).toEqual(["a", "b"]);
  });
});
