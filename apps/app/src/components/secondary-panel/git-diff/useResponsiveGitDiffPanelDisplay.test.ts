import { describe, expect, it } from "vitest";
import {
  resolveGitDiffDisplayMode,
  resolveGitDiffDisplayModeChangeTarget,
  resolveIsWideEnoughForSplit,
} from "./useResponsiveGitDiffPanelDisplay";

const NARROW_WIDTH_PX = 500;
const WIDE_WIDTH_PX = 900;

describe("resolveGitDiffDisplayMode", () => {
  it("resolves display mode from viewport, preference, and width", () => {
    const resolve = (
      isCompactViewport: boolean,
      compactDisplayMode: "unified" | "split" | null,
      displayModePreference: "unified" | "split" | null,
      isWideEnoughForSplit: boolean | null,
    ) =>
      resolveGitDiffDisplayMode({
        isCompactViewport,
        compactDisplayMode,
        displayModePreference,
        isWideEnoughForSplit,
      });

    expect(resolve(true, null, "split", true)).toBe("unified");
    expect(resolve(true, "split", "unified", false)).toBe("split");
    expect(resolve(true, "unified", "split", true)).toBe("unified");

    expect(resolve(false, null, null, null)).toBe("unified");
    expect(resolve(false, null, null, false)).toBe("unified");
    expect(resolve(false, null, null, true)).toBe("split");
    expect(resolve(false, "split", null, false)).toBe("unified");
    expect(resolve(false, null, "split", false)).toBe("split");
    expect(resolve(false, null, "unified", true)).toBe("unified");
  });
});

describe("resolveIsWideEnoughForSplit", () => {
  it.each([
    {
      name: "follows the width of an open panel",
      input: {
        isSecondaryPanelOpen: true,
        nextWidth: WIDE_WIDTH_PX,
      },
      expected: true,
    },
    {
      name: "drops back below the breakpoint",
      input: {
        isSecondaryPanelOpen: true,
        nextWidth: NARROW_WIDTH_PX,
      },
      expected: false,
    },
    {
      name: "ignores width changes while the panel is closed",
      input: {
        isSecondaryPanelOpen: false,
        nextWidth: WIDE_WIDTH_PX,
      },
      expected: null,
    },
    {
      name: "ignores an unmeasured width",
      input: {
        isSecondaryPanelOpen: true,
        nextWidth: undefined,
      },
      expected: null,
    },
  ])("$name", ({ input, expected }) => {
    expect(resolveIsWideEnoughForSplit(input)).toBe(expected);
  });
});

describe("resolveGitDiffDisplayModeChangeTarget", () => {
  it("keeps a compact viewport toggle in the session and stores desktop choices", () => {
    expect(resolveGitDiffDisplayModeChangeTarget(true)).toBe("compact-session");
    expect(resolveGitDiffDisplayModeChangeTarget(false)).toBe(
      "stored-preference",
    );
  });
});
