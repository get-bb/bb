// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { Provider as JotaiProvider, useAtomValue } from "jotai";
import { useCallback, type ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import {
  getThreadSecondaryPanelOpenAtom,
  getThreadSecondaryPanelOpenStorageKey,
} from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import {
  useFixedPanelTabsSecondaryPanelUrlSync,
  useFixedPanelTabsState,
} from "@/lib/fixed-panel-tabs";
import {
  createEmptyFixedPanelTabsState,
  getFixedPanelTabsStateStorageKey,
  serializeFixedPanelTabsState,
} from "@/lib/fixed-panel-tabs-state";
import type { ThreadSecondaryPanel } from "@/lib/thread-secondary-panel";
import {
  getActiveFixedSecondaryTab,
  getOpenFixedSecondaryTab,
  useSetThreadSecondaryPanelSelection,
  useToggleThreadSecondaryPanelSelection,
} from "./threadSecondaryPanelSelection";

const THREAD_ID = "thr_secondary_close";

interface TestWrapperProps {
  children: ReactNode;
}

interface SelectionHookProps {
  threadId: string;
}

interface CreateTestWrapperArgs {
  initialEntries?: string[];
}

function createTestWrapper(args: CreateTestWrapperArgs = {}) {
  const initialEntries = args.initialEntries ?? [
    `/projects/proj_test/threads/${THREAD_ID}`,
  ];
  function TestWrapper({ children }: TestWrapperProps) {
    return (
      <JotaiProvider>
        <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
      </JotaiProvider>
    );
  }
  return TestWrapper;
}

function useSelectionHarness({ threadId }: SelectionHookProps) {
  const fixedPanelTabsState = useFixedPanelTabsState(threadId);
  const isSecondaryPanelOpen = useAtomValue(
    getThreadSecondaryPanelOpenAtom(threadId),
  );
  const activeFixedSecondaryTab = getActiveFixedSecondaryTab({
    fixedPanelTabsState,
  });
  const openFixedSecondaryTab = getOpenFixedSecondaryTab({
    activeFixedSecondaryTab,
    isSecondaryPanelOpen,
  });
  const setThreadSecondaryPanel = useSetThreadSecondaryPanelSelection(threadId);
  const toggleThreadSecondaryPanel =
    useToggleThreadSecondaryPanelSelection(threadId);

  return {
    activeFixedSecondaryTab,
    fixedPanelTabsState,
    isSecondaryPanelOpen,
    openFixedSecondaryTab,
    setThreadSecondaryPanel,
    toggleThreadSecondaryPanel,
  };
}

function useUrlSyncHarness({ threadId }: SelectionHookProps) {
  const location = useLocation();
  const fixedPanelTabsState = useFixedPanelTabsState(threadId);
  const setThreadSecondaryPanel = useSetThreadSecondaryPanelSelection(threadId);
  const setSecondaryPanelFromUrl = useCallback(
    (panel: ThreadSecondaryPanel) => {
      setThreadSecondaryPanel(panel);
    },
    [setThreadSecondaryPanel],
  );

  useFixedPanelTabsSecondaryPanelUrlSync(threadId, setSecondaryPanelFromUrl);

  return {
    fixedPanelTabsState,
    location,
  };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("thread secondary panel selection", () => {
  it("closes without clearing the selected tab and reopens the previous tab", () => {
    const { result } = renderHook(
      (props: SelectionHookProps) => useSelectionHarness(props),
      {
        initialProps: { threadId: THREAD_ID },
        wrapper: createTestWrapper(),
      },
    );

    act(() => {
      result.current.setThreadSecondaryPanel("git-diff");
    });

    expect(result.current.activeFixedSecondaryTab).toEqual({
      id: "git-diff",
      kind: "git-diff",
    });
    expect(result.current.openFixedSecondaryTab).toEqual({
      id: "git-diff",
      kind: "git-diff",
    });
    expect(result.current.isSecondaryPanelOpen).toBe(true);
    expect(result.current.fixedPanelTabsState.secondary.isOpen).toBe(true);
    expect(result.current.fixedPanelTabsState.secondary.activeTabId).toBe(
      "git-diff",
    );
    expect(result.current.fixedPanelTabsState.secondary.tabs).toEqual([
      { id: "git-diff", kind: "git-diff" },
    ]);

    act(() => {
      result.current.setThreadSecondaryPanel(null);
    });

    expect(result.current.activeFixedSecondaryTab).toEqual({
      id: "git-diff",
      kind: "git-diff",
    });
    expect(result.current.openFixedSecondaryTab).toBeNull();
    expect(result.current.isSecondaryPanelOpen).toBe(false);
    expect(result.current.fixedPanelTabsState.secondary.isOpen).toBe(false);
    expect(result.current.fixedPanelTabsState.secondary.activeTabId).toBe(
      "git-diff",
    );
    expect(result.current.fixedPanelTabsState.secondary.tabs).toEqual([
      { id: "git-diff", kind: "git-diff" },
    ]);

    act(() => {
      result.current.toggleThreadSecondaryPanel();
    });

    expect(result.current.activeFixedSecondaryTab).toEqual({
      id: "git-diff",
      kind: "git-diff",
    });
    expect(result.current.openFixedSecondaryTab).toEqual({
      id: "git-diff",
      kind: "git-diff",
    });
    expect(result.current.isSecondaryPanelOpen).toBe(true);
    expect(result.current.fixedPanelTabsState.secondary.isOpen).toBe(true);
  });

  it("restores each thread's remembered panel-open state and hydrates it from storage", () => {
    const threadA = "thr-panel-open-a";
    const threadB = "thr-panel-open-b";
    const { rerender, result, unmount } = renderHook(
      (props: SelectionHookProps) => useSelectionHarness(props),
      {
        initialProps: { threadId: threadA },
        wrapper: createTestWrapper({
          initialEntries: [`/projects/proj_test/threads/${threadA}`],
        }),
      },
    );

    act(() => {
      result.current.setThreadSecondaryPanel("thread-info");
    });

    expect(result.current.isSecondaryPanelOpen).toBe(true);
    expect(
      window.localStorage.getItem(
        getThreadSecondaryPanelOpenStorageKey({ threadId: threadA }),
      ),
    ).toBe("true");

    rerender({ threadId: threadB });

    expect(result.current.isSecondaryPanelOpen).toBe(false);
    expect(result.current.openFixedSecondaryTab).toBeNull();
    expect(
      window.localStorage.getItem(
        getThreadSecondaryPanelOpenStorageKey({ threadId: threadB }),
      ),
    ).toBeNull();

    act(() => {
      result.current.toggleThreadSecondaryPanel();
    });
    expect(result.current.isSecondaryPanelOpen).toBe(true);

    act(() => {
      result.current.toggleThreadSecondaryPanel();
    });

    expect(result.current.isSecondaryPanelOpen).toBe(false);
    expect(
      window.localStorage.getItem(
        getThreadSecondaryPanelOpenStorageKey({ threadId: threadB }),
      ),
    ).toBe("false");

    rerender({ threadId: threadA });

    expect(result.current.isSecondaryPanelOpen).toBe(true);
    expect(result.current.openFixedSecondaryTab).toEqual({
      id: "thread-info",
      kind: "thread-info",
    });

    unmount();

    const { result: reloadedResult } = renderHook(
      (props: SelectionHookProps) => useSelectionHarness(props),
      {
        initialProps: { threadId: threadA },
        wrapper: createTestWrapper({
          initialEntries: [`/projects/proj_test/threads/${threadA}`],
        }),
      },
    );

    expect(reloadedResult.current.isSecondaryPanelOpen).toBe(true);
    expect(reloadedResult.current.openFixedSecondaryTab).toEqual({
      id: "thread-info",
      kind: "thread-info",
    });
  });

  it("consumes a URL override without rewriting another thread preference", async () => {
    const urlThreadId = "thr-url-source";
    const otherThreadId = "thr-url-other";
    const otherThreadStorageKey = getFixedPanelTabsStateStorageKey({
      threadId: otherThreadId,
    });
    const otherThreadState = createEmptyFixedPanelTabsState({
      secondary: {
        tabs: [{ id: "thread-info", kind: "thread-info" }],
        activeTabId: "thread-info",
        isOpen: true,
      },
      lastUsedAt: Date.now(),
    });
    const otherThreadStoredValue = serializeFixedPanelTabsState({
      state: otherThreadState,
    });
    window.localStorage.setItem(otherThreadStorageKey, otherThreadStoredValue);

    const { rerender, result } = renderHook(
      (props: SelectionHookProps) => useUrlSyncHarness(props),
      {
        initialProps: { threadId: urlThreadId },
        wrapper: createTestWrapper({
          initialEntries: [
            `/projects/proj_test/threads/${urlThreadId}?secondaryPanel=git-diff`,
          ],
        }),
      },
    );

    await waitFor(() => {
      expect(result.current.location.search).toBe("");
      expect(result.current.fixedPanelTabsState.secondary.activeTabId).toBe(
        "git-diff",
      );
      expect(result.current.fixedPanelTabsState.secondary.isOpen).toBe(true);
    });

    rerender({ threadId: otherThreadId });

    expect(result.current.location.search).toBe("");
    expect(result.current.fixedPanelTabsState).toEqual(otherThreadState);
    expect(window.localStorage.getItem(otherThreadStorageKey)).toBe(
      otherThreadStoredValue,
    );
  });
});
