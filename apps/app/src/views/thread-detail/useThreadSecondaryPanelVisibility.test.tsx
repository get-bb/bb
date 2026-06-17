// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useThreadSecondaryPanelVisibility,
  type UseThreadSecondaryPanelVisibilityArgs,
} from "./useThreadSecondaryPanelVisibility";

function createArgs(
  overrides: Partial<UseThreadSecondaryPanelVisibilityArgs> = {},
): UseThreadSecondaryPanelVisibilityArgs {
  return {
    closePersistedPanel: vi.fn(),
    isCompactViewport: true,
    isPersistedOpen: true,
    openPersistedCommitDiff: vi.fn(),
    openPersistedDiffFile: vi.fn(),
    openPersistedDiffPanel: vi.fn(),
    openPersistedHostFile: vi.fn(),
    openPersistedPanel: vi.fn(),
    openPersistedStorageFile: vi.fn(),
    openPersistedWorkspaceFile: vi.fn(),
    surface: "page",
    threadId: "thr_1",
    togglePersistedPanel: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useThreadSecondaryPanelVisibility", () => {
  it("keeps persisted compact panels closed until an interaction reveals the drawer", () => {
    const args = createArgs({
      isCompactViewport: true,
      isPersistedOpen: true,
    });
    const { result } = renderHook(() =>
      useThreadSecondaryPanelVisibility(args),
    );

    expect(result.current.isOpen).toBe(false);

    act(() => {
      result.current.openCompactDrawer();
    });

    expect(result.current.isOpen).toBe(true);
  });

  it("opens the compact drawer after persisted panel actions", () => {
    const args = createArgs({
      isCompactViewport: true,
      isPersistedOpen: false,
    });
    const { result } = renderHook(() =>
      useThreadSecondaryPanelVisibility(args),
    );

    act(() => {
      result.current.openHostFile({
        lineRange: null,
        path: "/tmp/log.txt",
      });
    });

    expect(args.openPersistedHostFile).toHaveBeenCalledWith({
      lineRange: null,
      path: "/tmp/log.txt",
    });
    expect(result.current.isOpen).toBe(true);
  });

  it("does not reveal a compact drawer for popout surfaces", () => {
    const args = createArgs({
      isCompactViewport: true,
      isPersistedOpen: true,
      surface: "popout",
    });
    const { result } = renderHook(() =>
      useThreadSecondaryPanelVisibility(args),
    );

    act(() => {
      result.current.openCompactDrawer();
    });

    expect(result.current.isOpen).toBe(false);
  });
});
