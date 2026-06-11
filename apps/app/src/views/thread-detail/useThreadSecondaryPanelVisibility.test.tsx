// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ThreadSecondaryPanel } from "@/lib/thread-secondary-panel";
import {
  useThreadSecondaryPanelVisibility,
  type ThreadSecondaryPanelCommitDiffOpenHandler,
  type ThreadSecondaryPanelDiffFileOpenHandler,
  type ThreadSecondaryPanelHostFileOpenHandler,
  type ThreadSecondaryPanelOpenHandler,
  type ThreadSecondaryPanelStorageFileOpenHandler,
  type ThreadSecondaryPanelWorkspaceFileOpenHandler,
} from "./useThreadSecondaryPanelVisibility";

interface VisibilityHarnessProps {
  initialActivePanel?: ThreadSecondaryPanel | null;
  initialPersistedOpen?: boolean;
  isCompactViewport: boolean;
  threadId: string | undefined;
}

function useVisibilityHarness({
  initialActivePanel = null,
  initialPersistedOpen = initialActivePanel !== null,
  isCompactViewport,
  threadId,
}: VisibilityHarnessProps) {
  const [activePanel, setActivePanel] =
    useState<ThreadSecondaryPanel | null>(initialActivePanel);
  const [isPersistedOpen, setIsPersistedOpen] =
    useState(initialPersistedOpen);
  const [closePersistedPanel] = useState(() =>
    vi.fn(() => {
      setIsPersistedOpen(false);
    }),
  );
  const [openPersistedPanel] = useState(() =>
    vi.fn<ThreadSecondaryPanelOpenHandler>((panel) => {
      setActivePanel(panel);
      setIsPersistedOpen(true);
    }),
  );
  const [openPersistedDiffPanel] = useState(() =>
    vi.fn(() => {
      setActivePanel("git-diff");
      setIsPersistedOpen(true);
    }),
  );
  const [openPersistedDiffFile] = useState(() =>
    vi.fn<ThreadSecondaryPanelDiffFileOpenHandler>(() => {
      setActivePanel("git-diff");
      setIsPersistedOpen(true);
    }),
  );
  const [openPersistedCommitDiff] = useState(() =>
    vi.fn<ThreadSecondaryPanelCommitDiffOpenHandler>(() => {
      setActivePanel("git-diff");
      setIsPersistedOpen(true);
    }),
  );
  const [togglePersistedPanel] = useState(() =>
    vi.fn(() => {
      setIsPersistedOpen((current) => !current);
      setActivePanel((current) => current ?? "thread-info");
    }),
  );
  // File opens flip the persisted panel open without selecting a panel enum;
  // tabs are tracked separately from the thread-info/git-diff panels.
  const [openPersistedWorkspaceFile] = useState(() =>
    vi.fn<ThreadSecondaryPanelWorkspaceFileOpenHandler>(() => {
      setIsPersistedOpen(true);
    }),
  );
  const [openPersistedStorageFile] = useState(() =>
    vi.fn<ThreadSecondaryPanelStorageFileOpenHandler>(() => {
      setIsPersistedOpen(true);
    }),
  );
  const [openPersistedHostFile] = useState(() =>
    vi.fn<ThreadSecondaryPanelHostFileOpenHandler>(() => {
      setIsPersistedOpen(true);
    }),
  );

  const visibility = useThreadSecondaryPanelVisibility({
    closePersistedPanel,
    isPersistedOpen,
    isCompactViewport,
    openPersistedCommitDiff,
    openPersistedDiffFile,
    openPersistedDiffPanel,
    openPersistedHostFile,
    openPersistedPanel,
    openPersistedStorageFile,
    openPersistedWorkspaceFile,
    threadId,
    togglePersistedPanel,
  });

  return {
    activePanel,
    closePersistedPanel,
    isPersistedOpen,
    openPersistedCommitDiff,
    openPersistedDiffFile,
    openPersistedDiffPanel,
    openPersistedPanel,
    openPersistedWorkspaceFile,
    togglePersistedPanel,
    visibility,
  };
}

describe("useThreadSecondaryPanelVisibility", () => {
  it("keeps a restored compact drawer closed without clearing persisted state", () => {
    const props: VisibilityHarnessProps = {
      initialActivePanel: "thread-info",
      isCompactViewport: true,
      threadId: "thr-one",
    };
    const { result } = renderHook(() => useVisibilityHarness(props));

    expect(result.current.visibility.isOpen).toBe(false);
    expect(result.current.activePanel).toBe("thread-info");
    expect(result.current.isPersistedOpen).toBe(true);
    expect(result.current.closePersistedPanel).not.toHaveBeenCalled();
  });

  it("does not auto-open or clear state during a wide-compact-wide transition", () => {
    let props: VisibilityHarnessProps = {
      initialActivePanel: "git-diff",
      isCompactViewport: false,
      threadId: "thr-one",
    };
    const { rerender, result } = renderHook(() =>
      useVisibilityHarness(props),
    );

    expect(result.current.visibility.isOpen).toBe(true);

    props = {
      ...props,
      isCompactViewport: true,
    };
    rerender();

    expect(result.current.visibility.isOpen).toBe(false);
    expect(result.current.activePanel).toBe("git-diff");
    expect(result.current.isPersistedOpen).toBe(true);
    expect(result.current.closePersistedPanel).not.toHaveBeenCalled();
    expect(result.current.openPersistedPanel).not.toHaveBeenCalled();
    expect(result.current.togglePersistedPanel).not.toHaveBeenCalled();

    props = {
      ...props,
      isCompactViewport: false,
    };
    rerender();

    expect(result.current.visibility.isOpen).toBe(true);
    expect(result.current.activePanel).toBe("git-diff");
    expect(result.current.isPersistedOpen).toBe(true);
  });

  it("treats compact first-toggle without a persisted panel as transient", () => {
    let props: VisibilityHarnessProps = {
      isCompactViewport: true,
      threadId: "thr-one",
    };
    const { rerender, result } = renderHook(() =>
      useVisibilityHarness(props),
    );

    act(() => {
      result.current.visibility.togglePanel();
    });

    expect(result.current.visibility.isOpen).toBe(true);
    expect(result.current.activePanel).toBeNull();
    expect(result.current.isPersistedOpen).toBe(false);
    expect(result.current.openPersistedPanel).not.toHaveBeenCalled();
    expect(result.current.togglePersistedPanel).not.toHaveBeenCalled();

    props = {
      ...props,
      isCompactViewport: false,
    };
    rerender();

    expect(result.current.visibility.isOpen).toBe(false);
    expect(result.current.activePanel).toBeNull();
    expect(result.current.isPersistedOpen).toBe(false);
  });

  it("persists compact diff file opens and reveals the drawer", () => {
    const props: VisibilityHarnessProps = {
      isCompactViewport: true,
      threadId: "thr-one",
    };
    const { result } = renderHook(() => useVisibilityHarness(props));

    act(() => {
      result.current.visibility.openDiffFile("src/app.ts");
    });

    expect(result.current.visibility.isOpen).toBe(true);
    expect(result.current.activePanel).toBe("git-diff");
    expect(result.current.isPersistedOpen).toBe(true);
    expect(result.current.openPersistedDiffFile).toHaveBeenCalledWith(
      "src/app.ts",
    );
  });

  it("reveals the compact drawer when a workspace file opens into the panel", () => {
    const props: VisibilityHarnessProps = {
      isCompactViewport: true,
      threadId: "thr-one",
    };
    const { result } = renderHook(() => useVisibilityHarness(props));

    act(() => {
      result.current.visibility.openWorkspaceFile({
        lineRange: null,
        path: "src/app.ts",
        source: { kind: "working-tree" },
        statusLabel: null,
      });
    });

    expect(result.current.visibility.isOpen).toBe(true);
    expect(result.current.isPersistedOpen).toBe(true);
    expect(result.current.openPersistedWorkspaceFile).toHaveBeenCalledWith({
      lineRange: null,
      path: "src/app.ts",
      source: { kind: "working-tree" },
      statusLabel: null,
    });
    expect(result.current.openPersistedPanel).not.toHaveBeenCalled();
    expect(result.current.togglePersistedPanel).not.toHaveBeenCalled();
  });

  it("persists compact commit diff opens and reveals the drawer", () => {
    const props: VisibilityHarnessProps = {
      isCompactViewport: true,
      threadId: "thr-one",
    };
    const { result } = renderHook(() => useVisibilityHarness(props));

    act(() => {
      result.current.visibility.openCommitDiff("abc123");
    });

    expect(result.current.visibility.isOpen).toBe(true);
    expect(result.current.activePanel).toBe("git-diff");
    expect(result.current.isPersistedOpen).toBe(true);
    expect(result.current.openPersistedCommitDiff).toHaveBeenCalledWith(
      "abc123",
    );
  });

  it("dismisses the compact drawer without clearing the remembered panel", () => {
    const props: VisibilityHarnessProps = {
      initialActivePanel: "thread-info",
      isCompactViewport: true,
      threadId: "thr-one",
    };
    const { result } = renderHook(() => useVisibilityHarness(props));

    act(() => {
      result.current.visibility.togglePanel();
    });
    expect(result.current.visibility.isOpen).toBe(true);

    act(() => {
      result.current.visibility.closePanel();
    });

    expect(result.current.visibility.isOpen).toBe(false);
    expect(result.current.activePanel).toBe("thread-info");
    expect(result.current.isPersistedOpen).toBe(true);
    expect(result.current.closePersistedPanel).not.toHaveBeenCalled();
  });

  it("does not let a stale compact close hide the current thread drawer", () => {
    let props: VisibilityHarnessProps = {
      initialActivePanel: "thread-info",
      isCompactViewport: true,
      threadId: "thr-one",
    };
    const { rerender, result } = renderHook(() =>
      useVisibilityHarness(props),
    );

    act(() => {
      result.current.visibility.togglePanel();
    });
    const staleClosePanel = result.current.visibility.closePanel;

    props = {
      ...props,
      threadId: "thr-two",
    };
    rerender();
    act(() => {
      result.current.visibility.togglePanel();
    });
    expect(result.current.visibility.isOpen).toBe(true);

    act(() => {
      staleClosePanel();
    });

    expect(result.current.visibility.isOpen).toBe(true);
  });

  it("delegates open and close to persisted panel state on desktop", () => {
    const props: VisibilityHarnessProps = {
      isCompactViewport: false,
      threadId: "thr-one",
    };
    const { result } = renderHook(() => useVisibilityHarness(props));

    act(() => {
      result.current.visibility.togglePanel();
    });
    expect(result.current.visibility.isOpen).toBe(true);
    expect(result.current.activePanel).toBe("thread-info");
    expect(result.current.togglePersistedPanel).toHaveBeenCalled();

    act(() => {
      result.current.visibility.closePanel();
    });
    expect(result.current.visibility.isOpen).toBe(false);
    expect(result.current.activePanel).toBe("thread-info");
    expect(result.current.isPersistedOpen).toBe(false);
    expect(result.current.closePersistedPanel).toHaveBeenCalled();

    act(() => {
      result.current.visibility.openPanel("git-diff");
    });
    expect(result.current.visibility.isOpen).toBe(true);
    expect(result.current.activePanel).toBe("git-diff");
    expect(result.current.openPersistedPanel).toHaveBeenCalledWith("git-diff");
  });
});
