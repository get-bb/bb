// @vitest-environment jsdom

import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it } from "vitest";
import {
  GIT_DIFF_DISPLAY_MODE_STORAGE_KEY,
  GIT_DIFF_LINE_OVERFLOW_MODE_STORAGE_KEY,
  useGitDiffLineOverflowModePreference,
} from "@/lib/git-diff-view-preferences";
import {
  resolveGitDiffDisplayMode,
  useResponsiveGitDiffPanelDisplay,
} from "./useResponsiveGitDiffPanelDisplay";

const NARROW_WIDTH_PX = 500;
const WIDE_WIDTH_PX = 900;

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function renderDisplay() {
  return renderHook(() =>
    useResponsiveGitDiffPanelDisplay({ isSecondaryPanelOpen: true }),
  );
}

function renderCompactDisplay() {
  return renderHook(
    () => useResponsiveGitDiffPanelDisplay({ isSecondaryPanelOpen: true }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <CompactViewportOverrideProvider isCompactViewport>
          {children}
        </CompactViewportOverrideProvider>
      ),
    },
  );
}

it("follows panel width while no explicit preference is stored", () => {
  const { result } = renderDisplay();

  act(() => {
    result.current.handleSecondaryPanelWidthChange(WIDE_WIDTH_PX);
  });
  expect(result.current.gitDiffDisplayMode).toBe("split");

  act(() => {
    result.current.handleSecondaryPanelWidthChange(NARROW_WIDTH_PX);
  });
  expect(result.current.gitDiffDisplayMode).toBe("unified");

  expect(
    window.localStorage.getItem(GIT_DIFF_DISPLAY_MODE_STORAGE_KEY),
  ).toBeNull();
});

it("honors an explicit choice at any panel width", () => {
  const { result } = renderDisplay();

  act(() => {
    result.current.handleSecondaryPanelWidthChange(WIDE_WIDTH_PX);
  });
  act(() => {
    result.current.handleGitDiffDisplayModeChange("unified");
  });
  act(() => {
    result.current.handleSecondaryPanelWidthChange(NARROW_WIDTH_PX);
  });
  act(() => {
    result.current.handleSecondaryPanelWidthChange(WIDE_WIDTH_PX);
  });

  expect(result.current.gitDiffDisplayMode).toBe("unified");
});

it("keeps a stored split choice on a panel narrower than the breakpoint", () => {
  const { result } = renderDisplay();

  act(() => {
    result.current.handleSecondaryPanelWidthChange(WIDE_WIDTH_PX);
  });
  act(() => {
    result.current.handleGitDiffDisplayModeChange("split");
  });
  act(() => {
    result.current.handleSecondaryPanelWidthChange(NARROW_WIDTH_PX);
  });

  expect(result.current.gitDiffDisplayMode).toBe("split");
});

it("restores the stored display mode on a fresh mount", () => {
  const first = renderDisplay();
  act(() => {
    first.result.current.handleSecondaryPanelWidthChange(NARROW_WIDTH_PX);
  });
  act(() => {
    first.result.current.handleGitDiffDisplayModeChange("split");
  });
  cleanup();

  const { result } = renderDisplay();
  expect(result.current.gitDiffDisplayMode).toBe("split");
});

it("ignores an unrecognized stored display mode", () => {
  window.localStorage.setItem(GIT_DIFF_DISPLAY_MODE_STORAGE_KEY, "sideways");

  const { result } = renderDisplay();
  act(() => {
    result.current.handleSecondaryPanelWidthChange(WIDE_WIDTH_PX);
  });

  expect(result.current.gitDiffDisplayMode).toBe("split");
});

it("does not track width changes while the panel is closed", () => {
  const { result } = renderHook(() =>
    useResponsiveGitDiffPanelDisplay({ isSecondaryPanelOpen: false }),
  );

  act(() => {
    result.current.handleSecondaryPanelWidthChange(WIDE_WIDTH_PX);
  });

  expect(result.current.gitDiffDisplayMode).toBe("unified");
});

it("defaults a compact viewport to unified even with split stored", () => {
  window.localStorage.setItem(GIT_DIFF_DISPLAY_MODE_STORAGE_KEY, "split");

  const { result } = renderCompactDisplay();

  expect(result.current.gitDiffDisplayMode).toBe("unified");
});

it("lets a compact viewport toggle to split", () => {
  const { result } = renderCompactDisplay();

  act(() => {
    result.current.handleGitDiffDisplayModeChange("split");
  });

  expect(result.current.gitDiffDisplayMode).toBe("split");
});

it("does not persist a compact viewport toggle", () => {
  const first = renderCompactDisplay();
  act(() => {
    first.result.current.handleGitDiffDisplayModeChange("split");
  });
  expect(
    window.localStorage.getItem(GIT_DIFF_DISPLAY_MODE_STORAGE_KEY),
  ).toBeNull();
  cleanup();

  const { result } = renderCompactDisplay();
  expect(result.current.gitDiffDisplayMode).toBe("unified");
});

it("leaves an existing stored preference untouched when toggling on compact", () => {
  window.localStorage.setItem(GIT_DIFF_DISPLAY_MODE_STORAGE_KEY, "split");

  const compact = renderCompactDisplay();
  act(() => {
    compact.result.current.handleGitDiffDisplayModeChange("unified");
  });
  cleanup();

  expect(window.localStorage.getItem(GIT_DIFF_DISPLAY_MODE_STORAGE_KEY)).toBe(
    "split",
  );

  const { result } = renderDisplay();
  expect(result.current.gitDiffDisplayMode).toBe("split");
});

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

it("restores the stored line overflow mode on a fresh mount", () => {
  const first = renderHook(() => useGitDiffLineOverflowModePreference());
  act(() => {
    first.result.current[1]("wrap");
  });
  expect(
    window.localStorage.getItem(GIT_DIFF_LINE_OVERFLOW_MODE_STORAGE_KEY),
  ).toBe("wrap");
  cleanup();

  const { result } = renderHook(() => useGitDiffLineOverflowModePreference());
  expect(result.current[0]).toBe("wrap");
});

it("falls back to scroll for an unrecognized stored line overflow mode", () => {
  window.localStorage.setItem(GIT_DIFF_LINE_OVERFLOW_MODE_STORAGE_KEY, "fold");

  const { result } = renderHook(() => useGitDiffLineOverflowModePreference());
  expect(result.current[0]).toBe("scroll");
});
