// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useResponsiveGitDiffPanelDisplay } from "./useResponsiveGitDiffPanelDisplay";

afterEach(cleanup);

function renderPanelDisplay(isSecondaryPanelOpen = true) {
  return renderHook(
    (props: { isSecondaryPanelOpen: boolean }) =>
      useResponsiveGitDiffPanelDisplay(props),
    { initialProps: { isSecondaryPanelOpen } },
  );
}

it("derives the display mode from the panel width until the user picks one", () => {
  const { result } = renderPanelDisplay();

  act(() => result.current.handleSecondaryPanelWidthChange(900));
  expect(result.current.gitDiffDisplayMode).toBe("split");

  act(() => result.current.handleSecondaryPanelWidthChange(500));
  expect(result.current.gitDiffDisplayMode).toBe("unified");
});

it("keeps an explicit mode while the panel is resized within the same breakpoint", () => {
  const { result } = renderPanelDisplay();

  act(() => result.current.handleSecondaryPanelWidthChange(900));
  act(() => result.current.handleGitDiffDisplayModeChange("unified"));

  act(() => result.current.handleSecondaryPanelWidthChange(880));
  act(() => result.current.handleSecondaryPanelWidthChange(940));

  expect(result.current.gitDiffDisplayMode).toBe("unified");
});

it("keeps an explicit mode when a resize crosses the split-view breakpoint", () => {
  const { result } = renderPanelDisplay();

  act(() => result.current.handleSecondaryPanelWidthChange(500));
  act(() => result.current.handleGitDiffDisplayModeChange("split"));

  act(() => result.current.handleSecondaryPanelWidthChange(900));
  act(() => result.current.handleSecondaryPanelWidthChange(400));

  expect(result.current.gitDiffDisplayMode).toBe("split");
});

it("keeps an explicit mode across closing and reopening the panel", () => {
  const { result, rerender } = renderPanelDisplay();

  act(() => result.current.handleSecondaryPanelWidthChange(900));
  act(() => result.current.handleGitDiffDisplayModeChange("unified"));

  rerender({ isSecondaryPanelOpen: false });
  act(() => result.current.handleSecondaryPanelWidthChange(900));
  rerender({ isSecondaryPanelOpen: true });
  act(() => result.current.handleSecondaryPanelWidthChange(900));

  expect(result.current.gitDiffDisplayMode).toBe("unified");
});

it("ignores width changes reported while the panel is closed", () => {
  const { result } = renderPanelDisplay(false);

  act(() => result.current.handleSecondaryPanelWidthChange(900));

  expect(result.current.gitDiffDisplayMode).toBe("unified");
});
